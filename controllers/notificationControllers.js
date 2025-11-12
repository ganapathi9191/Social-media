const mongoose = require("mongoose");
const { Auth, Notification, Post } = require('../models/authModel'); // ✅ Import Post
const { Message, Chat } = require('../models/messageModel');

// ===== HELPER FUNCTIONS =====
/* -------------------------------------------------------------------------- */
/* ✅ HELPER: ENSURE UNIQUE NOTIFICATION (Fixed to handle existing records)   */
/* -------------------------------------------------------------------------- */
const ensureDbNotification = async (
  recipient,
  sender,
  type,
  postId = null,
  commentId = null,
  message = ""
) => {
  try {
    const query = { 
      recipient, 
      sender, 
      type,
      isDeleted: false 
    };
    
    if (postId) query.post = postId;
    if (commentId) query["reference.commentId"] = commentId;

    // ✅ Try to find existing notification first
    let notification = await Notification.findOne(query);

    if (!notification) {
      // ✅ Only create if it doesn't exist
      try {
        notification = await Notification.create({
          recipient,
          sender,
          type,
          post: postId,
          reference: { commentId },
          message,
          isRead: false,
          createdAt: new Date(),
        });
        console.log(`🆕 Created new notification (${type}) - ID: ${notification._id}`);
      } catch (createError) {
        // ✅ Handle race condition - if another request created it simultaneously
        if (createError.code === 11000) {
          console.log(`⚠️ Notification already exists (race condition), fetching...`);
          notification = await Notification.findOne(query);
        } else {
          throw createError;
        }
      }
    } else {
      console.log(`✅ Notification already exists (${type}) - ID: ${notification._id}`);
    }

    return notification;
  } catch (error) {
    console.error(`❌ Error in ensureDbNotification:`, error.message);
    throw error;
  }
};

// ===== UTILITY FUNCTION =====
const getDisplayMessage = (type, fullName, username) => {
  const name = fullName || username || 'Someone';
  const messages = {
    like: `${name} liked your post`,
    comment: `${name} commented on your post`,
    follow: `${name} started following you`,
    follow_request: `${name} requested to follow you`,
    follow_approval: `${name} accepted your follow request`,
    follow_reject: `${name} rejected your follow request`,
    mention: `${name} mentioned you in a post`,
    post: `${name} created a new post`,
    message: `${name} sent you a message`
  };
  return messages[type] || 'New notification';
};

// ===== MAIN CONTROLLERS =====

// Get comments where user is mentioned
exports.getMentionedComments = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const mentionedComments = await Auth.aggregate([
      { $unwind: "$posts" },
      { $unwind: "$posts.comments" },
      {
        $match: {
          "posts.comments.mentions": { $elemMatch: { $eq: new mongoose.Types.ObjectId(userId) } }
        }
      },
      {
        $lookup: {
          from: "auths",
          localField: "posts.comments.userId",
          foreignField: "_id",
          as: "commentUser"
        }
      },
      {
        $lookup: {
          from: "auths",
          localField: "posts.comments.mentions",
          foreignField: "_id",
          as: "mentionedUsers"
        }
      },
      {
        $project: {
          postId: "$posts._id",
          postDescription: "$posts.description",
          comment: "$posts.comments",
          postOwner: {
            _id: "$_id",
            username: "$profile.username",
            fullName: "$fullName"
          },
          commentUser: { $arrayElemAt: ["$commentUser", 0] },
          mentionedUsers: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Mentioned comments fetched successfully",
      data: mentionedComments
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get all notifications for a user (from database only)
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const objectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;

    // Try to find any field that stores the receiver ID
    const possibleFields = ["recipient", "userId", "to", "receiver", "targetId"];

    let notifications = [];
    for (const field of possibleFields) {
      const query = {};
      query[field] = objectId || userId;

      const found = await Notification.find(query)
        .populate("sender", "fullName profile.username profile.image")
        .sort({ createdAt: -1 })
        .lean();

      if (found.length > 0) {
        notifications = found;
        console.log(`✅ Found notifications by field: ${field}`);
        break;
      }
    }

    if (notifications.length === 0) {
      console.log("⚠️ No notifications found for any known field");
      return res.status(200).json({
        success: true,
        message: "No notifications found for this user",
        data: []
      });
    }

    // Format clean output
    const formatted = notifications.map((n) => ({
      _id: n._id,
      type: n.type || n.actionType || "general",
      message: n.message || n.text || "New notification",
      sender: n.sender || {},
      isRead: n.isRead || false,
      createdAt: n.createdAt,
      content: n.content || {},
      reference: n.reference || {},
      source: "database"
    }));

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully ✅",
      total: formatted.length,
      data: formatted
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
      error: error.message
    });
  }
};

