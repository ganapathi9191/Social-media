const mongoose = require("mongoose");
const { Auth } = require('../models/authModel');
const { sendFollowNotification, sendFollowRequestNotification, sendFollowApprovalNotification } = require('./notificationControllers');


const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return id;
  }
};

// ✅ CRITICAL: Clean corrupted likes arrays
const cleanLikesArray = (posts) => {
  if (!posts || !Array.isArray(posts)) return posts;
  
  return posts.map(post => {
    if (post.likes && Array.isArray(post.likes)) {
      // Extract only valid ObjectIds from likes
      post.likes = post.likes.map(like => {
        // If it's an object with _id, extract the _id
        if (like && typeof like === 'object' && like._id) {
          console.log(`🔧 Cleaning corrupted like object:`, like);
          return like._id;
        }
        // If it's already an ObjectId, return as is
        return like;
      }).filter(like => {
        // Filter out invalid entries
        const isValid = like && mongoose.Types.ObjectId.isValid(like);
        if (!isValid) {
          console.warn(`⚠️ Removing invalid like:`, like);
        }
        return isValid;
      });
    }
    
    // Also clean comments if they exist
    if (post.comments && Array.isArray(post.comments)) {
      post.comments = post.comments.map(comment => {
        // Remove notificationHandled field if it exists
        if (comment.notificationHandled !== undefined) {
          delete comment.notificationHandled;
        }
        return comment;
      });
    }
    
    return post;
  });
};

// ✅ IMPROVED createNotification function
const createNotification = async (recipient, sender, type, postId = null, commentId = null, message = "", options = {}) => {
  try {
    const { allowSelf = false, checkPreferences = false } = options;

    console.log(`\n🔔 ===== CREATING NOTIFICATION =====`);
    console.log(`📋 Type: ${type}`);
    console.log(`👤 Recipient: ${recipient}`);
    console.log(`👤 Sender: ${sender}`);
    console.log(`💬 Message: ${message}`);

    if (!recipient || !sender) {
      console.warn("⚠️ Missing recipient or sender");
      return null;
    }

    const recipientId = toObjectId(recipient);
    const senderId = toObjectId(sender);

    // Don't send notification to self
    if (!allowSelf && String(recipientId) === String(senderId)) {
      console.log("⏭️ Skipping self notification");
      return null;
    }

    // Check user preferences
    if (checkPreferences) {
      try {
        const recipientUser = await Auth.findById(recipientId).select("notificationPreferences").lean();
        if (!recipientUser) {
          console.log("⚠️ Recipient not found");
          return null;
        }
        
        const prefs = recipientUser.notificationPreferences || {};
        console.log(`🔍 Checking preferences:`, prefs);
        
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
        
        const prefKey = prefMap[type];
        if (prefKey && prefs[prefKey] === false) {
          console.log(`⏭️ User has disabled '${type}' notifications`);
          return null;
        }
        console.log(`✅ Notification preferences allow '${type}'`);
      } catch (e) {
        console.warn("⚠️ Preference check failed:", e.message);
      }
    }

    // Check for existing notification
    const existingQuery = {
      recipient: recipientId,
      sender: senderId,
      type: type
    };
    
    if (postId) {
      existingQuery.post = toObjectId(postId);
    }

    console.log(`🔍 Checking for existing notification...`);
    const existingNotif = await Notification.findOne(existingQuery);

    if (existingNotif) {
      console.log(`ℹ️ Notification already exists: ${existingNotif._id}`);
      return existingNotif;
    }

    // Create new notification
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

    console.log(`📝 Creating notification with payload:`, JSON.stringify(payload, null, 2));

    const notification = await Notification.create(payload);
    console.log(`✅ ===== NOTIFICATION CREATED: ${notification._id} =====\n`);

    // Emit real-time notification
    const io = global.io;
    if (io) {
      try {
        const populated = await Notification.findById(notification._id)
          .populate("sender", "fullName profile")
          .populate("post", "description media userId")
          .lean();
        io.to(String(recipientId)).emit("newNotification", populated);
        console.log(`📡 Real-time notification emitted`);
      } catch (e) {
        console.warn("⚠️ Socket emit failed:", e.message);
      }
    }

    return notification;
  } catch (error) {
    console.error(`\n❌ ===== NOTIFICATION CREATION FAILED =====`);
    console.error(`Error Type: ${error.name}`);
    console.error(`Error Code: ${error.code}`);
    console.error(`Error Message: ${error.message}`);
    console.error(`Stack:`, error.stack);
    console.error(`===================================\n`);
    
    if (error.code === 11000) {
      console.log(`🔍 Duplicate key error - finding existing notification...`);
      try {
        const existing = await Notification.findOne({
          recipient: toObjectId(recipient),
          sender: toObjectId(sender),
          type: type
        });
        if (existing) {
          console.log(`✅ Found existing notification: ${existing._id}`);
          return existing;
        }
      } catch (findErr) {
        console.error("❌ Error finding existing:", findErr.message);
      }
    }
    
    return null;
  }
};

