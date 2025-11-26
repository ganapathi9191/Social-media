const mongoose = require("mongoose");
const { Auth,Notification } = require('../models/authModel');
const { sendFollowNotification, sendFollowRequestNotification, sendFollowApprovalNotification } = require('./notificationControllers');
const { uploadImage, uploadToCloudinary, uploadImages, uploadToCloudinarys } = require('../config/cloudinary');


const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return id; // fallback for string IDs
  }
};

const createNotification = async (recipient, sender, type, postId = null, commentId = null, message = "", options = {}) => {
  try {
    const { allowSelf = true, checkPreferences = false } = options;

    console.log(`🔔 Creating notification:`, { 
      recipient, 
      sender, 
      type, 
      postId, 
      message 
    });

    if (!recipient || !sender) {
      console.warn("createNotification: missing recipient or sender");
      return null;
    }

    // Normalize to ObjectId objects when possible
    const recipientId = toObjectId(recipient);
    const senderId = toObjectId(sender);

    if (!allowSelf && String(recipientId) === String(senderId)) {
      console.log("createNotification: skipping self notification");
      return null;
    }

    // Optional preferences check
    if (checkPreferences) {
      try {
        const recipientUser = await Auth.findById(recipientId).select("notificationPreferences").lean();
        if (!recipientUser) {
          console.log("createNotification: recipient not found");
          return null;
        }
        const prefs = recipientUser.notificationPreferences || {};
        const prefMap = {
          post: "posts",
          follow: "follows",
          like: "likes",
          comment: "comments",
          follow_request: "followRequests",
          follow_approval: "followApprovals",
          mention: "mentions",
          message: "messages"
        };
        const prefKey = prefMap[type] || null;
        if (prefKey && prefs[prefKey] === false) {
          console.log(`createNotification: recipient preference disables '${type}' notifications`);
          return null;
        }
      } catch (e) {
        console.warn("createNotification: preference check failed:", e.message);
      }
    }

    const payload = {
      recipient: recipientId,
      sender: senderId,
      type,
      message: message || "New notification",
      isRead: false,
      isDeleted: false,
      createdAt: new Date()
    };

    if (postId) payload.post = toObjectId(postId);
    if (commentId) payload.reference = { commentId: toObjectId(commentId) };

    const notification = await Notification.create(payload);
    console.log(`✅ Notification created:`, notification._id);

    // emit real-time if socket exists
    const io = global.io;
    if (io) {
      try {
        const populated = await Notification.findById(notification._id)
          .populate("sender", "fullName profile.username profile.image")
          .populate("post", "description media userId")
          .lean();
        io.to(String(recipientId)).emit("newNotification", populated);
        console.log(`📡 Real-time notification sent to user: ${recipientId}`);
      } catch (e) {
        console.warn("createNotification: emit/populate failed:", e.message);
      }
    }

    return notification;
  } catch (error) {
    if (error && error.code === 11000) {
      console.warn("createNotification: duplicate prevented (11000).");
      return null;
    }
    console.error("createNotification error:", error);
    return null;
  }
};

// ------------------ POST CONTROLLERS ------------------

