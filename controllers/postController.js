
const mongoose = require("mongoose");
const { Auth } = require('../models/authModel');
const { sendFollowNotification, sendFollowRequestNotification, sendFollowApprovalNotification } = require('./notificationControllers');
const { uploadImage, uploadToCloudinary, uploadImages, uploadToCloudinarys } = require('../config/cloudinary');





// ------------------ POST CONTROLLERS ------------------

// Create a new post with mentions
exports.createPost = async (req, res) => {
  try {
    const { userId, description } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let mediaFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "posts", file.originalname);
        mediaFiles.push({
          url,
          type: file.mimetype.startsWith("video") ? "video" : "image",
        });
      }
    }

    // ✅ Extract mentions (supports @john, @john_123, @john.doe, @john-doe)
    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    let mentions = [];
    let match;
    while ((match = mentionRegex.exec(description)) !== null) {
      const mentionedUser = await Auth.findOne({
        "profile.username": { $regex: new RegExp(`^${match[1]}$`, "i") } // case-insensitive
      });
      if (mentionedUser) {
        mentions.push(mentionedUser._id);
      }
    }

    const newPost = {
      userId,
      description,
      media: mediaFiles,
      mentions,
      likes: [],
      comments: [],
      createdAt: new Date(),
    };

    user.posts.push(newPost);
    await user.save();

    const createdPost = user.posts[user.posts.length - 1];

    // Post notification
    if (user.notificationPreferences.posts) {
      this.sendPostNotification(userId, createdPost._id, description || "a new post");
    }

    // Mention notifications
    for (const mentionedUserId of mentions) {
      const mentionedUser = await Auth.findById(mentionedUserId);
      if (mentionedUser && mentionedUser.notificationPreferences.mentions) {
        this.sendMentionNotification(userId, mentionedUserId, createdPost._id, description || "mentioned you in a post");
      }
    }

    res.status(201).json({
      success: true,
      message: "Post created ✅",
      data: createdPost
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Get all posts from all users
exports.getAllPosts = async (req, res) => {
  try {
    const users = await Auth.find({ "posts.0": { $exists: true } })
      .populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.mentions", "fullName profile.username profile.image")
      .select("posts");

    const allPosts = users.flatMap(user => user.posts);
    allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      totalPosts: allPosts.length,
      data: allPosts
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Get all posts for a specific user
exports.getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId)
      .populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.mentions", "fullName profile.username profile.image")
      .select("posts");

    if (!user || !user.posts || user.posts.length === 0) {
      return res.status(404).json({ success: false, message: "No posts found for this user" });
    }

    res.status(200).json({
      success: true,
      message: "Posts fetched successfully ✅",
      data: user.posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get post by ID
exports.getPostById = async (req, res) => {
  try {
    const { userId, postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or postId" });
    }

    const user = await Auth.findById(userId)
      .populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.mentions", "fullName profile.username profile.image")
      .select("posts");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const post = user.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    res.status(200).json({
      success: true,
      message: "Post fetched successfully ✅",
      data: post
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Update post by ID
exports.updatePostById = async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const { description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or postId" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const post = user.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Update description if provided
    if (description) {
      post.description = description;
    }

    // Handle new media uploads if any
    if (req.files && req.files.length > 0) {
      const mediaFiles = [];
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "posts", file.originalname);
        mediaFiles.push({
          url,
          type: file.mimetype.startsWith("video") ? "video" : "image",
        });
      }
      post.media = mediaFiles;
    }

    // Update mentions if description changed
    if (description) {
      const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
      let mentions = [];
      let match;
      while ((match = mentionRegex.exec(description)) !== null) {
        const mentionedUser = await Auth.findOne({
          "profile.username": { $regex: new RegExp(`^${match[1]}$`, "i") }
        });
        if (mentionedUser) {
          mentions.push(mentionedUser._id);
        }
      }
      post.mentions = mentions;
    }

    post.updatedAt = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: "Post updated successfully ✅",
      data: post
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Like/Unlike a post
exports.toggleLikePost = async (req, res) => {
  try {
    const { postId, userId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid postId or userId or postOwnerId" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const alreadyLiked = post.likes.some(like => like.toString() === userId);

    if (alreadyLiked) {
      post.likes.pull(userId);
    } else {
      post.likes.push(userId);

      // Send like notification if enabled for post owner
      if (postOwner.notificationPreferences.likes && postOwner._id.toString() !== userId) {
        this.sendLikeNotification(userId, postOwnerId, postId);
      }
    }

    await postOwner.save();

    res.status(200).json({
      success: true,
      message: alreadyLiked ? "Post unliked ✅" : "Post liked ✅",
      likesCount: post.likes.length,
      likes: post.likes
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Add comment to a post with mentions
exports.addComment = async (req, res) => {
  try {
    const { userId, postId, text } = req.body;

    // Validate inputs
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    if (!text || text.trim() === "") {
      return res.status(400).json({ success: false, message: "Comment text is required" });
    }

    // Find the post owner that contains this postId
    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Extract mentions from comment text
    const mentionRegex = /@(\w+)/g;
    let mentions = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionedUser = await Auth.findOne({ "profile.username": match[1] });
      if (mentionedUser) {
        mentions.push(mentionedUser._id);
      }
    }

    // Add new comment
    post.comments.push({
      userId,
      text: text.trim(),
      createdAt: new Date()
    });

    await postOwner.save();

    await postOwner.populate("posts.comments.userId", "fullName profile.username profile.image");

    const updatedPost = postOwner.posts.id(postId);
    const newComment = updatedPost.comments[updatedPost.comments.length - 1];

    // Send comment notification if enabled for post owner
    if (postOwner.notificationPreferences.comments && postOwner._id.toString() !== userId) {
      this.sendCommentNotification(userId, postOwner._id, postId, text.trim());
    }

    // Send mention notifications if enabled for mentioned users
    for (const mentionedUserId of mentions) {
      const mentionedUser = await Auth.findById(mentionedUserId);
      if (mentionedUser && mentionedUser.notificationPreferences.mentions) {
        this.sendMentionNotification(userId, mentionedUserId, postId, text.trim());
      }
    }

    res.status(201).json({
      success: true,
      message: "Comment added successfully ✅",
      data: newComment
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete a post
exports.deletePost = async (req, res) => {
  try {
    const { userId, postId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or postId" });
    }

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Find the post and remove it
    const postIndex = user.posts.findIndex(post => post._id.toString() === postId);

    if (postIndex === -1) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    user.posts.splice(postIndex, 1);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Post deleted successfully ✅"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ SAVE POST CONTROLLERS ------------------

// Save/Unsave Post
exports.toggleSavePost = async (req, res) => {
  try {
    const { userId, postId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const user = await Auth.findById(userId);
    const postOwner = await Auth.findById(postOwnerId);
    
    if (!user || !postOwner) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const isSaved = user.savedPosts.some(savedPostId => savedPostId.toString() === postId);

    if (isSaved) {
      user.savedPosts.pull(postId);
      await user.save();
      return res.status(200).json({ success: true, message: "Post unsaved", action: "unsaved" });
    } else {
      user.savedPosts.push(postId);
      await user.save();
      return res.status(200).json({ success: true, message: "Post saved", action: "saved" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get Saved Posts
exports.getSavedPosts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Get all posts that are saved by the user
    const savedPosts = [];
    for (const postId of user.savedPosts) {
      // Find the post in any user's posts
      const postOwner = await Auth.findOne({ "posts._id": postId })
        .populate("posts.userId", "fullName profile.username profile.image")
        .populate("posts.comments.userId", "fullName profile.username profile.image")
        .populate("posts.mentions", "fullName profile.username profile.image");
      
      if (postOwner) {
        const post = postOwner.posts.id(postId);
        if (post) {
          savedPosts.push(post);
        }
      }
    }

    // Sort by creation date (newest first)
    savedPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      message: "Saved posts fetched successfully",
      data: savedPosts
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
