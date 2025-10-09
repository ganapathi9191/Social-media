const mongoose = require("mongoose");
const { Auth, Notification } = require('../models/authModel');



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
    const { notificationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    // No need to do `new ObjectId(notificationId)`; just pass the string
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
    const { userId } = req.params; // get userId from URL


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

    console.log(`Marked ${result.modifiedCount} notifications as read for user: ${userId}`);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: {
        markedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error("Error in markNotificationsAsRead:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};
// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params; // get from params

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

// Get all live notifications combined (posts, follows, likes, comments, mentions, follow requests, approvals)
exports.getAllLiveNotifications = async (req, res) => {
   try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    console.log(`Fetching notifications for user: ${userId}`);

    // 1️⃣ Get all standard notifications from Notification collection
    const standardNotifications = await Notification.find({ recipient: userId })
      .populate("sender", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .lean();

    console.log(`Found ${standardNotifications.length} standard notifications`);

    // 2️⃣ Get all users with their posts and comments
    const allUsers = await Auth.find({})
      .select("fullName profile posts followers following")
      .populate("posts.userId", "fullName profile")
      .populate("posts.comments.userId", "fullName profile")
      .populate("posts.mentions", "fullName profile")
      .lean();

    // 3️⃣ Find post mentions (user mentioned in posts)
    const postMentions = [];
    for (const user of allUsers) {
      if (user.posts && user.posts.length > 0) {
        for (const post of user.posts) {
          if (post.mentions && post.mentions.length > 0) {
            // Check if current userId is in mentions
            const isMentioned = post.mentions.some(mention => 
              mention._id && mention._id.toString() === userId
            );
            
            if (isMentioned) {
              postMentions.push({
                _id: post._id || new mongoose.Types.ObjectId(),
                type: "post_mention",
                message: `${user.fullName} mentioned you in a post`,
                data: {
                  postId: post._id,
                  description: post.description || "No description",
                  media: post.media || []
                },
                sender: {
                  _id: user._id,
                  fullName: user.fullName,
                  profile: user.profile || {}
                },
                createdAt: post.createdAt || new Date(),
                isRead: false,
                source: 'post_mention'
              });
            }
          }
        }
      }
    }

    console.log(`Found ${postMentions.length} post mentions`);

    // 4️⃣ Find comment mentions (user mentioned in comments)
    const commentMentions = [];
    for (const user of allUsers) {
      if (user.posts && user.posts.length > 0) {
        for (const post of user.posts) {
          if (post.comments && post.comments.length > 0) {
            for (const comment of post.comments) {
              if (comment.mentions && comment.mentions.length > 0) {
                // Check if current userId is in comment mentions
                const isMentioned = comment.mentions.some(mention => 
                  mention._id && mention._id.toString() === userId
                );
                
                if (isMentioned) {
                  // Find comment author
                  const commentAuthor = allUsers.find(u => 
                    u._id.toString() === (comment.userId?._id?.toString() || comment.userId?.toString())
                  );
                  
                  commentMentions.push({
                    _id: comment._id || new mongoose.Types.ObjectId(),
                    type: "comment_mention",
                    message: `${commentAuthor?.fullName || 'Someone'} mentioned you in a comment`,
                    data: {
                      postId: post._id,
                      commentId: comment._id,
                      commentText: comment.text || "No text"
                    },
                    sender: {
                      _id: commentAuthor?._id,
                      fullName: commentAuthor?.fullName,
                      profile: commentAuthor?.profile || {}
                    },
                    createdAt: comment.createdAt || new Date(),
                    isRead: false,
                    source: 'comment_mention'
                  });
                }
              }
            }
          }
        }
      }
    }

    console.log(`Found ${commentMentions.length} comment mentions`);

    // 5️⃣ Get new posts from users you follow
    const currentUser = await Auth.findById(userId)
      .populate("following", "_id fullName profile")
      .lean();
    
    const followingIds = currentUser?.following?.map(f => f._id.toString()) || [];
    const newPostsFromFollowing = [];

    if (followingIds.length > 0) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      for (const user of allUsers) {
        if (followingIds.includes(user._id.toString()) && user.posts) {
          for (const post of user.posts) {
            const postDate = post.createdAt ? new Date(post.createdAt) : new Date();
            if (postDate >= twentyFourHoursAgo) {
              newPostsFromFollowing.push({
                _id: post._id || new mongoose.Types.ObjectId(),
                type: "new_post",
                message: `${user.fullName} created a new post`,
                data: {
                  postId: post._id,
                  description: post.description || "No description",
                  media: post.media || []
                },
                sender: {
                  _id: user._id,
                  fullName: user.fullName,
                  profile: user.profile || {}
                },
                createdAt: postDate,
                isRead: false,
                source: 'new_post'
              });
            }
          }
        }
      }
    }

    console.log(`Found ${newPostsFromFollowing.length} new posts from following`);

    // 6️⃣ Combine all notifications
    const allNotifications = [
      ...standardNotifications.map(notif => ({
        ...notif,
        source: 'standard',
        // Ensure consistent structure
        data: {
          postId: notif.post,
          ...(notif.type === 'comment' && { commentText: notif.message })
        }
      })),
      ...postMentions,
      ...commentMentions,
      ...newPostsFromFollowing
    ];

    console.log(`Total notifications: ${allNotifications.length}`);

    // 7️⃣ Sort by creation date (newest first)
    allNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 8️⃣ Categorize notifications
    const categorized = {
      all: allNotifications,
      unread: allNotifications.filter(notif => !notif.isRead),
      mentions: allNotifications.filter(notif => 
        notif.type === 'mention' || 
        notif.source === 'post_mention' || 
        notif.source === 'comment_mention'
      ),
      interactions: allNotifications.filter(notif => 
        notif.type === 'like' || 
        notif.type === 'comment'
      ),
      follows: allNotifications.filter(notif => 
        notif.type === 'follow' || 
        notif.type === 'follow_request' || 
        notif.type === 'follow_approval'
      ),
      posts: allNotifications.filter(notif => 
        notif.type === 'post' || 
        notif.source === 'new_post'
      )
    };

    // 9️⃣ Get counts
    const counts = {
      total: allNotifications.length,
      unread: categorized.unread.length,
      mentions: categorized.mentions.length,
      interactions: categorized.interactions.length,
      follows: categorized.follows.length,
      posts: categorized.posts.length
    };

    console.log('Notification counts:', counts);

    res.status(200).json({
      success: true,
      message: "All live notifications fetched successfully",
      data: {
        counts,
        categorized,
        allNotifications
      }
    });

  } catch (error) {
    console.error("Error in getAllLiveNotifications:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};


// Get ONLY NEW/UNREAD notifications for popup
exports.getLivepopupNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    console.log(`Fetching NEW notifications for popup - User: ${userId}`);

    // 1️⃣ Get ONLY UNREAD notifications from Notification collection
    const unreadNotifications = await Notification.find({ 
      recipient: userId, 
      isRead: false 
    })
    .populate("sender", "fullName profile.username profile.image")
    .sort({ createdAt: -1 })
    .lean();

    console.log(`Found ${unreadNotifications.length} new notifications`);

    // 2️⃣ Format the notifications with descriptive messages
    const formattedNotifications = unreadNotifications.map(notif => {
      const displayMessage = getDisplayMessage(notif.type, notif.sender?.fullName, notif.sender?.profile?.username);
      
      return {
        _id: notif._id,
        type: notif.type,
        message: displayMessage,
        sender: notif.sender,
        post: notif.post,
        createdAt: notif.createdAt,
        isRead: notif.isRead,
        isNew: true
      };
    });

    // 3️⃣ Count by type for badges
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
    console.error("Error in getLiveNotifications:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

// Helper function to format descriptive messages
const getDisplayMessage = (type, senderName, username) => {
  const displayName = senderName || username || 'Someone';
  
  const messages = {
    'like': `${displayName} liked your post`,
    'comment': `${displayName} commented on your post`,
    'follow': `${displayName} started following you`,
    'follow_request': `${displayName} sent you a follow request`,
    'mention': `${displayName} mentioned you`,
    'message': `${displayName} sent you a message`,
    'post': `${displayName} created a new post`,
    'follow_approval': `${displayName} approved your follow request`
  };
  
  return messages[type] || `${displayName} sent you a notification`;
};