// Create a new post with mentions
exports.createPost = async (req, res) => {
    try {
    const { userId, description } = req.body;
    
    console.log(`🆕 Creating post for user: ${userId}`, { description });
    
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    console.log(`👤 User found:`, user.fullName, "Followers:", user.followers?.length);

    // Handle media files
    let mediaFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "posts", file.originalname);
        mediaFiles.push({ url, type: file.mimetype && file.mimetype.startsWith("video") ? "video" : "image" });
      }
    }

    // Extract mentions from description
    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    let mentions = [];
    if (description && typeof description === "string") {
      let match;
      while ((match = mentionRegex.exec(description)) !== null) {
        const username = match[1];
        const mentionedUser = await Auth.findOne({ "profile.username": { $regex: new RegExp(`^${username}$`, "i") } }).select("_id fullName");
        if (mentionedUser) {
          console.log(`✅ Found mentioned user: ${mentionedUser.fullName} (${mentionedUser._id})`);
          mentions.push(mentionedUser._id);
        } else {
          console.log(`❌ Mentioned user not found: ${username}`);
        }
      }
    }

    console.log(`📝 Mentions extracted:`, mentions);

    const newPost = {
      userId: toObjectId(userId),
      description: description || "",
      media: mediaFiles,
      mentions: mentions,
      likes: [],
      comments: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Initialize posts array if it doesn't exist
    if (!user.posts) {
      user.posts = [];
    }

    user.posts.push(newPost);
    await user.save();

    const createdPost = user.posts[user.posts.length - 1];
    console.log(`✅ Post created with ID:`, createdPost._id);

    // 🔥 FIXED: AUTOMATICALLY CREATE NOTIFICATIONS FOR FOLLOWERS
    if (Array.isArray(user.followers) && user.followers.length > 0) {
      console.log(`📢 Notifying ${user.followers.length} followers`);
      
      for (const followerId of user.followers) {
        try {
          console.log(`👥 Creating notification for follower: ${followerId}`);
          
          // Use the createNotification function directly
          const notification = await createNotification(
            followerId.toString(), 
            userId, 
            "post", 
            createdPost._id, 
            null, 
            `${user.fullName} created a new post`, 
            { 
              allowSelf: false, 
              checkPreferences: true 
            }
          );
          
          if (notification) {
            console.log(`✅ Post notification created for follower ${followerId}:`, notification._id);
          } else {
            console.log(`❌ Failed to create post notification for follower ${followerId}`);
          }
        } catch (error) {
          console.error(`🚨 Error creating post notification for follower ${followerId}:`, error.message);
        }
      }
    } else {
      console.log(`ℹ️ No followers to notify for post`);
    }

    // 🔥 FIXED: AUTOMATICALLY CREATE NOTIFICATIONS FOR MENTIONED USERS
    if (mentions.length > 0) {
      console.log(`🔔 Notifying ${mentions.length} mentioned users`);
      
      for (const mId of mentions) {
        try {
          // Skip if user mentioned themselves
          if (mId.toString() === userId) continue;
          
          console.log(`📍 Creating mention notification for user: ${mId}`);
          
          const notification = await createNotification(
            mId.toString(), 
            userId, 
            "mention", 
            createdPost._id, 
            null, 
            `${user.fullName} mentioned you in a post`, 
            { 
              allowSelf: true, 
              checkPreferences: true 
            }
          );
          
          if (notification) {
            console.log(`✅ Mention notification created for user ${mId}:`, notification._id);
          } else {
            console.log(`❌ Failed to create mention notification for user ${mId}`);
          }
        } catch (error) {
          console.error(`🚨 Error creating mention notification for user ${mId}:`, error.message);
        }
      }
    } else {
      console.log(`ℹ️ No mentions to notify`);
    }

    res.status(201).json({ 
      success: true, 
      message: 'Post created ✅', 
      data: createdPost,
      debug: {
        followersNotified: user.followers?.length || 0,
        mentionsNotified: mentions.length,
        postId: createdPost._id
      }
    });
  } catch (err) {
    console.error("🚨 createPost error:", err);
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
    // ✅ Get all users who have posts
    const users = await Auth.find({ "posts.0": { $exists: true } })
      .populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.mentions", "fullName profile.username profile.image")
      .select("posts");

    // ✅ Combine all posts into one array
    let allPosts = users.flatMap(user => user.posts);

    // ✅ Sort posts by creation date (newest first)
    allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // ✅ Fetch active campaigns (ads)
    const activeCampaigns = await Campaign.find({ isActive: true });

    // ✅ Mix ads after every 10 posts
    let mixedFeed = [];
    let adIndex = 0;
    const adInterval = 10; // show ad after every 10 posts

    for (let i = 0; i < allPosts.length; i++) {
      mixedFeed.push({
        type: "post",
        data: allPosts[i]
      });

      if ((i + 1) % adInterval === 0 && adIndex < activeCampaigns.length) {
        mixedFeed.push({
          type: "advertisement",
          data: activeCampaigns[adIndex]
        });
        adIndex++;
      }
    }

    // ✅ If posts end but ads remain, append one more ad
    while (adIndex < activeCampaigns.length && mixedFeed.length < allPosts.length + activeCampaigns.length) {
      mixedFeed.push({
        type: "advertisement",
        data: activeCampaigns[adIndex]
      });
      adIndex++;
    }

    res.status(200).json({
      success: true,
      totalPosts: allPosts.length,
      totalAdvertisements: activeCampaigns.length,
      feedCount: mixedFeed.length,
      data: mixedFeed
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
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
    
    console.log(`❤️ Toggle like:`, { postId, userId, postOwnerId });
    
    // Validation
    if (!postId || !userId || !postOwnerId) {
      return res.status(400).json({ 
        success: false, 
        message: "postId, userId, postOwnerId required" 
      });
    }
    
    if (!mongoose.Types.ObjectId.isValid(postId) || 
        !mongoose.Types.ObjectId.isValid(userId) || 
        !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid IDs" 
      });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const postOwnerObjectId = new mongoose.Types.ObjectId(postOwnerId);
    const postObjectId = new mongoose.Types.ObjectId(postId);

    // Find post owner and post
    const postOwner = await Auth.findById(postOwnerObjectId);
    if (!postOwner) {
      return res.status(404).json({ 
        success: false, 
        message: "Post owner not found" 
      });
    }

    // Find the specific post
    const post = postOwner.posts.id(postObjectId);
    if (!post) {
      return res.status(404).json({ 
        success: false, 
        message: "Post not found" 
      });
    }

    // ✅ FIXED: Ensure likes array exists and is clean
    if (!post.likes || !Array.isArray(post.likes)) {
      post.likes = [];
    }

    // Clean the likes array before processing
    post.likes = post.likes.filter(like => 
      like && mongoose.Types.ObjectId.isValid(like)
    ).map(like => new mongoose.Types.ObjectId(like));

    const alreadyLiked = post.likes.some(likeId => 
      likeId.toString() === userObjectId.toString()
    );

    console.log(`Current likes:`, post.likes.length);
    console.log(`Already liked:`, alreadyLiked);

    if (alreadyLiked) {
      // Unlike the post
      post.likes = post.likes.filter(likeId => 
        likeId.toString() !== userObjectId.toString()
      );
      
      postOwner.markModified('posts');
      await postOwner.save();

      console.log(`✅ Post unliked. New likes count:`, post.likes.length);

      // Delete like notification
      try {
        await Notification.findOneAndDelete({
          recipient: postOwnerObjectId,
          sender: userObjectId,
          type: "like",
          post: postObjectId
        });
        console.log(`🔕 Like notification deleted`);
      } catch (notifError) {
        console.warn(`Warning: Could not delete notification:`, notifError.message);
      }

      return res.status(200).json({ 
        success: true, 
        message: "Post unliked ✅", 
        likesCount: post.likes.length, 
        liked: false
      });
    } else {
      // Like the post
      post.likes.push(userObjectId);
      
      postOwner.markModified('posts');
      await postOwner.save();

      console.log(`✅ Post liked. New likes count:`, post.likes.length);

      // Create notification (skip if liking own post)
      if (postOwnerObjectId.toString() !== userObjectId.toString()) {
        try {
          const user = await Auth.findById(userObjectId).select("fullName profile.username");
          const notification = await createNotification(
            postOwnerId, 
            userId, 
            "like", 
            postId, 
            null, 
            `${user?.fullName || user?.profile?.username || "Someone"} liked your post`, 
            { allowSelf: false, checkPreferences: true }
          );
          
          if (notification) {
            console.log(`✅ Like notification created:`, notification._id);
          }
        } catch (notifError) {
          console.warn(`Warning: Could not create notification:`, notifError.message);
        }
      }

      return res.status(200).json({ 
        success: true, 
        message: "Post liked ✅", 
        likesCount: post.likes.length, 
        liked: true
      });
    }
  } catch (err) {
    console.error("❌ toggleLikePost error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: err.message 
    });
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
    
    console.log(`💬 Comment action:`, { userId, postId, text });
    
    if (!userId || !postId || !text) return res.status(400).json({ success: false, message: "userId, postId and text are required" });
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) return res.status(400).json({ success: false, message: "Invalid IDs" });

    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) return res.status(404).json({ success: false, message: "Post not found" });

    const post = postOwner.posts.id(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    const commenter = await Auth.findById(userId).select("fullName profile.username");
    
    // Mention extraction
    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    let mentions = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const username = match[1];
      const mentionedUser = await Auth.findOne({ "profile.username": { $regex: new RegExp(`^${username}$`, "i") } }).select("_id fullName");
      if (mentionedUser) mentions.push(mentionedUser._id);
    }

    const newComment = {
      userId: toObjectId(userId),
      text: String(text).trim(),
      createdAt: new Date(),
      mentions: mentions
    };

    post.comments.push(newComment);
    await postOwner.save();

    const updatedPost = postOwner.posts.id(postId);
    const savedComment = updatedPost.comments[updatedPost.comments.length - 1];

    console.log(`✅ Comment added by ${commenter?.fullName}`);

    // 🔥 FIXED: AUTOMATICALLY CREATE NOTIFICATION FOR POST OWNER
    // Only create notification if commenter is not the post owner
    if (String(postOwner._id) !== String(userId)) {
      try {
        console.log(`📝 Creating comment notification for post owner: ${postOwner._id}`);
        
        const notification = await createNotification(
          postOwner._id.toString(),
          userId,
          "comment",
          postId,
          savedComment._id,
          `${commenter?.fullName || 'Someone'} commented on your post: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`,
          { allowSelf: false, checkPreferences: true }
        );
        
        if (notification) {
          console.log(`✅ Comment notification created for post owner:`, notification._id);
        } else {
          console.log(`❌ Failed to create comment notification for post owner`);
        }
      } catch (error) {
        console.error(`🚨 Error creating comment notification:`, error.message);
      }
    }

    // 🔥 FIXED: AUTOMATICALLY CREATE NOTIFICATIONS FOR MENTIONED USERS IN COMMENT
    if (mentions.length > 0) {
      console.log(`🔔 Notifying ${mentions.length} mentioned users in comment`);
      
      for (const mId of mentions) {
        try {
          // Skip if user mentioned themselves
          if (mId.toString() === userId) continue;
          
          console.log(`📍 Creating comment mention notification for user: ${mId}`);
          
          const notification = await createNotification(
            mId.toString(),
            userId,
            "mention",
            postId,
            savedComment._id,
            `${commenter?.fullName || 'Someone'} mentioned you in a comment: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`,
            { allowSelf: true, checkPreferences: true }
          );
          
          if (notification) {
            console.log(`✅ Comment mention notification created for user ${mId}:`, notification._id);
          } else {
            console.log(`❌ Failed to create comment mention notification for user ${mId}`);
          }
        } catch (error) {
          console.error(`🚨 Error creating comment mention notification:`, error.message);
        }
      }
    }

    res.status(201).json({ 
      success: true, 
      message: "Comment added successfully ✅", 
      data: savedComment,
      debug: {
        mentionsNotified: mentions.length
      }
    });
  } catch (error) {
    console.error("addComment error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ---------------- Get all comments for a post ----------------
exports.getCommentsByPostId = async (req, res) => {
  try {
    const { postId } = req.params;

    if (!postId || postId.trim() === "") {
      return res.status(400).json({ success: false, message: "Invalid postId" });
    }

    const postOwner = await Auth.findOne({ "posts._id": postId })
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.comments.mentions", "fullName profile.username profile.image");

    if (!postOwner) return res.status(404).json({ success: false, message: "Post not found" });

    const post = postOwner.posts.id(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

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

    if (!mongoose.Types.ObjectId.isValid(postId) ||
        !mongoose.Types.ObjectId.isValid(commentId) ||
        !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) return res.status(404).json({ success: false, message: "Post not found" });

    const post = postOwner.posts.id(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });

    // Authorization: commenter or post owner
    if (String(comment.userId) !== String(userId) && String(postOwner._id) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this comment" });
    }

    // Delete associated notification for this comment (recipient = post owner)
    await Notification.findOneAndDelete({
      recipient: postOwner._id,
      sender: comment.userId,
      type: "comment",
      post: mongoose.Types.ObjectId(postId),
      "reference.commentId": mongoose.Types.ObjectId(commentId)
    });

    comment.remove();
    await postOwner.save();

    res.status(200).json({ success: true, message: "Comment deleted successfully ✅" });
  } catch (error) {
    console.error("deleteCommentById error:", error);
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