// ✅ FIXED: Send Follow Request
exports.sendFollowRequest = async (req, res) => {
  try {
    const { userId, followerId } = req.body;
    
    console.log(`\n👥 ===== SEND FOLLOW REQUEST =====`);
    console.log(`User ID: ${userId}`);
    console.log(`Follower ID: ${followerId}`);

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(followerId)) {
      console.error("❌ Invalid IDs provided");
      return res.status(400).json({ success: false, message: "Invalid userId or followerId" });
    }

    if (userId === followerId) {
      return res.status(400).json({ success: false, message: "Cannot send follow request to yourself" });
    }
    
    console.log(`🔍 Finding users in database...`);
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) {
      console.error("❌ User not found");
      console.error(`User exists: ${!!user}`);
      console.error(`Follower exists: ${!!follower}`);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`✅ Found users:`);
    console.log(`   User: ${user.fullName} (${user._id})`);
    console.log(`   Follower: ${follower.fullName} (${follower._id})`);

    // Check if already following
    const isAlreadyFollowing = user.followers.some(id => id.toString() === followerId.toString());
    if (isAlreadyFollowing) {
      console.log("⚠️ Already following");
      return res.status(400).json({ success: false, message: "Already following this user" });
    }

    // Check if request already sent
    const requestAlreadyExists = user.followerRequests.some(id => id.toString() === followerId.toString());
    if (requestAlreadyExists) {
      console.log("⚠️ Request already exists");
      return res.status(400).json({ success: false, message: "Follow request already sent" });
    }

    console.log(`🔧 Cleaning corrupted data...`);
    // Clean corrupted likes data
    user.posts = cleanLikesArray(user.posts);
    follower.posts = cleanLikesArray(follower.posts);

    console.log(`📝 Adding follow request...`);
    // Add follow request
    user.followerRequests.push(new mongoose.Types.ObjectId(followerId));
    
    console.log(`💾 Saving user document...`);
    console.log(`   Current followerRequests count: ${user.followerRequests.length}`);
    
    // Save with detailed error handling
    try {
      await user.save({ validateBeforeSave: true });
      console.log(`✅ User document saved successfully!`);
      
      // Verify it was saved
      const verifyUser = await Auth.findById(userId).select('followerRequests');
      const requestExists = verifyUser.followerRequests.some(id => id.toString() === followerId.toString());
      console.log(`🔍 Verification - Request exists in DB: ${requestExists}`);
      
      if (!requestExists) {
        console.error(`❌ CRITICAL: Request was not saved to database!`);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to save follow request - data not persisted"
        });
      }
      
    } catch (saveError) {
      console.error(`❌ SAVE ERROR:`, saveError);
      console.error(`   Name: ${saveError.name}`);
      console.error(`   Message: ${saveError.message}`);
      console.error(`   Code: ${saveError.code}`);
      
      if (saveError.name === 'ValidationError') {
        console.error(`   Validation errors:`, saveError.errors);
      }
      
      return res.status(500).json({ 
        success: false, 
        message: "Failed to save follow request",
        error: saveError.message,
        errorType: saveError.name
      });
    }

    // Create notification
    let notificationCreated = false;
    let notificationId = null;
    let notificationError = null;

    console.log(`\n🔔 Creating follow request notification...`);
    
    try {
      const notification = await createNotification(
        userId,
        followerId,
        "follow_request",
        null,
        null,
        `${follower.fullName} sent you a follow request`,
        { allowSelf: false, checkPreferences: true }
      );
      
      if (notification) {
        notificationCreated = true;
        notificationId = notification._id;
        console.log(`✅ Notification created: ${notificationId}`);
      } else {
        notificationError = "createNotification returned null";
        console.warn(`⚠️ ${notificationError}`);
      }
    } catch (error) {
      notificationError = error.message;
      console.error(`❌ Notification error: ${notificationError}`);
    }

    console.log(`✅ ===== FOLLOW REQUEST COMPLETE =====\n`);

    res.status(200).json({ 
      success: true, 
      message: "Follow request sent successfully",
      data: {
        userId,
        followerId,
        followerName: follower.fullName,
        requestSavedToDatabase: true,
        notificationCreated,
        notificationId,
        notificationError
      }
    });
  } catch (error) {
    console.error("\n❌ ===== SEND FOLLOW REQUEST FAILED =====");
    console.error(error);
    console.error("=====================================\n");
    
    res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ✅ FIXED: Approve Follow Request
exports.approveFollowRequest = async (req, res) => {
  try {
    const { userId, requesterId } = req.body;
    
    console.log(`\n✅ ===== APPROVE FOLLOW REQUEST =====`);
    console.log(`User ID: ${userId}`);
    console.log(`Requester ID: ${requesterId}`);

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(requesterId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or requesterId" });
    }
    
    const user = await Auth.findById(userId);
    const requester = await Auth.findById(requesterId);

    if (!user || !requester) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`✅ Found users:`);
    console.log(`   User: ${user.fullName}`);
    console.log(`   Requester: ${requester.fullName}`);

    // Check if request exists
    const requestExists = user.followerRequests.some(id => id.toString() === requesterId.toString());
    if (!requestExists) {
      console.log("⚠️ No follow request found");
      return res.status(400).json({ success: false, message: "No follow request found" });
    }

    console.log(`🔧 Cleaning corrupted data...`);
    user.posts = cleanLikesArray(user.posts);
    requester.posts = cleanLikesArray(requester.posts);

    console.log(`📝 Moving request to followers/following...`);
    // Move to followers/following
    user.followerRequests.pull(requesterId);
    user.followers.push(new mongoose.Types.ObjectId(requesterId));
    requester.following.push(new mongoose.Types.ObjectId(userId));

    console.log(`💾 Saving documents...`);
    try {
      await user.save({ validateBeforeSave: true });
      await requester.save({ validateBeforeSave: true });
      console.log(`✅ Documents saved successfully`);
    } catch (saveError) {
      console.error(`❌ Save error:`, saveError.message);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to approve follow request",
        error: saveError.message 
      });
    }

    // Create notification
    let notificationCreated = false;
    let notificationId = null;
    let notificationError = null;

    console.log(`\n🔔 Creating follow approval notification...`);
    
    try {
      const notification = await createNotification(
        requesterId,
        userId,
        "follow_approval", 
        null,
        null,
        `${user.fullName} approved your follow request`,
        { allowSelf: false, checkPreferences: true }
      );
      
      if (notification) {
        notificationCreated = true;
        notificationId = notification._id;
      } else {
        notificationError = "createNotification returned null";
      }
    } catch (error) {
      notificationError = error.message;
      console.error(`❌ Notification error: ${notificationError}`);
    }

    console.log(`✅ ===== FOLLOW REQUEST APPROVED =====\n`);

    res.status(200).json({ 
      success: true, 
      message: "Follow request approved",
      data: {
        userId,
        requesterId,
        notificationCreated,
        notificationId,
        notificationError
      }
    });
  } catch (error) {
    console.error("\n❌ ===== APPROVE FOLLOW REQUEST FAILED =====");
    console.error(error);
    res.status(500).json({ 
      success: false, 
      message: error.message
    });
  }
};

