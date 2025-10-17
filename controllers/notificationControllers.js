const mongoose = require("mongoose");
const { Auth, Notification } = require('../models/authModel');
const { Message, Chat } = require('../models/messageModel');



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












exports.getAllLiveNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      limit = 50, 
      page = 1, 
      filter = 'all',
      timeRange = 'all'
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid userId" 
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Calculate time range
    let startDate = new Date(0);
    if (timeRange === '24h') startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (timeRange === '7d') startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (timeRange === '30d') startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    console.log(`\n📥 ===== FETCHING NOTIFICATIONS FOR USER: ${userId} =====`);
    console.log(`🔍 Filter: ${filter} | Time Range: ${timeRange} | Start Date: ${startDate}`);

    const allNotifications = [];
    const notificationMap = new Map(); // For deduplication

    // Helper function to create unique key for deduplication
    const createNotificationKey = (type, senderId, postId, commentId) => {
      return `${type}-${senderId}-${postId || 'null'}-${commentId || 'null'}`;
    };

    // Helper function to add notification if not duplicate
    const addNotification = (notification) => {
      const key = createNotificationKey(
        notification.type,
        notification.sender?._id,
        notification.postData?._id,
        notification.reference?.commentId
      );
      
      if (!notificationMap.has(key)) {
        notificationMap.set(key, true);
        allNotifications.push(notification);
        return true;
      }
      return false;
    };

    // ===== 1️⃣ GET CURRENT USER =====
    const currentUser = await Auth.findById(userId)
      .select("fullName profile followers following posts savedPosts")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    console.log(`👤 User found: ${currentUser.fullName}`);
    console.log(`📊 User has ${currentUser.posts?.length || 0} posts, ${currentUser.followers?.length || 0} followers`);

    // ===== 2️⃣ GET DATABASE NOTIFICATIONS =====
    console.log('\n📦 Fetching database notifications...');
    
    if (filter === 'all' || ['like', 'comment', 'follow', 'mention', 'post', 'follow_request', 'follow_approval'].includes(filter)) {
      let notificationQuery = { 
        recipient: userId,
        createdAt: { $gte: startDate }
      };
      
      if (filter !== 'all') {
        notificationQuery.type = filter;
      }

      const dbNotifications = await Notification.find(notificationQuery)
        .sort({ createdAt: -1 })
        .lean();

      console.log(`✅ Found ${dbNotifications.length} database notifications`);

      // Fetch all sender IDs for batch query
      const senderIds = [...new Set(dbNotifications.map(n => n.sender).filter(Boolean))];
      const postIds = [...new Set(dbNotifications.map(n => n.post).filter(Boolean))];

      // Batch fetch senders
      const senders = await Auth.find({ _id: { $in: senderIds } })
        .select("fullName profile.username profile.image")
        .lean();
      const senderMap = new Map(senders.map(s => [s._id.toString(), s]));

      // Batch fetch posts
      const postsData = await Auth.find({ "posts._id": { $in: postIds } })
        .select("posts")
        .lean();
      const postMap = new Map();
      postsData.forEach(user => {
        user.posts?.forEach(post => {
          postMap.set(post._id.toString(), post);
        });
      });

      for (let notif of dbNotifications) {
        const sender = senderMap.get(notif.sender?.toString());
        let postData = null;
        
        if (notif.post) {
          const post = postMap.get(notif.post.toString());
          if (post) {
            postData = {
              _id: post._id,
              description: post.description,
              media: post.media,
              likesCount: post.likes?.length || 0,
              commentsCount: post.comments?.length || 0
            };
          }
        }

        addNotification({
          _id: notif._id,
          recipient: notif.recipient,
          sender: sender || { _id: notif.sender, fullName: "Unknown User", profile: {} },
          type: notif.type,
          postData: postData,
          reference: notif.reference || {},
          message: notif.message || getDefaultMessage(notif.type, sender?.fullName),
          content: notif.content || {},
          isRead: notif.isRead,
          readAt: notif.readAt,
          createdAt: notif.createdAt,
          source: 'database'
        });
      }
    }

    // ===== 3️⃣ GET LIVE COMMENTS ON USER'S POSTS =====
    console.log('\n💬 Checking for live comments...');
    
    if (filter === 'all' || filter === 'comment') {
      const userPosts = currentUser.posts || [];
      let liveCommentsCount = 0;
      
      for (const post of userPosts) {
        if (post.comments && post.comments.length > 0) {
          for (const comment of post.comments) {
            if (comment.userId.toString() === userId) continue;

            const commentDate = new Date(comment.createdAt);
            if (commentDate < startDate) continue;

            // Check if this comment already exists in notifications
            const key = createNotificationKey('comment', comment.userId, post._id, comment._id);
            if (notificationMap.has(key)) continue;

            const commenter = await Auth.findById(comment.userId)
              .select("fullName profile.username profile.image")
              .lean();

            if (commenter && addNotification({
              _id: comment._id,
              recipient: userId,
              sender: {
                _id: commenter._id,
                fullName: commenter.fullName,
                profile: {
                  username: commenter.profile?.username,
                  image: commenter.profile?.image
                }
              },
              type: 'comment',
              postData: {
                _id: post._id,
                description: post.description,
                media: post.media,
                likesCount: post.likes?.length || 0,
                commentsCount: post.comments?.length || 0
              },
              reference: { 
                commentId: comment._id,
                postId: post._id 
              },
              message: `${commenter.fullName} commented on your post`,
              content: {
                title: 'New Comment',
                description: comment.text?.substring(0, 100) || '',
                preview: post.media?.[0]?.url || ''
              },
              isRead: false,
              createdAt: comment.createdAt,
              source: 'live_comment'
            })) {
              liveCommentsCount++;
            }
          }
        }
      }
      console.log(`✅ Added ${liveCommentsCount} live comment notifications`);
    }

    // ===== 4️⃣ GET LIVE LIKES ON USER'S POSTS =====
    console.log('\n❤️ Checking for live likes...');
    
    if (filter === 'all' || filter === 'like') {
      const userPosts = currentUser.posts || [];
      let liveLikesCount = 0;
      
      // Batch fetch all likers
      const allLikerIds = new Set();
      userPosts.forEach(post => {
        post.likes?.forEach(likerId => {
          if (likerId.toString() !== userId) {
            allLikerIds.add(likerId.toString());
          }
        });
      });

      const likers = await Auth.find({ _id: { $in: Array.from(allLikerIds) } })
        .select("fullName profile.username profile.image")
        .lean();
      const likerMap = new Map(likers.map(l => [l._id.toString(), l]));

      for (const post of userPosts) {
        if (post.likes && post.likes.length > 0) {
          const postDate = new Date(post.createdAt);
          if (postDate < startDate) continue;

          for (const likerId of post.likes) {
            if (likerId.toString() === userId) continue;

            const key = createNotificationKey('like', likerId, post._id, null);
            if (notificationMap.has(key)) continue;

            const liker = likerMap.get(likerId.toString());
            if (liker && addNotification({
              _id: new mongoose.Types.ObjectId(),
              recipient: userId,
              sender: {
                _id: liker._id,
                fullName: liker.fullName,
                profile: {
                  username: liker.profile?.username,
                  image: liker.profile?.image
                }
              },
              type: 'like',
              postData: {
                _id: post._id,
                description: post.description,
                media: post.media,
                likesCount: post.likes?.length || 0,
                commentsCount: post.comments?.length || 0
              },
              message: `${liker.fullName} liked your post`,
              content: {
                title: 'New Like',
                description: post.description?.substring(0, 100) || 'your post',
                preview: post.media?.[0]?.url || ''
              },
              isRead: false,
              createdAt: post.createdAt, // Approximate - consider storing likedAt
              source: 'live_like'
            })) {
              liveLikesCount++;
            }
          }
        }
      }
      console.log(`✅ Added ${liveLikesCount} live like notifications`);
    }

    // ===== 5️⃣ GET MENTIONS IN POSTS =====
    console.log('\n🏷️ Checking for mentions in posts...');
    
    if (filter === 'all' || filter === 'mention') {
      const usersWithMentions = await Auth.find({
        "posts.mentions": userId,
        "posts.createdAt": { $gte: startDate }
      })
      .select("fullName profile posts")
      .lean();

      let mentionsCount = 0;
      for (const user of usersWithMentions) {
        for (const post of user.posts || []) {
          if (post.mentions?.some(m => m.toString() === userId)) {
            const postDate = new Date(post.createdAt);
            if (postDate < startDate) continue;

            const key = createNotificationKey('mention', user._id, post._id, null);
            if (notificationMap.has(key)) continue;

            if (addNotification({
              _id: new mongoose.Types.ObjectId(),
              recipient: userId,
              sender: {
                _id: user._id,
                fullName: user.fullName,
                profile: {
                  username: user.profile?.username,
                  image: user.profile?.image
                }
              },
              type: 'mention',
              postData: {
                _id: post._id,
                description: post.description,
                media: post.media
              },
              message: `${user.fullName} mentioned you in a post`,
              content: {
                title: 'Post Mention',
                description: post.description?.substring(0, 100) || '',
                preview: post.media?.[0]?.url || ''
              },
              isRead: false,
              createdAt: post.createdAt,
              source: 'live_mention_post'
            })) {
              mentionsCount++;
            }
          }
        }
      }
      console.log(`✅ Added ${mentionsCount} post mention notifications`);
    }

    // ===== 6️⃣ GET MENTIONS IN COMMENTS =====
    console.log('\n💬 Checking for mentions in comments...');
    
    if (filter === 'all' || filter === 'mention') {
      const usersWithCommentMentions = await Auth.find({
        "posts.comments.mentions": userId,
        "posts.comments.createdAt": { $gte: startDate }
      })
      .select("fullName profile posts")
      .lean();

      let commentMentionsCount = 0;
      for (const user of usersWithCommentMentions) {
        for (const post of user.posts || []) {
          for (const comment of post.comments || []) {
            if (comment.mentions?.some(m => m.toString() === userId)) {
              const commentDate = new Date(comment.createdAt);
              if (commentDate < startDate) continue;

              const key = createNotificationKey('mention', comment.userId, post._id, comment._id);
              if (notificationMap.has(key)) continue;

              const commentAuthor = await Auth.findById(comment.userId)
                .select("fullName profile")
                .lean();

              if (commentAuthor && addNotification({
                _id: comment._id,
                recipient: userId,
                sender: {
                  _id: commentAuthor._id,
                  fullName: commentAuthor.fullName,
                  profile: {
                    username: commentAuthor.profile?.username,
                    image: commentAuthor.profile?.image
                  }
                },
                type: 'mention',
                postData: {
                  _id: post._id,
                  description: post.description
                },
                reference: { 
                  commentId: comment._id,
                  postId: post._id 
                },
                message: `${commentAuthor.fullName} mentioned you in a comment`,
                content: {
                  title: 'Comment Mention',
                  description: comment.text?.substring(0, 100) || '',
                  preview: ''
                },
                isRead: false,
                createdAt: comment.createdAt,
                source: 'live_mention_comment'
              })) {
                commentMentionsCount++;
              }
            }
          }
        }
      }
      console.log(`✅ Added ${commentMentionsCount} comment mention notifications`);
    }

    // ===== 7️⃣ GET FOLLOWERS =====
    console.log('\n👥 Checking for followers...');
    
    if (filter === 'all' || filter === 'follow') {
      const followers = await Auth.find({
        _id: { $in: currentUser.followers || [] }
      })
      .select("fullName profile.username profile.image")
      .lean();

      let followersCount = 0;
      for (const follower of followers) {
        const key = createNotificationKey('follow', follower._id, null, null);
        if (notificationMap.has(key)) continue;

        if (addNotification({
          _id: new mongoose.Types.ObjectId(),
          recipient: userId,
          sender: {
            _id: follower._id,
            fullName: follower.fullName,
            profile: {
              username: follower.profile?.username,
              image: follower.profile?.image
            }
          },
          type: 'follow',
          message: `${follower.fullName} started following you`,
          content: {
            title: 'New Follower',
            description: `${follower.fullName} is now following you`,
            preview: follower.profile?.image || ''
          },
          isRead: false,
          createdAt: new Date(), // Approximate
          source: 'live_follow'
        })) {
          followersCount++;
        }
      }
      console.log(`✅ Added ${followersCount} follower notifications`);
    }

    // ===== 8️⃣ GET NEW POSTS FROM FOLLOWING =====
    console.log('\n📮 Checking for posts from following...');
    
    if (filter === 'all' || filter === 'post') {
      const followingIds = currentUser.following || [];
      
      if (followingIds.length > 0) {
        const usersWithPosts = await Auth.find({
          _id: { $in: followingIds },
          "posts.createdAt": { $gte: startDate }
        })
        .select("fullName profile posts")
        .lean();

        let newPostsCount = 0;
        for (const user of usersWithPosts) {
          const recentPosts = user.posts.filter(post => 
            new Date(post.createdAt) >= startDate
          );

          for (const post of recentPosts) {
            const key = createNotificationKey('post', user._id, post._id, null);
            if (notificationMap.has(key)) continue;

            if (addNotification({
              _id: post._id,
              recipient: userId,
              sender: {
                _id: user._id,
                fullName: user.fullName,
                profile: {
                  username: user.profile?.username,
                  image: user.profile?.image
                }
              },
              type: 'post',
              postData: {
                _id: post._id,
                description: post.description,
                media: post.media,
                likesCount: post.likes?.length || 0,
                commentsCount: post.comments?.length || 0
              },
              message: `${user.fullName} created a new post`,
              content: {
                title: 'New Post',
                description: post.description?.substring(0, 100) || '',
                preview: post.media?.[0]?.url || ''
              },
              isRead: false,
              createdAt: post.createdAt,
              source: 'live_post'
            })) {
              newPostsCount++;
            }
          }
        }
        console.log(`✅ Added ${newPostsCount} new post notifications`);
      }
    }

    // ===== 9️⃣ GET UNREAD MESSAGES =====
    console.log('\n📧 Checking for unread messages...');
    
    if (filter === 'all' || filter === 'message') {
      const unreadMessages = await Message.find({
        receiver: userId,
        isRead: false,
        createdAt: { $gte: startDate }
      })
      .populate("sender", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .lean();

      let messagesCount = 0;
      for (const msg of unreadMessages) {
        const key = createNotificationKey('message', msg.sender._id, null, msg._id);
        if (notificationMap.has(key)) continue;

        if (addNotification({
          _id: msg._id,
          recipient: userId,
          sender: msg.sender,
          type: 'message',
          reference: { 
            chatId: msg.chatId,
            messageId: msg._id
          },
          message: `${msg.sender?.fullName} sent you a message`,
          content: {
            title: 'New Message',
            description: msg.content?.text?.substring(0, 100) || 'New message',
            preview: msg.content?.mediaUrl || ''
          },
          isRead: false,
          createdAt: msg.createdAt,
          source: 'live_message'
        })) {
          messagesCount++;
        }
      }
      console.log(`✅ Added ${messagesCount} message notifications`);
    }

    // ===== 🔟 SORT BY DATE =====
    allNotifications.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    console.log(`\n📊 TOTAL NOTIFICATIONS: ${allNotifications.length}`);

    // ===== 1️⃣1️⃣ CALCULATE COUNTS =====
    const counts = {
      all: allNotifications.length,
      unread: allNotifications.filter(n => !n.isRead).length,
      likes: allNotifications.filter(n => n.type === 'like').length,
      comments: allNotifications.filter(n => n.type === 'comment').length,
      follows: allNotifications.filter(n => n.type === 'follow').length,
      followRequests: allNotifications.filter(n => n.type === 'follow_request').length,
      followApprovals: allNotifications.filter(n => n.type === 'follow_approval').length,
      mentions: allNotifications.filter(n => n.type === 'mention').length,
      posts: allNotifications.filter(n => n.type === 'post').length,
      messages: allNotifications.filter(n => n.type === 'message').length
    };

    console.log('📈 Counts:', counts);

    // ===== 1️⃣2️⃣ CATEGORIZE =====
    const categorized = {
      interactions: allNotifications.filter(n => ['like', 'comment'].includes(n.type)),
      social: allNotifications.filter(n => ['follow', 'follow_request', 'follow_approval'].includes(n.type)),
      content: allNotifications.filter(n => ['post', 'mention'].includes(n.type)),
      messages: allNotifications.filter(n => n.type === 'message')
    };

    // ===== 1️⃣3️⃣ APPLY PAGINATION =====
    const paginatedNotifications = allNotifications.slice(skip, skip + parseInt(limit));

    console.log(`✅ Returning ${paginatedNotifications.length} notifications for page ${page}\n`);

    // ===== 1️⃣4️⃣ RESPONSE =====
    res.status(200).json({
      success: true,
      message: "All notifications fetched successfully ✅",
      data: {
        notifications: paginatedNotifications,
        counts: counts,
        categorized: {
          interactions: categorized.interactions.slice(0, 20),
          social: categorized.social.slice(0, 20),
          content: categorized.content.slice(0, 20),
          messages: categorized.messages.slice(0, 20)
        },
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(allNotifications.length / parseInt(limit)),
          totalNotifications: allNotifications.length,
          hasNextPage: (skip + parseInt(limit)) < allNotifications.length,
          hasPrevPage: parseInt(page) > 1
        },
        filters: {
          applied: filter,
          timeRange: timeRange,
          available: ['all', 'like', 'comment', 'follow', 'mention', 'post', 'message']
        }
      },
      timestamp: new Date()
    });

  } catch (error) {
    console.error("❌ Error in getAllLiveNotifications:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message
    });
  }
};

// Helper function for default messages
function getDefaultMessage(type, senderName) {
  const name = senderName || 'Someone';
  const messages = {
    'like': `${name} liked your post`,
    'comment': `${name} commented on your post`,
    'follow': `${name} started following you`,
    'follow_request': `${name} sent you a follow request`,
    'follow_approval': `${name} approved your follow request`,
    'mention': `${name} mentioned you`,
    'post': `${name} created a new post`,
    'message': `${name} sent you a message`
  };
  return messages[type] || `${name} interacted with you`;
}
