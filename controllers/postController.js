
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

// ✅ Get All Likes for a Post
exports.getAllLikes = async (req, res) => {
  try {
    const { postOwnerId, postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postOwnerId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) return res.status(404).json({ success: false, message: "Post owner not found" });

    const post = postOwner.posts.id(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    res.status(200).json({ success: true, likes: post.likes, likesCount: post.likes.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ✅ Get Like by User ID
exports.getLikeById = async (req, res) => {
  try {
    const { postOwnerId, postId, userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postOwnerId) || !mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) return res.status(404).json({ success: false, message: "Post owner not found" });

    const post = postOwner.posts.id(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    const liked = post.likes.includes(userId);

    res.status(200).json({ success: true, liked });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};


// Add comment to a post with mentions
exports.addComment = async (req, res) => {
  try {
    const { userId, postId, text } = req.body;

    // ✅ Validate userId only
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // ✅ Validate postId as non-empty string
    if (!postId || postId.trim() === "") {
      return res.status(400).json({ success: false, message: "Invalid postId" });
    }

    if (!text || text.trim() === "") {
      return res.status(400).json({ success: false, message: "Comment text is required" });
    }

    // ✅ Find the post inside user's posts array
    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // ✅ Extract mentions from text
    const mentionRegex = /@(\w+)/g;
    let mentions = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionedUser = await Auth.findOne({ "profile.username": match[1] });
      if (mentionedUser) {
        mentions.push(mentionedUser._id);
      }
    }

    // ✅ Add comment
    const newComment = {
      userId,
      text: text.trim(),
      createdAt: new Date(),
      mentions,
    };

    post.comments.push(newComment);
    await postOwner.save();

    // ✅ Populate user info for response
    await postOwner.populate("posts.comments.userId", "fullName profile.username profile.image");
    await postOwner.populate("posts.comments.mentions", "fullName profile.username profile.image");

    const updatedPost = postOwner.posts.id(postId);
    const savedComment = updatedPost.comments[updatedPost.comments.length - 1];

    // ✅ Send comment notification (non-blocking)
    if (postOwner.notificationPreferences?.comments && postOwner._id.toString() !== userId) {
      exports.sendCommentNotification(userId, postOwner._id, postId, text.trim())
        .catch(error => console.error("Comment notification error:", error));
    }

    // ✅ Send mention notifications (non-blocking)
    for (const mentionedUserId of mentions) {
      const mentionedUser = await Auth.findById(mentionedUserId);
      if (mentionedUser && mentionedUser.notificationPreferences?.mentions) {
        exports.sendMentionNotification(userId, mentionedUserId, postId, text.trim())
          .catch(error => console.error("Mention notification error:", error));
      }
    }

    res.status(201).json({
      success: true,
      message: "Comment added successfully ✅",
      data: savedComment,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


// ---------------- Get all comments for a post ----------------
exports.getCommentsByPostId = async (req, res) => {
  try {
    const { postId } = req.params;

    // Validate postId only (treat as string)
    if (!postId || postId.trim() === "") {
      return res.status(400).json({ success: false, message: "Invalid postId" });
    }

    // Find the post
    const postOwner = await Auth.findOne({ "posts._id": postId })
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.comments.mentions", "fullName profile.username profile.image");

    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    res.status(200).json({
      success: true,
      message: "Comments fetched successfully ✅",
      data: post.comments,
    });

  } catch (error) {
    console.error("getCommentsByPostId error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
// ---------------- Get a comment by ID ----------------
exports.getCommentById = async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const postOwner = await Auth.findOne({ "posts._id": postId })
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.comments.mentions", "fullName profile.username profile.image");

    if (!postOwner) return res.status(404).json({ success: false, message: "Post not found" });

    const post = postOwner.posts.id(postId);
    const comment = post.comments.id(commentId);

    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });

    res.status(200).json({ success: true, comment });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ---------------- Delete a comment by ID ----------------
// Delete a comment by ID (with userId from params)
exports.deleteCommentById = async (req, res) => {
  try {
    const { postId, commentId, userId } = req.params;

    // Validate IDs
    if (
      !mongoose.Types.ObjectId.isValid(postId) ||
      !mongoose.Types.ObjectId.isValid(commentId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    // Find the post owner
    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Find the comment
    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    // Optional: check if the user deleting is the comment owner or post owner
    if (comment.userId.toString() !== userId && postOwner._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this comment" });
    }

    // Remove comment
    comment.remove();
    await postOwner.save();

    res.status(200).json({ success: true, message: "Comment deleted successfully ✅" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete a post
exports.deletePost = async (req, res) => {
  try {
    const { userId, postId } = req.params; // <-- get from params now

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


// ✅ Get a single saved post by ID
exports.getSavedPostById = async (req, res) => {
  try {
    const { userId, postId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.savedPosts.includes(postId)) {
      return res.status(404).json({ success: false, message: "Saved post not found" });
    }

    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) return res.status(404).json({ success: false, message: "Post not found" });

    const post = postOwner.posts.id(postId);
    res.status(200).json({ success: true, post });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.deleteSavedPost = async (req, res) => {
  try {
    const { userId, postId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isSaved = user.savedPosts.some(id => id.toString() === postId);
    if (!isSaved) {
      return res.status(404).json({ success: false, message: "Post not found in saved posts" });
    }

    user.savedPosts.pull(postId);
    await user.save();

    res.status(200).json({ success: true, message: "Saved post deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
// Send notification to followers when a new post is created
exports.sendPostNotification = async (userId, postId, postDescription) => {
  try {
    const user = await Auth.findById(userId);
    if (!user) return;

    // Get all followers
    const followers = user.followers;

    if (followers.length === 0) return;

    const message = `${user.fullName} created a new post: "${postDescription.substring(0, 50)}${postDescription.length > 50 ? '...' : ''}"`;

    // Create notifications for all followers who have post notifications enabled
    const notifications = [];
    for (const followerId of followers) {
      const follower = await Auth.findById(followerId);
      if (follower && follower.notificationPreferences.posts) {
        notifications.push({
          recipient: followerId,
          sender: userId,
          type: "post",
          post: postId,
          message: message,
          isRead: false
        });
      }
    }

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

  } catch (error) {
    console.error("Error sending post notifications:", error);
  }
};

// Send follow request notification
exports.sendFollowRequestNotification = async (followerId, targetId) => {
  try {
    const follower = await Auth.findById(followerId);
    const target = await Auth.findById(targetId);

    if (!follower || !target) return;

    // Check if target has follow request notifications enabled
    if (!target.notificationPreferences.followRequests) return;

    const notification = new Notification({
      recipient: targetId,
      sender: followerId,
      type: "follow_request",
      message: `${follower.fullName} sent you a follow request`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending follow request notification:", error);
  }
};

// Send follow notification
exports.sendFollowNotification = async (followerId, targetId) => {
  try {
    const follower = await Auth.findById(followerId);
    const target = await Auth.findById(targetId);

    if (!follower || !target) return;

    // Check if target has follow notifications enabled
    if (!target.notificationPreferences.follows) return;

    const notification = new Notification({
      recipient: targetId,
      sender: followerId,
      type: "follow",
      message: `${follower.fullName} started following you`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending follow notification:", error);
  }
};

// Send follow approval notification
exports.sendFollowApprovalNotification = async (userId, followerId) => {
  try {
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) return;

    // Check if follower has follow approval notifications enabled
    if (!follower.notificationPreferences.followApprovals) return;

    const notification = new Notification({
      recipient: followerId,
      sender: userId,
      type: "follow_approval",
      message: `${user.fullName} approved your follow request`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending follow approval notification:", error);
  }
};

// Send like notification
exports.sendLikeNotification = async (userId, postOwnerId, postId) => {
  try {
    const user = await Auth.findById(userId);
    const postOwner = await Auth.findById(postOwnerId);

    if (!user || !postOwner || userId.toString() === postOwnerId.toString()) return;

    // Check if post owner has like notifications enabled
    if (!postOwner.notificationPreferences.likes) return;

    const notification = new Notification({
      recipient: postOwnerId,
      sender: userId,
      type: "like",
      post: postId,
      message: `${user.fullName} liked your post`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending like notification:", error);
  }
};

// Send comment notification
exports.sendCommentNotification = async (userId, postOwnerId, postId, commentText) => {
  try {
    const user = await Auth.findById(userId);
    const postOwner = await Auth.findById(postOwnerId);

    if (!user || !postOwner || userId.toString() === postOwnerId.toString()) return;

    // Check if post owner has comment notifications enabled
    if (!postOwner.notificationPreferences.comments) return;

    const message = `${user.fullName} commented on your post: "${commentText.substring(0, 30)}${commentText.length > 30 ? '...' : ''}"`;

    const notification = new Notification({
      recipient: postOwnerId,
      sender: userId,
      type: "comment",
      post: postId,
      message: message,
      isRead: false
    });

    await notification.save();

    // Optional: Add real-time notification (socket.io, push notification, etc.)
    console.log(`Comment notification sent to ${postOwnerId} from ${userId}`);

  } catch (error) {
    console.error("Error sending comment notification:", error);
  }
};

// Send mention notification
exports.sendMentionNotification = async (senderId, recipientId, postId, messageText) => {
  try {
    const sender = await Auth.findById(senderId);
    const recipient = await Auth.findById(recipientId);

    if (!sender || !recipient || senderId.toString() === recipientId.toString()) return;

    // Check if recipient has mention notifications enabled
    if (!recipient.notificationPreferences.mentions) return;

    const message = `${sender.fullName} mentioned you: "${messageText.substring(0, 30)}${messageText.length > 30 ? '...' : ''}"`;

    const notification = new Notification({
      recipient: recipientId,
      sender: senderId,
      type: "mention",
      post: postId,
      message: message,
      isRead: false
    });

    await notification.save();

    // Optional: Add real-time notification
    console.log(`Mention notification sent to ${recipientId} from ${senderId}`);

  } catch (error) {
    console.error("Error sending mention notification:", error);
  }
};