const mongoose = require("mongoose");
const { Auth, Notification } = require('../models/authModel');
const { sendFollowNotification, sendFollowRequestNotification, sendFollowApprovalNotification } = require('./notificationControllers');
const { uploadImage, uploadToCloudinary, uploadImages, uploadToCloudinarys } = require('../config/cloudinary');
const { rewardPostCoin } = require("../utils/walletPostReward");



// ========================================
// HELPER FUNCTIONS
// ========================================

// ✅ Convert to ObjectId safely
// ✅ Simple Safe ObjectId Converter
const toObjectId = (id) => {
  if (!id) return null;
  try {
    if (id instanceof mongoose.Types.ObjectId) return id;
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};
// ✅ CRITICAL: Deep clean all corrupted data
const deepCleanUserData = (user) => {
  if (!user || !user.posts || !Array.isArray(user.posts)) return user;

  user.posts = user.posts.map(post => {
    if (!post) return post;

    // ✅ Clean likes array - remove ANY corrupted objects
    if (post.likes && Array.isArray(post.likes)) {
      post.likes = post.likes
        .filter(like => {
          // Remove objects with notificationHandled
          if (typeof like === 'object' && like !== null && like.notificationHandled !== undefined) {
            console.log('🧹 Removing corrupted like object with notificationHandled');
            return false;
          }
          // Remove null/undefined
          if (like === null || like === undefined) {
            return false;
          }
          // Keep only valid ObjectIds
          return mongoose.Types.ObjectId.isValid(like);
        })
        .map(like => {
          // Extract _id if it's an object
          if (typeof like === 'object' && like !== null && like._id) {
            return toObjectId(like._id);
          }
          // Convert to ObjectId
          return toObjectId(like);
        });
    } else {
      // Ensure likes array exists
      post.likes = [];
    }

    // ✅ Clean comments array (remove notificationHandled)
    if (post.comments && Array.isArray(post.comments)) {
      post.comments = post.comments.map(comment => {
        if (comment && typeof comment === 'object') {
          // Remove notificationHandled from comments
          if (comment.notificationHandled !== undefined) {
            delete comment.notificationHandled;
          }
        }
        return comment;
      });
    }

    return post;
  });

  return user;
};

// ✅ FIXED: Create notification with ULTRA-SAFE duplicate handling
const createNotificationSafe = async (recipient, sender, type, postId, commentId, message) => {
  try {
    // Skip self notifications
    if (recipient.toString() === sender.toString()) {
      console.log('⏭️ Skipping self notification');
      return null;
    }

    const recipientId = toObjectId(recipient);
    const senderId = toObjectId(sender);

    // ✅ ULTRA-SAFE: Build query without commentId for like notifications
    const query = {
      recipient: recipientId,
      sender: senderId,
      type: type
    };

    if (postId) query.post = toObjectId(postId);

    // ✅ CRITICAL: Only add commentId for comment-related notifications
    if (commentId && (type === 'comment' || type === 'mention')) {
      query['reference.commentId'] = toObjectId(commentId);
    } else {
      // For like notifications, explicitly set commentId to null to match index
      query['reference.commentId'] = null;
    }

    // ✅ Use findOneAndUpdate with upsert to avoid duplicates
    const notification = await Notification.findOneAndUpdate(
      query,
      {
        $setOnInsert: {
          recipient: recipientId,
          sender: senderId,
          type: type,
          message: message,
          isRead: false,
          createdAt: new Date()
        },
        // Update existing notification if needed
        $set: {
          message: message,
          updatedAt: new Date()
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    console.log(`✅ Notification handled: ${notification._id}`);

    // Emit real-time notification only for new ones
    if (global.io) {
      const populated = await Notification.findById(notification._id)
        .populate('sender', 'fullName profile')
        .lean();
      global.io.to(recipient.toString()).emit('newNotification', populated);
    }

    return notification;
  } catch (error) {
    // ✅ Handle duplicate key error gracefully
    if (error.code === 11000) {
      console.log('⚠️ Duplicate notification prevented safely');
      // Try to find the existing notification
      try {
        const recipientId = toObjectId(recipient);
        const senderId = toObjectId(sender);
        const existing = await Notification.findOne({
          recipient: recipientId,
          sender: senderId,
          type: type,
          post: postId ? toObjectId(postId) : null
        });
        return existing;
      } catch (findError) {
        return null;
      }
    }
    console.error('❌ Notification creation error:', error.message);
    return null;
  }
};
// ✅ Basic Data Cleaner
const cleanLikesArray = (likes) => {
  if (!Array.isArray(likes)) return [];

  return likes
    .filter(like => mongoose.Types.ObjectId.isValid(like))
    .map(like => toObjectId(like))
    .filter(like => like !== null);
};

// ========================================
// POST CONTROLLERS
// ========================================

// ✅ CREATE POST
exports.createPost = async (req, res) => {
  try {
    const { userId, description } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    let user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // ✅ CRITICAL: Deep clean BEFORE any operations
    user = deepCleanUserData(user);

    // Handle media files
    let mediaFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "posts", file.originalname);
        mediaFiles.push({
          url,
          type: file.mimetype && file.mimetype.startsWith("video") ? "video" : "image"
        });
      }
    }

    // Extract mentions
    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    let mentions = [];
    if (description && typeof description === "string") {
      let match;
      while ((match = mentionRegex.exec(description)) !== null) {
        const mentionedUser = await Auth.findOne({
          "profile.username": { $regex: new RegExp(`^${match[1]}$`, "i") }
        }).select("_id");

        if (mentionedUser) {
          mentions.push(mentionedUser._id);
        }
      }
    }

    // Create new post
    const newPost = {
      userId: toObjectId(userId),
      description: description || "",
      media: mediaFiles,
      mentions: mentions.map(m => toObjectId(m)),
      likes: [], // ALWAYS initialize as empty array
      comments: [], // ALWAYS initialize as empty array
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (!user.posts) user.posts = [];
    user.posts.push(newPost);

    user.markModified('posts');
    await user.save({ validateBeforeSave: true });

    const createdPost = user.posts[user.posts.length - 1];

    // 🎁 POST COIN REWARD (SILENT – NO FRONTEND EFFECT)
    rewardPostCoin(userId)
      .catch(err => console.error("Post coin reward error:", err.message));

    // Create notifications for followers
    if (user.followers && user.followers.length > 0) {
      for (const followerId of user.followers) {
        await createNotificationSafe(
          followerId,
          userId,
          'post',
          createdPost._id,
          null,
          `${user.fullName} created a new post`
        );
      }
    }

    // Create notifications for mentions
    for (const mentionId of mentions) {
      await createNotificationSafe(
        mentionId,
        userId,
        'mention',
        createdPost._id,
        null,
        `${user.fullName} mentioned you in a post`
      );
    }

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: createdPost
    });

  } catch (err) {
    console.error("❌ createPost error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
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
// Get all posts for a specific user with integrated ads
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

    // ✅ Fetch ACTIVE campaigns with valid packages
    const now = new Date();
    const activeCampaigns = await Campaign.find({
      isActive: true,
      "purchasedPackage.paymentStatus": "completed",
      "purchasedPackage.expiresAt": { $gt: now }
    })
    .select("fullName link media purchasedPackage stats")
    .lean();

    // ✅ Mix ads based on each campaign's postsInterval setting
    let mixedFeed = [];
    let campaignIndex = 0;
    let postCounter = 0;

    for (let i = 0; i < allPosts.length; i++) {
      mixedFeed.push({
        type: "post",
        data: allPosts[i]
      });

      postCounter++;

      // Check if we need to insert an ad
      if (activeCampaigns.length > 0) {
        const currentCampaign = activeCampaigns[campaignIndex % activeCampaigns.length];
        const postsInterval = currentCampaign.purchasedPackage?.postsInterval || 10;
        
        if (postCounter >= postsInterval) {
          mixedFeed.push({
            type: "advertisement",
            data: {
              ...currentCampaign,
              contentType: "campaign",
              adIndex: Math.floor(i / postsInterval)
            }
          });
          
          // Update campaign impressions
          await Campaign.findByIdAndUpdate(currentCampaign._id, {
            $inc: { "stats.impressions": 1 }
          });
          
          postCounter = 0; // Reset counter for next interval
          campaignIndex++; // Move to next campaign for next insertion
        }
      }
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

    const userObjectId = toObjectId(userId);
    const postOwnerObjectId = toObjectId(postOwnerId);
    const postObjectId = toObjectId(postId);

    // Find post owner
    let postOwner = await Auth.findById(postOwnerObjectId);
    if (!postOwner) {
      return res.status(404).json({
        success: false,
        message: "Post owner not found"
      });
    }

    // ✅ CRITICAL: Clean data BEFORE operations
    postOwner = deepCleanUserData(postOwner);

    // Find the specific post
    const post = postOwner.posts.id(postObjectId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    // ✅ CRITICAL: Ensure likes is a clean array
    if (!post.likes || !Array.isArray(post.likes)) {
      post.likes = [];
    }

    // Clean the likes array again to be absolutely sure
    post.likes = post.likes
      .filter(like => {
        if (typeof like === 'object' && like !== null && like.notificationHandled !== undefined) {
          console.log('🧹 Removing corrupted like during toggle');
          return false;
        }
        return mongoose.Types.ObjectId.isValid(like);
      })
      .map(like => {
        if (typeof like === 'object' && like !== null && like._id) {
          return toObjectId(like._id);
        }
        return toObjectId(like);
      });

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

      // ✅ FIX: Delete like notification using the same unique query
      try {
        await Notification.findOneAndDelete({
          recipient: postOwnerObjectId,
          sender: userObjectId,
          type: "like",
          post: postObjectId
        });
        console.log(`🔕 Like notification deleted`);
      } catch (notifError) {
        console.log(`ℹ️ No notification to delete or already deleted`);
      }

      return res.status(200).json({
        success: true,
        message: "Post unliked successfully",
        likesCount: post.likes.length,
        liked: false
      });
    } else {
      // Like the post - ONLY add ObjectId
      post.likes.push(userObjectId);

      postOwner.markModified('posts');
      await postOwner.save();

      console.log(`✅ Post liked. New likes count:`, post.likes.length);

      // ✅ FIX: Create notification with duplicate check (skip if liking own post)
      if (postOwnerObjectId.toString() !== userObjectId.toString()) {
        try {
          const user = await Auth.findById(userObjectId).select("fullName profile.username");

          // ✅ CRITICAL FIX: Check if notification already exists before creating
          const existingNotification = await Notification.findOne({
            recipient: postOwnerObjectId,
            sender: userObjectId,
            type: "like",
            post: postObjectId
          });

          if (!existingNotification) {
            await Notification.create({
              recipient: postOwnerObjectId,
              sender: userObjectId,
              type: "like",
              post: postObjectId,
              message: `${user?.fullName || user?.profile?.username || "Someone"} liked your post`,
              isRead: false,
              createdAt: new Date()
            });
            console.log(`🔔 Like notification created`);
          } else {
            console.log(`ℹ️ Like notification already exists, skipping creation`);
          }
        } catch (notifError) {
          console.log(`ℹ️ Could not create notification: ${notifError.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Post liked successfully",
        likesCount: post.likes.length,
        liked: true
      });
    }
  } catch (err) {
    console.error("❌ toggleLikePost error:", err);

    // ✅ Handle duplicate key error specifically
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate action detected. Please try again.",
        error: "Duplicate notification"
      });
    }

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

    if (!userId || !postId || !text) {
      return res.status(400).json({
        success: false,
        message: "userId, postId and text are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid IDs"
      });
    }

    let postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    // ✅ CRITICAL: Clean data BEFORE operations
    postOwner = deepCleanUserData(postOwner);

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    const commenter = await Auth.findById(userId).select("fullName profile.username");

    // Mention extraction
    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    let mentions = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const username = match[1];
      const mentionedUser = await Auth.findOne({
        "profile.username": { $regex: new RegExp(`^${username}$`, "i") }
      }).select("_id fullName");
      if (mentionedUser) mentions.push(mentionedUser._id);
    }

    const newComment = {
      userId: toObjectId(userId),
      text: String(text).trim(),
      createdAt: new Date(),
      mentions: mentions
      // DO NOT add notificationHandled here
    };

    post.comments.push(newComment);
    postOwner.markModified('posts');
    await postOwner.save({ validateBeforeSave: true });

    const updatedPost = postOwner.posts.id(postId);
    const savedComment = updatedPost.comments[updatedPost.comments.length - 1];

    console.log(`✅ Comment added by ${commenter?.fullName}`);

    // Create notification for post owner
    if (String(postOwner._id) !== String(userId)) {
      await createNotificationSafe(
        postOwner._id.toString(),
        userId,
        "comment",
        postId,
        savedComment._id,
        `${commenter?.fullName || 'Someone'} commented on your post: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`
      );
    }

    // Create notifications for mentioned users in comment
    if (mentions.length > 0) {
      for (const mId of mentions) {
        if (mId.toString() === userId) continue;

        await createNotificationSafe(
          mId.toString(),
          userId,
          "mention",
          postId,
          savedComment._id,
          `${commenter?.fullName || 'Someone'} mentioned you in a comment: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Comment added successfully ✅",
      data: savedComment
    });
  } catch (error) {
    console.error("❌ addComment error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
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
module.exports.createNotificationSafe = createNotificationSafe;