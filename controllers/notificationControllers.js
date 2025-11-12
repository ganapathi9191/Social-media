const mongoose = require("mongoose");
const { Auth, Notification } = require('../models/authModel');
const { Message, Chat } = require('../models/messageModel');

// ===== HELPER FUNCTIONS =====


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
      const sample = await Notification.findOne().lean();
      console.log("🔍 Example notification structure:", sample);
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
    const { reference } = req.body || {};

    if (notificationId && mongoose.Types.ObjectId.isValid(notificationId)) {
      const notification = await Notification.findByIdAndUpdate(
        notificationId,
        { isRead: true, readAt: new Date() },
        { new: true }
      );
      if (notification) {
        return res.status(200).json({ success: true, message: "Notification marked as read", data: notification });
      }
    }

    // fallback: try to update by reference (type + recipient + commentId/postId + sender)
    if (reference && reference.recipient && (reference.commentId || reference.postId)) {
      const query = { recipient: reference.recipient };
      if (reference.commentId) query['reference.commentId'] = reference.commentId;
      if (reference.postId) query.post = reference.postId;
      if (reference.type) query.type = reference.type;
      if (reference.senderId) query.sender = reference.senderId;

      const notification = await Notification.findOneAndUpdate(query, { isRead: true, readAt: new Date() }, { new: true });
      if (notification) {
        return res.status(200).json({ success: true, message: "Notification marked as read", data: notification });
      }
    }

    return res.status(404).json({ success: false, message: "Notification not found to mark read" });
  } catch (error) {
    console.error("❌ Error marking notification as read:", error);
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

    // Mark ALL unread notifications as read for this user
    const result = await Notification.updateMany(
      { 
        recipient: userId,
        isRead: false 
      },
      { 
        isRead: true,
        readAt: new Date()
      }
    );

    console.log(`✅ Marked ${result.modifiedCount} notifications as read for user: ${userId}`);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: {
        markedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error("❌ Error in markAllAsRead:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

// // Mark notifications by type as read
// exports.markNotificationsByTypeAsRead = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const { type } = req.body; // 'like', 'comment', 'follow', 'message', etc.

//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return res.status(400).json({ success: false, message: "Invalid userId" });
//     }

//     const query = { 
//       recipient: userId,
//       isRead: false 
//     };

//     if (type && type !== 'all') {
//       query.type = type;
//     }

//     const result = await Notification.updateMany(
//       query,
//       { 
//         isRead: true,
//         readAt: new Date()
//       }
//     );

//     console.log(`✅ Marked ${result.modifiedCount} ${type || 'all'} notifications as read`);

//     res.status(200).json({
//       success: true,
//       message: `${type || 'All'} notifications marked as read`,
//       data: {
//         markedCount: result.modifiedCount,
//         type: type || 'all'
//       }
//     });

//   } catch (error) {
//     console.error("❌ Error marking notifications by type:", error);
//     res.status(500).json({ 
//       success: false, 
//       message: "Server error", 
//       error: error.message 
//     });
//   }
// };

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    const notification = await Notification.findByIdAndDelete(notificationId);

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
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

// ===== MAIN NOTIFICATION FETCHER WITH FILTERS =====
exports.getAllLiveNotifications = async (req, res) => {
   try {
    const { userId } = req.params;
    const { 
      limit = 50, 
      page = 1, 
      filter = "all", 
      timeRange = "all" 
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ---- Time filter ----
    let startDate = new Date(0);
    if (timeRange === "24h") startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (timeRange === "7d") startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (timeRange === "30d") startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    console.log(`📥 Fetching notifications for user: ${userId} | Filter: ${filter}`);

    // ---- Helpers ----
    const createKey = (type, senderId, postId, commentId) =>
      `${type}-${senderId || "null"}-${postId || "null"}-${commentId || "null"}`;

    const notificationsMap = new Map();

    const addNotification = (notif) => {
      const key = createKey(
        notif.type,
        notif.sender?._id,
        notif.post?._id || notif.postData?._id,
        notif.reference?.commentId
      );
      if (!notificationsMap.has(key)) {
        notificationsMap.set(key, notif);
      }
    };

    // ---- Step 1: Load all existing notifications from DB ----
    const dbNotifications = await Notification.find({ recipient: userId })
      .populate("sender", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .lean();

    dbNotifications.forEach((notif) => {
      addNotification({
        _id: notif._id,
        type: notif.type,
        message: notif.message,
        sender: notif.sender,
        post: notif.post,
        reference: notif.reference,
        isRead: notif.isRead,
        createdAt: notif.createdAt,
        source: "database"
      });
    });

    // ---- Step 2: Fetch user + posts ----
    const currentUser = await Auth.findById(userId)
      .select("fullName profile followers following posts")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ---- Helper: Ensure DB notification exists ----
    const ensureDbNotification = async (recipient, sender, type, postId, commentId, message) => {
      const query = { recipient, sender, type };
      if (postId) query.post = postId;
      if (commentId) query["reference.commentId"] = commentId;

      let existing = await Notification.findOne(query);
      if (!existing) {
        existing = await Notification.create({
          recipient,
          sender,
          type,
          post: postId || null,
          reference: { commentId: commentId || null },
          message,
          isRead: false
        });
      }
      return existing;
    };

    // ---- Step 3: Add live likes/comments/mentions to DB if missing ----

    for (const post of currentUser.posts || []) {
      // Likes
      for (const likerId of post.likes || []) {
        if (likerId.toString() === userId) continue;
        const liker = await Auth.findById(likerId).select("fullName profile").lean();
        const msg = `${liker?.fullName || "Someone"} liked your post`;
        const dbNotif = await ensureDbNotification(userId, likerId, "like", post._id, null, msg);
        addNotification({
          _id: dbNotif._id,
          type: "like",
          message: msg,
          sender: liker,
          post: { _id: post._id, description: post.description },
          isRead: dbNotif.isRead,
          createdAt: dbNotif.createdAt,
          source: "database"
        });
      }

      // Comments
      for (const comment of post.comments || []) {
        if (comment.userId.toString() === userId) continue;
        const commenter = await Auth.findById(comment.userId).select("fullName profile").lean();
        const msg = `${commenter?.fullName || "Someone"} commented on your post`;
        const dbNotif = await ensureDbNotification(userId, comment.userId, "comment", post._id, comment._id, msg);
        addNotification({
          _id: dbNotif._id,
          type: "comment",
          message: msg,
          sender: commenter,
          post: { _id: post._id, description: post.description },
          reference: { commentId: comment._id },
          isRead: dbNotif.isRead,
          createdAt: dbNotif.createdAt,
          source: "database"
        });
      }

      // Mentions in posts
      for (const mentionId of post.mentions || []) {
        if (mentionId.toString() !== userId) continue;
        const msg = `${currentUser.fullName} mentioned you in a post`;
        const dbNotif = await ensureDbNotification(userId, currentUser._id, "mention", post._id, null, msg);
        addNotification({
          _id: dbNotif._id,
          type: "mention",
          message: msg,
          sender: currentUser,
          post: { _id: post._id, description: post.description },
          isRead: dbNotif.isRead,
          createdAt: dbNotif.createdAt,
          source: "database"
        });
      }

      // Mentions in comments
      for (const comment of post.comments || []) {
        if (!comment.mentions?.some((m) => m.toString() === userId)) continue;
        const commenter = await Auth.findById(comment.userId).select("fullName profile").lean();
        const msg = `${commenter?.fullName || "Someone"} mentioned you in a comment`;
        const dbNotif = await ensureDbNotification(userId, comment.userId, "mention", post._id, comment._id, msg);
        addNotification({
          _id: dbNotif._id,
          type: "mention",
          message: msg,
          sender: commenter,
          post: { _id: post._id, description: post.description },
          reference: { commentId: comment._id },
          isRead: dbNotif.isRead,
          createdAt: dbNotif.createdAt,
          source: "database"
        });
      }
    }

    // Followers
    for (const followerId of currentUser.followers || []) {
      const follower = await Auth.findById(followerId).select("fullName profile").lean();
      const msg = `${follower?.fullName || "Someone"} started following you`;
      const dbNotif = await ensureDbNotification(userId, followerId, "follow", null, null, msg);
      addNotification({
        _id: dbNotif._id,
        type: "follow",
        message: msg,
        sender: follower,
        isRead: dbNotif.isRead,
        createdAt: dbNotif.createdAt,
        source: "database"
      });
    }

    // ---- Step 4: Sort, paginate, and respond ----
    const allNotifications = Array.from(notificationsMap.values());
    allNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const paginated = allNotifications.slice(skip, skip + parseInt(limit));

    const counts = {
      all: allNotifications.length,
      unread: allNotifications.filter(n => !n.isRead).length,
      likes: allNotifications.filter(n => n.type === "like").length,
      comments: allNotifications.filter(n => n.type === "comment").length,
      mentions: allNotifications.filter(n => n.type === "mention").length,
      follows: allNotifications.filter(n => n.type === "follow").length,
    };

    res.status(200).json({
      success: true,
      message: "Notifications fetched successfully ✅",
      data: {
        notifications: paginated,
        counts,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(allNotifications.length / parseInt(limit)),
          totalNotifications: allNotifications.length,
          hasNextPage: (skip + parseInt(limit)) < allNotifications.length,
          hasPrevPage: parseInt(page) > 1
        }
      },
      timestamp: new Date()
    });

  } catch (error) {
    console.error("❌ Error in getAllLiveNotifications:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
// // ===== UTILITY: SYNC LIVE DATA TO DATABASE =====
// exports.syncLiveNotifications = async (req, res) => {
//   try {
//     const { userId } = req.params;
    
//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return res.status(400).json({ success: false, message: "Invalid userId" });
//     }

//     console.log('🔄 Starting notification sync...');

//     const currentUser = await Auth.findById(userId).select("posts").lean();
//     if (!currentUser) {
//       return res.status(404).json({ success: false, message: "User not found" });
//     }

//     let syncedCount = 0;

//     // Sync comments
//     for (const post of currentUser.posts || []) {
//       for (const comment of post.comments || []) {
//         if (comment.userId.toString() !== userId) {
//           const exists = await Notification.findOne({
//             recipient: userId,
//             sender: comment.userId,
//             type: 'comment',
//             'reference.commentId': comment._id
//           });

//           if (!exists) {
//             await createNotification(
//               userId,
//               comment.userId,
//               'comment',
//               post._id,
//               { commentId: comment._id, postId: post._id },
//               'commented on your post',
//               { description: comment.text?.substring(0, 100) || '' }
//             );
//             syncedCount++;
//           }
//         }
//       }
//     }

//     console.log(`✅ Synced ${syncedCount} notifications`);

//     res.status(200).json({
//       success: true,
//       message: "Notifications synced successfully",
//       data: { syncedCount }
//     });

//   } catch (error) {
//     console.error("❌ Error syncing notifications:", error);
//     res.status(500).json({ 
//       success: false, 
//       message: "Server error", 
//       error: error.message 
//     });
//   }
// };