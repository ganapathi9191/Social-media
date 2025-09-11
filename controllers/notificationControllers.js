const mongoose = require("mongoose");
const { Auth, Notification } = require('../models/authModel');

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
  } catch (error) {
    console.error("Error sending mention notification:", error);
  }
};

// Get all notifications for a user
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const notifications = await Notification.find({ recipient: userId })
      .populate("sender", "fullName profile.username profile.image")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      data: notifications
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.body;

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

    // Update notification preferences
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