// ✅ Reject Follow Request
exports.rejectFollowRequest = async (req, res) => {
  try {
    const { userId, followerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(followerId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or followerId" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const followerObjectId = new mongoose.Types.ObjectId(followerId);
    const requestIndex = user.followerRequests.findIndex(
      id => id.toString() === followerObjectId.toString()
    );

    if (requestIndex === -1) {
      return res.status(400).json({ success: false, message: "No follow request found" });
    }

    user.posts = cleanLikesArray(user.posts);
    user.followerRequests.splice(requestIndex, 1);
    
    await user.save({ validateBeforeSave: true });

    return res.status(200).json({ success: true, message: "Follow request rejected" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: error.message 
    });
  }
};

// ✅ Get followers (+ pending)
exports.getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await Auth.findById(userId)
      .populate("followers", "fullName username")
      .populate("followerRequests", "fullName username");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      followers: user.followers,
      pendingRequests: user.followerRequests
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get following
exports.getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await Auth.findById(userId).populate("following", "fullName username");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, following: user.following });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Get all followers across all users
exports.getAllFollowers = async (req, res) => {
  try {
    const users = await Auth.find().populate("followers", "fullName username email");
    let allFollowers = [];

    users.forEach(user => {
      allFollowers.push({ userId: user._id, followers: user.followers });
    });

    res.status(200).json({ success: true, allFollowers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get all following across all users
exports.getAllFollowing = async (req, res) => {
  try {
    const users = await Auth.find().populate("following", "fullName username email");
    let allFollowing = [];

    users.forEach(user => {
      allFollowing.push({ userId: user._id, following: user.following });
    });

    res.status(200).json({ success: true, allFollowing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllRequests = async (req, res) => {
  try {
    const users = await Auth.find().populate("followerRequests", "fullName username email");
    let allRequests = [];

    users.forEach(user => {
      if (user.followerRequests.length > 0) {
        allRequests.push({ userId: user._id, requests: user.followerRequests });
      }
    });

    res.status(200).json({ success: true, allRequests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Get a specific follower request by requester's ID
exports.getRequestById = async (req, res) => {
  try {
    const { userId, requesterId } = req.params;
    const user = await Auth.findById(userId).populate("followerRequests", "fullName username email");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const request = user.followerRequests.find(req => req._id.toString() === requesterId);
    if (!request) return res.status(404).json({ success: false, message: "Request not found" });

    res.status(200).json({ success: true, request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Get pending requests only
exports.getRequests = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await Auth.findById(userId).populate("followerRequests", "fullName username");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, requests: user.followerRequests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get blocked followers
exports.Blocked = async (req, res) => {
  try {
    const { userId, blockUserId } = req.body;

    // Find both users
    const user = await Auth.findById(userId);
    const targetUser = await Auth.findById(blockUserId);

    if (!user || !targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Remove from followers & following
    user.followers.pull(blockUserId);
    user.following.pull(blockUserId);

    // Optional: Remove current user from targetUser's followers/following
    targetUser.followers.pull(userId);
    targetUser.following.pull(userId);

    // Add to blockedFollowers if not already blocked
    if (!user.blockedFollowers.includes(blockUserId)) {
      user.blockedFollowers.push(blockUserId);
    }

    await user.save();
    await targetUser.save();

    res.status(200).json({ success: true, message: "User blocked successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Get blocked users for a specific user
exports.getBlockedByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await Auth.findById(userId).populate("blockedFollowers", "fullName username email");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, blocked: user.blockedFollowers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get all blocked users across all users
exports.getAllBlocked = async (req, res) => {
  try {
    const users = await Auth.find().populate("blockedFollowers", "fullName username email");
    let allBlocked = [];

    users.forEach(user => {
      allBlocked.push({ userId: user._id, blocked: user.blockedFollowers });
    });

    res.status(200).json({ success: true, allBlocked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Remove follower
exports.removeFollower = async (req, res) => {
  try {
    const { userId, followerId } = req.params; // get IDs from URL
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower)
      return res.status(404).json({ success: false, message: "User not found" });

    user.followers.pull(followerId);
    follower.following.pull(userId);

    await user.save();
    await follower.save();

    res.status(200).json({ success: true, message: "Follower removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Remove following
exports.removeFollowing = async (req, res) => {
  try {
    const { userId, followingId } = req.params; // get IDs from URL
    const user = await Auth.findById(userId);
    const followingUser = await Auth.findById(followingId);

    if (!user || !followingUser)
      return res.status(404).json({ success: false, message: "User not found" });

    user.following.pull(followingId);
    followingUser.followers.pull(userId);

    await user.save();
    await followingUser.save();

    res.status(200).json({ success: true, message: "Following removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Unblock using body (POST/PUT)
exports.unblockFollower = async (req, res) => {
  try {
    const { userId, followerId } = req.body;
    const user = await Auth.findById(userId);

    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    user.blockedFollowers.pull(followerId);
    await user.save();

    res.status(200).json({ success: true, message: "Follower unblocked successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Unblock using params (DELETE)
exports.unblockFollowerByParams = async (req, res) => {
  try {
    const { userId, followerId } = req.params;
    const user = await Auth.findById(userId);

    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    user.blockedFollowers.pull(followerId);
    await user.save();

    res.status(200).json({ success: true, message: "Follower unblocked successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Get follow status
exports.getFollowStatus = async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const user = await Auth.findById(userId);

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let status = "not_following";
    if (user.following.includes(otherUserId)) status = "following";
    if (user.followerRequests.includes(otherUserId)) status = "requested";
    if (user.blockedFollowers.includes(otherUserId)) status = "blocked";

    res.status(200).json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkFollowStatus = async (req, res) => {
  try {
    const { userId, targetId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(targetId))
      return res.status(400).json({ success: false, message: "Invalid IDs" });

    const user = await Auth.findById(userId);

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const isFollowing = user.following.includes(targetId);
    const isRequested = user.followerRequests.includes(targetId);

    res.status(200).json({
      success: true,
      following: isFollowing,
      requested: isRequested
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


// Get posts where user mentioned others
exports.getPostsWithUserMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Find all posts created by this user that have mentions
    const user = await Auth.findById(userId)
      .populate("posts.mentions", "fullName profile.username profile.image");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const postsWithMentions = user.posts.filter(post => 
      post.mentions && post.mentions.length > 0
    );

    // Sort by creation date (newest first)
    postsWithMentions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      message: "Posts with mentions fetched successfully",
      data: postsWithMentions
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get posts where user is mentioned
exports.getPostMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Find all posts where the user is mentioned
    const usersWithMentions = await Auth.find({ 
      "posts.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image");

    const mentionedPosts = [];
    usersWithMentions.forEach(user => {
      user.posts.forEach(post => {
        if (post.mentions.includes(userId)) {
          mentionedPosts.push(post);
        }
      });
    });

    // Sort by creation date (newest first)
    mentionedPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      message: "Mentioned posts fetched successfully",
      data: mentionedPosts
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get comments where user is mentioned
exports.getCommentMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Find all posts with comments where the user is mentioned
    const usersWithMentions = await Auth.find({ 
      "posts.comments.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image");

    const mentionedComments = [];
    usersWithMentions.forEach(user => {
      user.posts.forEach(post => {
        post.comments.forEach(comment => {
          if (comment.mentions && comment.mentions.includes(userId)) {
            mentionedComments.push({
              postId: post._id,
              postDescription: post.description,
              comment: comment
            });
          }
        });
      });
    });

    // Sort by creation date (newest first)
    mentionedComments.sort((a, b) => new Date(b.comment.createdAt) - new Date(a.comment.createdAt));

    res.status(200).json({
      success: true,
      message: "Mentioned comments fetched successfully",
      data: mentionedComments
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get all mentions for a user (both posts and comments)
exports.getAllMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Get post mentions
    const usersWithPostMentions = await Auth.find({ 
      "posts.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image");

    const postMentions = [];
    usersWithPostMentions.forEach(user => {
      user.posts.forEach(post => {
        if (post.mentions.includes(userId)) {
          postMentions.push(post);
        }
      });
    });

    // Get comment mentions
    const usersWithCommentMentions = await Auth.find({ 
      "posts.comments.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image");

    const commentMentions = [];
    usersWithCommentMentions.forEach(user => {
      user.posts.forEach(post => {
        post.comments.forEach(comment => {
          if (comment.mentions && comment.mentions.includes(userId)) {
            commentMentions.push({
              postId: post._id,
              postDescription: post.description,
              comment: comment
            });
          }
        });
      });
    });

    // Sort by creation date (newest first)
    postMentions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    commentMentions.sort((a, b) => new Date(b.comment.createdAt) - new Date(a.comment.createdAt));

    res.status(200).json({
      success: true,
      message: "All mentions fetched successfully",
      data: {
        postMentions,
        commentMentions
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Remove mention from post
exports.removePostMention = async (req, res) => {
  try {
    const { userId, postId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || 
        !mongoose.Types.ObjectId.isValid(postId) || 
        !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Remove the mention
    post.mentions = post.mentions.filter(mentionId => mentionId.toString() !== userId);
    await postOwner.save();

    res.status(200).json({
      success: true,
      message: "Mention removed from post successfully"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Remove mention from comment
exports.removeCommentMention = async (req, res) => {
  try {
    const { userId, postId, commentId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || 
        !mongoose.Types.ObjectId.isValid(postId) || 
        !mongoose.Types.ObjectId.isValid(commentId) || 
        !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    // Remove the mention
    if (comment.mentions) {
      comment.mentions = comment.mentions.filter(mentionId => mentionId.toString() !== userId);
      await postOwner.save();
    }

    res.status(200).json({
      success: true,
      message: "Mention removed from comment successfully"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

module.exports.createNotification = createNotification;