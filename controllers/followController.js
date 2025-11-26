const mongoose = require("mongoose");
const { Auth } = require('../models/authModel');
const { sendFollowNotification, sendFollowRequestNotification, sendFollowApprovalNotification } = require('./notificationControllers');


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
// Send Follow Request
exports.sendFollowRequest = async (req, res) => {
   try {
    const { userId, followerId } = req.body;
    
    console.log(`👥 Follow request:`, { userId, followerId });
    
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Already following
    if (user.followers.includes(followerId)) {
      return res.status(400).json({ success: false, message: "Already following this user" });
    }

    // Already requested
    if (user.followerRequests.includes(followerId)) {
      return res.status(400).json({ success: false, message: "Follow request already sent" });
    }

    user.followerRequests.push(followerId);
    await user.save();

    // 🔥 AUTOMATICALLY CREATE NOTIFICATION FOR USER BEING FOLLOWED
    try {
      const notification = await createNotification(
        userId, // User receiving the follow request
        followerId, // User sending the request
        "follow_request",
        null,
        null,
        `${follower.fullName} sent you a follow request`,
        { allowSelf: false, checkPreferences: true }
      );
      
      if (notification) {
        console.log(`✅ Follow request notification created:`, notification._id);
      }
    } catch (error) {
      console.error(`🚨 Error creating follow request notification:`, error.message);
    }

    res.status(200).json({ 
      success: true, 
      message: "Follow request sent",
      debug: {
        notificationCreated: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// FIXED approveFollowRequest function
exports.approveFollowRequest = async (req, res) => {
  try {
    const { userId, requesterId } = req.body;
    
    console.log(`✅ Approve follow request:`, { userId, requesterId });
    
    const user = await Auth.findById(userId);
    const requester = await Auth.findById(requesterId);

    if (!user || !requester) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.followerRequests.includes(requesterId)) {
      return res.status(400).json({ success: false, message: "No follow request found" });
    }

    // Move to followers/following
    user.followerRequests.pull(requesterId);
    user.followers.push(requesterId);
    requester.following.push(userId);

    await user.save();
    await requester.save();

    // 🔥 AUTOMATICALLY CREATE NOTIFICATION FOR REQUESTER
    try {
      const notification = await createNotification(
        requesterId, // User who sent the request
        userId, // User who approved it
        "follow_approval", 
        null,
        null,
        `${user.fullName} approved your follow request`,
        { allowSelf: false, checkPreferences: true }
      );
      
      if (notification) {
        console.log(`✅ Follow approval notification created:`, notification._id);
      }
    } catch (error) {
      console.error(`🚨 Error creating follow approval notification:`, error.message);
    }

    res.status(200).json({ 
      success: true, 
      message: "Follow request approved",
      debug: {
        notificationCreated: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Approve Follow Request
exports.approveFollowRequest = async (req, res) => {
  try {
    const { userId, requesterId } = req.body; // userId = current user approving, requesterId = who sent request
    const user = await Auth.findById(userId);
    const requester = await Auth.findById(requesterId);

    if (!user || !requester) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.followerRequests.includes(requesterId)) {
      return res.status(400).json({ success: false, message: "No follow request found" });
    }

    // Move to followers/following
    user.followerRequests.pull(requesterId);
    user.followers.push(requesterId);
    requester.following.push(userId);

    await user.save();
    await requester.save();

    res.status(200).json({ success: true, message: "Follow request approved" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reject Follow Request
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

    // Convert followerId to ObjectId for comparison
    const followerObjectId = new mongoose.Types.ObjectId(followerId);

    // Check if followerId exists in followerRequests
    const requestIndex = user.followerRequests.findIndex(
      id => id.toString() === followerObjectId.toString()
    );

    if (requestIndex === -1) {
      return res.status(400).json({ success: false, message: "No follow request found" });
    }

    // Remove the follower from followerRequests
    user.followerRequests.splice(requestIndex, 1);
    await user.save();

    return res.status(200).json({ success: true, message: "Follow request rejected" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
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