// Mark single notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    const updated = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: "Notification not found" });

    res.status(200).json({ success: true, message: "Notification marked as read", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Mark all notifications as read (DATABASE ONLY)
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { updatedCount: result.modifiedCount },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ✅ FIXED: Delete notification AND the actual source data (like/comment/mention)
exports.deleteNotification = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { notificationId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    console.log(`🗑️ Attempting to delete notification: ${notificationId}`);

    // 1️⃣ Find the notification first
    const notification = await Notification.findById(notificationId).session(session);
    if (!notification) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    console.log(`📋 Notification details:`, {
      type: notification.type,
      post: notification.post,
      sender: notification.sender,
      recipient: notification.recipient,
      commentId: notification.reference?.commentId
    });

    let deletionDetails = {
      notificationDeleted: false,
      sourceDataDeleted: false,
      details: ""
    };

    // 2️⃣ Delete the SOURCE DATA first (the actual like/comment/mention)
    if (notification.type === "comment" && notification.reference?.commentId && notification.post) {
      // Find the post owner and remove the comment
      const result = await Auth.findOneAndUpdate(
        { "posts._id": notification.post },
        { 
          $pull: { 
            "posts.$.comments": { _id: notification.reference.commentId } 
          } 
        },
        { new: true, session }
      );
      
      if (result) {
        deletionDetails.sourceDataDeleted = true;
        deletionDetails.details = "Comment removed from post";
        console.log(`🧹 Comment deleted from post owner's data`);
      }
    }

    if (notification.type === "like" && notification.post && notification.sender) {
      // Remove the like entry from the post
      const result = await Auth.findOneAndUpdate(
        { "posts._id": notification.post },
        { 
          $pull: { 
            "posts.$.likes": { userId: notification.sender } 
          } 
        },
        { new: true, session }
      );
      
      if (result) {
        deletionDetails.sourceDataDeleted = true;
        deletionDetails.details = "Like removed from post";
        console.log(`🧹 Like deleted from post owner's data`);
      }
    }

    if (notification.type === "mention" && notification.post && notification.recipient) {
      // Remove mention from the post
      const result = await Auth.findOneAndUpdate(
        { "posts._id": notification.post },
        { 
          $pull: { 
            "posts.$.mentions": notification.recipient 
          } 
        },
        { new: true, session }
      );
      
      if (result) {
        deletionDetails.sourceDataDeleted = true;
        deletionDetails.details = "Mention removed from post";
        console.log(`🧹 Mention deleted from post owner's data`);
      }
    }

    if (notification.type === "follow_request" && notification.sender && notification.recipient) {
      // Remove follow request from recipient's followerRequests array
      const result = await Auth.findByIdAndUpdate(
        notification.recipient,
        { 
          $pull: { 
            followerRequests: notification.sender 
          } 
        },
        { new: true, session }
      );
      
      if (result) {
        deletionDetails.sourceDataDeleted = true;
        deletionDetails.details = "Follow request removed";
        console.log(`🧹 Follow request deleted from user data`);
      }
    }

    if (notification.type === "follow" && notification.sender && notification.recipient) {
      // Unfollow - remove from both followers and following arrays
      await Auth.findByIdAndUpdate(
        notification.recipient,
        { $pull: { followers: notification.sender } },
        { session }
      );
      
      const result = await Auth.findByIdAndUpdate(
        notification.sender,
        { $pull: { following: notification.recipient } },
        { session }
      );
      
      if (result) {
        deletionDetails.sourceDataDeleted = true;
        deletionDetails.details = "Follow relationship removed";
        console.log(`🧹 Follow relationship deleted`);
      }
    }

    if (notification.type === "message" && notification.reference?.chatId) {
      // Delete the actual message
      const messageDeleted = await Message.findByIdAndDelete(notification.reference.chatId).session(session);
      if (messageDeleted) {
        deletionDetails.sourceDataDeleted = true;
        deletionDetails.details = "Message deleted";
        console.log(`🧹 Message deleted`);
      }
    }

    // 3️⃣ Finally, delete the notification itself
    await Notification.findByIdAndDelete(notificationId).session(session);
    deletionDetails.notificationDeleted = true;
    console.log(`✅ Notification record deleted from database`);

    // 4️⃣ Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Notification and source data deleted successfully ✅",
      data: {
        deletedNotificationId: notificationId,
        notificationType: notification.type,
        ...deletionDetails
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error deleting notification:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

// Get unread notification count
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const count = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    res.status(200).json({
      success: true,
      message: "Unread count fetched successfully",
      data: { unreadCount: count }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Update Notification Preferences
exports.updateNotificationPreferences = async (req, res) => {
  try {
    const { userId, preferences } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (preferences) {
      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...preferences
      };
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Notification preferences updated successfully",
      data: user.notificationPreferences
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get Notification Preferences
exports.getNotificationPreferences = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId).select('notificationPreferences');
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification preferences fetched successfully",
      data: user.notificationPreferences
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get ONLY NEW/UNREAD notifications for popup
exports.getLivepopupNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    console.log(`📥 Fetching NEW notifications for popup - User: ${userId}`);

    // Get ONLY UNREAD notifications from database
    const unreadNotifications = await Notification.find({ 
      recipient: userId, 
      isRead: false 
    })
    .populate("sender", "fullName profile.username profile.image")
    .populate("post", "description media")
    .sort({ createdAt: -1 })
    .lean();

    console.log(`✅ Found ${unreadNotifications.length} new notifications`);

    // Format notifications
    const formattedNotifications = unreadNotifications.map(notif => {
      const displayMessage = getDisplayMessage(
        notif.type, 
        notif.sender?.fullName, 
        notif.sender?.profile?.username
      );
      
      return {
        _id: notif._id,
        type: notif.type,
        message: displayMessage,
        sender: notif.sender,
        post: notif.post,
        reference: notif.reference,
        content: notif.content,
        createdAt: notif.createdAt,
        isRead: notif.isRead,
        isNew: true
      };
    });

    // Count by type
    const typeCounts = {
      like: formattedNotifications.filter(n => n.type === 'like').length,
      comment: formattedNotifications.filter(n => n.type === 'comment').length,
      follow: formattedNotifications.filter(n => n.type === 'follow').length,
      follow_request: formattedNotifications.filter(n => n.type === 'follow_request').length,
      mention: formattedNotifications.filter(n => n.type === 'mention').length,
      post: formattedNotifications.filter(n => n.type === 'post').length,
      follow_approval: formattedNotifications.filter(n => n.type === 'follow_approval').length,
      message: formattedNotifications.filter(n => n.type === 'message').length
    };

    res.status(200).json({
      success: true,
      message: "New notifications fetched successfully",
      data: {
        total: formattedNotifications.length,
        notifications: formattedNotifications,
        typeCounts,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error("❌ Error in getLivepopupNotifications:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

// ✅ FIXED: MAIN NOTIFICATION FETCHER - DON'T AUTO-CREATE, ONLY FETCH
exports.getAllLiveNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, page = 1, filter = "all" } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    console.log(`📥 Fetching notifications for user: ${userId}`);

    // 1️⃣ Query base notifications
    let query = { recipient: userId, isDeleted: { $ne: true } };
    if (filter !== "all") query.type = filter;

    // 2️⃣ Fetch existing notifications ONLY (don't create new ones automatically)
    const notifications = await Notification.find(query)
      .populate("sender", "fullName profile.username profile.image")
      .populate("post", "description media")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    console.log(`✅ Found ${notifications.length} existing notifications`);

    // 3️⃣ Counts + Pagination
    const totalCount = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ ...query, isRead: false });

    res.status(200).json({
      success: true,
      message: "Notifications fetched successfully ✅",
      data: {
        notifications: notifications,
        counts: { total: totalCount, unread: unreadCount },
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
        },
      },
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("❌ Error in getAllLiveNotifications:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ✅ NEW: Manual sync endpoint - call this ONLY when you want to create notifications
exports.syncNotificationsFromPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    console.log('🔄 Starting manual notification sync for user:', userId);

    const user = await Auth.findById(userId)
      .select("posts")
      .populate("posts.likes.userId posts.comments.userId")
      .lean();

    if (!user || !user.posts) {
      return res.status(404).json({ success: false, message: "User or posts not found" });
    }

    let syncedCount = 0;
    let skippedCount = 0;

    for (const post of user.posts) {
      // Sync Likes
      if (post.likes && post.likes.length > 0) {
        for (const like of post.likes) {
          const senderId = like.userId?._id || like.userId || like;
          if (senderId.toString() !== userId) {
            try {
              await ensureDbNotification(userId, senderId, "like", post._id, null, "liked your post");
              syncedCount++;
            } catch (err) {
              if (err.code === 11000) {
                skippedCount++;
              } else {
                console.error(`❌ Error syncing like notification:`, err.message);
              }
            }
          }
        }
      }

      // Sync Comments
      if (post.comments && post.comments.length > 0) {
        for (const comment of post.comments) {
          const commentUserId = comment.userId?._id || comment.userId;
          if (commentUserId && commentUserId.toString() !== userId) {
            try {
              await ensureDbNotification(
                userId,
                commentUserId,
                "comment",
                post._id,
                comment._id,
                "commented on your post"
              );
              syncedCount++;
            } catch (err) {
              if (err.code === 11000) {
                skippedCount++;
              } else {
                console.error(`❌ Error syncing comment notification:`, err.message);
              }
            }
          }
        }
      }

      // Sync Mentions
      if (post.mentions && post.mentions.length > 0) {
        for (const mention of post.mentions) {
          const mentionId = mention._id || mention;
          if (mentionId.toString() === userId) {
            try {
              await ensureDbNotification(
                userId,
                post.userId,
                "mention",
                post._id,
                null,
                "mentioned you in a post"
              );
              syncedCount++;
            } catch (err) {
              if (err.code === 11000) {
                skippedCount++;
              } else {
                console.error(`❌ Error syncing mention notification:`, err.message);
              }
            }
          }
        }
      }
    }

    console.log(`✅ Sync complete - Created: ${syncedCount}, Skipped: ${skippedCount}`);

    res.status(200).json({
      success: true,
      message: "Notifications synced successfully",
      data: { 
        created: syncedCount, 
        skipped: skippedCount,
        total: syncedCount + skippedCount
      }
    });

  } catch (error) {
    console.error("❌ Error syncing notifications:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};