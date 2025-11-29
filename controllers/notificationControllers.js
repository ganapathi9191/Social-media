// controllers/notificationControllers.js
const mongoose = require("mongoose");
const { Auth, Notification } = require("../models/authModel");
const { Message, Chat } = require("../models/messageModel");

/**
 * Helper: safe ObjectId conversion
 */
const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return id; // fallback for string IDs
  }
};

// FIXED createNotification function - Add this to your notificationControllers.js
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

    // Validate inputs
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

    // Create notification payload
    const payload = {
      recipient: recipientId,
      sender: senderId,
      type,
      message: message || "New notification",
      isRead: false,
      isDeleted: false,
      createdAt: new Date()
    };

    // Add post reference if provided
    if (postId) {
      payload.post = toObjectId(postId);
    }

    // Add comment reference if provided
    if (commentId) {
      payload.reference = { commentId: toObjectId(commentId) };
    }

    console.log(`📝 Notification payload:`, payload);

    // Create the notification
    const notification = await Notification.create(payload);
    console.log(`✅ Notification created:`, notification._id);

    // Emit real-time notification if socket exists
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
    console.error("❌ createNotification error:", error);
    return null;
  }
};


/**
 * ensureDbNotification
 * - creates a notification only if it doesn't already exist
 * - handles string/ObjectId inputs
 * - tolerates race conditions (11000)
 */
const ensureDbNotification = async (
  recipient,
  sender,
  type,
  postId = null,
  commentId = null,
  message = ""
) => {
  try {
    const recipientId = toObjectId(recipient) || recipient;
    const senderId = toObjectId(sender) || sender;

    // skip self
    if (!recipientId || !senderId) return null;
    if (senderId.toString() === recipientId.toString()) return null;

    const query = {
      recipient: recipientId,
      sender: senderId,
      type,
      isDeleted: { $ne: true },
    };

    if (postId) query.post = toObjectId(postId) || postId;
    if (commentId) query["reference.commentId"] = toObjectId(commentId) || commentId;

    // try find
    let notification = await Notification.findOne(query).lean();
    if (notification) return notification;

    // create (handle duplicate key race)
    const createDoc = {
      recipient: recipientId,
      sender: senderId,
      type,
      post: postId ? (toObjectId(postId) || postId) : null,
      reference: commentId ? { commentId: toObjectId(commentId) || commentId } : {},
      message,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
    };

    try {
      notification = await Notification.create(createDoc);
      return notification;
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        // another process inserted; fetch existing
        notification = await Notification.findOne(query).lean();
        return notification;
      }
      throw createErr;
    }
  } catch (err) {
    console.error("ensureDbNotification error:", err);
    throw err;
  }
};

/**
 * autoSyncMissingNotifications
 * - Scans posts stored in Auth users and ensures notifications exist for:
 *   likes, comments, mentions (post + comment), posts (for followers), follow & follow_request
 * - Returns number of notifications created (attempted creations counted)
 * - Uses ensureDbNotification which will dedupe in DB
 */
const syncAllNotifications  = async (userId) => {
  try {
    const { userId } = req.params;
    
    console.log(`🔄 COMPREHENSIVE SYNC: Starting for user ${userId}`);
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    let createdCount = 0;

    // Get the target user
    const targetUser = await Auth.findById(userId)
      .select("fullName posts followers following followerRequests")
      .populate("followers", "fullName")
      .populate("following", "fullName")
      .populate("followerRequests", "fullName");

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`👤 User: ${targetUser.fullName}`);
    console.log(`📊 Stats - Posts: ${targetUser.posts?.length || 0}, Followers: ${targetUser.followers?.length || 0}, Following: ${targetUser.following?.length || 0}`);

    // STRATEGY 1: Sync notifications where user is the RECIPIENT (gets notifications)

    // 1A. Sync LIKES on user's posts
    if (targetUser.posts && targetUser.posts.length > 0) {
      for (const post of targetUser.posts) {
        if (post.likes && post.likes.length > 0) {
          for (const likerId of post.likes) {
            // Skip if user liked their own post
            if (likerId.toString() === userId) {
              console.log(`⏩ Skipping self-like on post ${post._id}`);
              continue;
            }

            // Check if notification already exists
            const existingNotification = await Notification.findOne({
              recipient: userObjectId,
              sender: likerId,
              type: "like",
              post: post._id
            });

            if (!existingNotification) {
              const liker = await Auth.findById(likerId).select("fullName profile.username");
              const notification = await createNotification(
                userId,
                likerId,
                "like",
                post._id,
                null,
                `${liker?.fullName || "Someone"} liked your post`,
                { allowSelf: false, checkPreferences: false }
              );
              
              if (notification) {
                createdCount++;
                console.log(`✅ Created LIKE notification from ${liker?.fullName} on post ${post._id}`);
              }
            } else {
              console.log(`⏩ Like notification already exists from ${likerId} on post ${post._id}`);
            }
          }
        }
      }
    }

    // 1B. Sync COMMENTS on user's posts
    if (targetUser.posts && targetUser.posts.length > 0) {
      for (const post of targetUser.posts) {
        if (post.comments && post.comments.length > 0) {
          for (const comment of post.comments) {
            // Skip if user commented on their own post
            if (comment.userId.toString() === userId) {
              console.log(`⏩ Skipping self-comment on post ${post._id}`);
              continue;
            }

            // Check if notification already exists
            const existingNotification = await Notification.findOne({
              recipient: userObjectId,
              sender: comment.userId,
              type: "comment",
              post: post._id,
              "reference.commentId": comment._id
            });

            if (!existingNotification) {
              const commenter = await Auth.findById(comment.userId).select("fullName profile.username");
              const notification = await createNotification(
                userId,
                comment.userId,
                "comment",
                post._id,
                comment._id,
                `${commenter?.fullName || "Someone"} commented on your post`,
                { allowSelf: false, checkPreferences: false }
              );
              
              if (notification) {
                createdCount++;
                console.log(`✅ Created COMMENT notification from ${commenter?.fullName} on post ${post._id}`);
              }
            } else {
              console.log(`⏩ Comment notification already exists from ${comment.userId} on post ${post._id}`);
            }
          }
        }
      }
    }

    // 1C. Sync FOLLOWERS
    if (targetUser.followers && targetUser.followers.length > 0) {
      for (const follower of targetUser.followers) {
        // Check if notification already exists
        const existingNotification = await Notification.findOne({
          recipient: userObjectId,
          sender: follower._id,
          type: "follow"
        });

        if (!existingNotification) {
          const notification = await createNotification(
            userId,
            follower._id,
            "follow",
            null,
            null,
            `${follower.fullName} started following you`,
            { allowSelf: false, checkPreferences: false }
          );
          
          if (notification) {
            createdCount++;
            console.log(`✅ Created FOLLOW notification from ${follower.fullName}`);
          }
        } else {
          console.log(`⏩ Follow notification already exists from ${follower.fullName}`);
        }
      }
    }

    // 1D. Sync FOLLOW REQUESTS
    if (targetUser.followerRequests && targetUser.followerRequests.length > 0) {
      for (const requester of targetUser.followerRequests) {
        // Check if notification already exists
        const existingNotification = await Notification.findOne({
          recipient: userObjectId,
          sender: requester._id,
          type: "follow_request"
        });

        if (!existingNotification) {
          const notification = await createNotification(
            userId,
            requester._id,
            "follow_request",
            null,
            null,
            `${requester.fullName} sent you a follow request`,
            { allowSelf: false, checkPreferences: false }
          );
          
          if (notification) {
            createdCount++;
            console.log(`✅ Created FOLLOW REQUEST notification from ${requester.fullName}`);
          }
        } else {
          console.log(`⏩ Follow request notification already exists from ${requester.fullName}`);
        }
      }
    }

    // STRATEGY 2: Sync notifications where user is MENTIONED in other users' posts

    // 2A. Find posts where user is mentioned
    const mentionedPosts = await Auth.aggregate([
      { $unwind: "$posts" },
      { $match: { 
        "posts.mentions": userObjectId,
        "posts.userId": { $ne: userObjectId } // Exclude user's own posts
      }},
      { $project: { 
        "_id": 1,
        "fullName": 1,
        "post": "$posts"
      }}
    ]);

    for (const item of mentionedPosts) {
      // Check if notification already exists
      const existingNotification = await Notification.findOne({
        recipient: userObjectId,
        sender: item._id,
        type: "mention",
        post: item.post._id
      });

      if (!existingNotification) {
        const notification = await createNotification(
          userId,
          item._id,
          "mention",
          item.post._id,
          null,
          `${item.fullName} mentioned you in a post`,
          { allowSelf: true, checkPreferences: false }
        );
        
        if (notification) {
          createdCount++;
          console.log(`✅ Created MENTION notification from ${item.fullName} in post ${item.post._id}`);
        }
      } else {
        console.log(`⏩ Mention notification already exists from ${item.fullName} in post ${item.post._id}`);
      }
    }

    // STRATEGY 3: Sync POST notifications from users this user follows
    if (targetUser.following && targetUser.following.length > 0) {
      const followingIds = targetUser.following.map(f => f._id);
      
      const followedUsersPosts = await Auth.aggregate([
        { $match: { _id: { $in: followingIds } } },
        { $unwind: "$posts" },
        { $project: { 
          "_id": 1,
          "fullName": 1,
          "post": "$posts"
        }}
      ]);

      for (const item of followedUsersPosts) {
        // Check if notification already exists
        const existingNotification = await Notification.findOne({
          recipient: userObjectId,
          sender: item._id,
          type: "post",
          post: item.post._id
        });

        if (!existingNotification) {
          const notification = await createNotification(
            userId,
            item._id,
            "post",
            item.post._id,
            null,
            `${item.fullName} created a new post`,
            { allowSelf: false, checkPreferences: false }
          );
          
          if (notification) {
            createdCount++;
            console.log(`✅ Created POST notification from ${item.fullName} - post ${item.post._id}`);
          }
        } else {
          console.log(`⏩ Post notification already exists from ${item.fullName} - post ${item.post._id}`);
        }
      }
    }

    // Get final notification count
    const finalNotificationCount = await Notification.countDocuments({
      recipient: userObjectId
    });

    res.status(200).json({
      success: true,
      message: `Comprehensive sync completed! Created ${createdCount} new notifications. Total notifications: ${finalNotificationCount}`,
      data: {
        createdCount,
        totalNotifications: finalNotificationCount,
        userStats: {
          posts: targetUser.posts?.length || 0,
          likes: targetUser.posts?.reduce((acc, post) => acc + (post.likes?.length || 0), 0) || 0,
          comments: targetUser.posts?.reduce((acc, post) => acc + (post.comments?.length || 0), 0) || 0,
          followers: targetUser.followers?.length || 0,
          following: targetUser.following?.length || 0,
          followerRequests: targetUser.followerRequests?.length || 0
        },
        breakdown: {
          likes: createdCount, // You can add more detailed breakdown if needed
          comments: createdCount, // You can add more detailed breakdown if needed
          follows: createdCount, // You can add more detailed breakdown if needed
          mentions: createdCount, // You can add more detailed breakdown if needed
          posts: createdCount // You can add more detailed breakdown if needed
        }
      }
    });

  } catch (err) {
    console.error("❌ Comprehensive sync error:", err);
    res.status(500).json({
      success: false,
      message: "Comprehensive sync failed",
      error: err.message
    });
  }
};

/**
 * ========== CONTROLLER EXPORTS ==========
 */

/**
 * getUserNotifications
 * - returns notifications for recipient
 * - only one implementation (deduplicated)
 */
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    const recipientId = new mongoose.Types.ObjectId(userId);

    const notifications = await Notification.find({
      recipient: recipientId,
      isDeleted: { $ne: true },
    })
      .populate("sender", "fullName profile.username profile.image")
      .populate({
        path: "post",
        select: "description media userId createdAt",
        populate: { path: "userId", select: "fullName profile.username" },
      })
      .sort({ createdAt: -1 })
      .lean();

    const formatted = notifications.map((n) => ({
      _id: n._id,
      type: n.type || n.actionType || "general",
      message: n.message || n.text || "New notification",
      sender: n.sender || {},
      post: n.post || null,
      isRead: !!n.isRead,
      createdAt: n.createdAt,
      reference: n.reference || {},
      source: "database",
    }));

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      total: formatted.length,
      data: formatted,
    });
  } catch (err) {
    console.error("getUserNotifications error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * getMentionedComments
 */
exports.getMentionedComments = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    const objectId = new mongoose.Types.ObjectId(userId);

    const mentionedComments = await Auth.aggregate([
      { $unwind: "$posts" },
      { $unwind: "$posts.comments" },
      {
        $match: {
          "posts.comments.mentions": objectId,
        },
      },
      {
        $lookup: {
          from: "auths",
          localField: "posts.comments.userId",
          foreignField: "_id",
          as: "commentUser",
        },
      },
      {
        $lookup: {
          from: "auths",
          localField: "posts.comments.mentions",
          foreignField: "_id",
          as: "mentionedUsers",
        },
      },
      {
        $project: {
          postId: "$posts._id",
          postDescription: "$posts.description",
          comment: "$posts.comments",
          postOwner: { _id: "$_id", username: "$profile.username", fullName: "$fullName" },
          commentUser: { $arrayElemAt: ["$commentUser", 0] },
          mentionedUsers: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Mentioned comments fetched successfully",
      data: mentionedComments,
    });
  } catch (err) {
    console.error("getMentionedComments error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * getLivepopupNotifications
 * - only unread new notifications (popup)
 */
exports.getLivepopupNotifications = async (req, res) => {
   try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: "Invalid userId" });

    const unreadNotifications = await Notification.find({
      recipient: mongoose.Types.ObjectId(userId),
      isRead: false,
      isDeleted: { $ne: true }
    })
    .populate("sender", "fullName profile.username profile.image")
    .populate("post", "description media")
    .sort({ createdAt: -1 })
    .lean();

    // quick counts by type
    const typeCounts = unreadNotifications.reduce((acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      message: "New notifications fetched successfully",
      data: {
        total: unreadNotifications.length,
        notifications: unreadNotifications,
        typeCounts,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error("getLivepopupNotifications error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * getUnreadCount
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: "Invalid userId" });

    const count = await Notification.countDocuments({
      recipient: mongoose.Types.ObjectId(userId),
      isRead: false,
      isDeleted: { $ne: true }
    });

    res.status(200).json({
      success: true,
      message: "Unread count fetched successfully",
      data: { unreadCount: count }
    });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * getAllLiveNotifications
 * - supports autoSync query param (true|false)
 * - pagination & type filter
 */
exports.getAllLiveNotifications = async (req, res) => {
    try {
    const { userId } = req.params;
    const { 
      page = 1, 
      limit = 100,
      type, 
      unreadOnly = false
    } = req.query;

    console.log(`🔍 GET ALL NOTIFICATIONS for user: ${userId}`);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // ✅ STEP 1: GET ALL DATABASE NOTIFICATIONS
    const query = {
      recipient: userObjectId,
      isDeleted: { $ne: true }
    };

    if (type && type !== 'all') query.type = type;
    if (unreadOnly === 'true') query.isRead = false;

    const allNotifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .populate("sender", "fullName email mobile gender profile")
      .populate({
        path: "sender",
        populate: {
          path: "profile",
          select: "username image firstName lastName about website"
        }
      })
      .populate("post", "description media userId createdAt")
      .lean();

    console.log(`✅ DATABASE NOTIFICATIONS: ${allNotifications.length}`);

    // ✅ STEP 2: GET UNREAD MESSAGES AS NOTIFICATIONS
    const unreadMessages = await Message.find({
      receiver: userObjectId,
      isRead: false
    })
    .populate("sender", "fullName email mobile gender profile")
    .populate({
      path: "sender",
      populate: {
        path: "profile",
        select: "username image firstName lastName about website"
      }
    })
    .sort({ createdAt: -1 })
    .lean();

    console.log(`💬 UNREAD MESSAGES: ${unreadMessages.length}`);

    // ✅ STEP 3: GET PENDING FOLLOW REQUESTS AS NOTIFICATIONS
    const currentUser = await Auth.findById(userId)
      .populate({
        path: 'followerRequests',
        select: 'fullName email mobile gender profile createdAt'
      })
      .lean();

    // Populate profile details
    if (currentUser?.followerRequests?.length > 0) {
      await Auth.populate(currentUser.followerRequests, {
        path: 'profile',
        select: 'username image firstName lastName about website'
      });
    }

    const followRequestNotifications = currentUser?.followerRequests?.map(requester => {
      // Check if this follow request already exists in database notifications
      const existingNotification = allNotifications.find(n => 
        n.type === 'follow_request' && 
        n.sender && n.sender._id.toString() === requester._id.toString()
      );

      // Only create if it doesn't exist in database
      if (!existingNotification) {
        return {
          _id: new mongoose.Types.ObjectId(),
          type: 'follow_request',
          message: `${requester.fullName || 'Someone'} sent you a follow request`,
          // ✅ FIX: Use current time so it appears at the top
          createdAt: new Date(),
          isRead: false,
          readAt: null,
          sender: requester,
          reference: {
            requesterId: requester._id,
            userId: userId
          },
          metadata: {
            isActionable: true,
            requiresResponse: true,
            canViewPost: false,
            priority: 'high',
            hasPost: false,
            hasComment: false,
            isMessage: false,
            isFollowRequest: true
          },
          isFollowRequest: true,
          isFromDatabase: false,
          // Store original timestamp for reference
          originalTimestamp: requester.createdAt
        };
      }
      return null;
    }).filter(Boolean) || [];

    console.log(`👥 FOLLOW REQUESTS: ${followRequestNotifications.length}`);

    // ✅ STEP 4: ONLY INCLUDE DATABASE NOTIFICATIONS (NOT AUTO-CREATED)
    // This ensures real-time notifications from the database are shown correctly
    // Auto-creation should only happen when notifications are missing, not every time

    // ✅ STEP 5: CONVERT MESSAGES TO NOTIFICATION FORMAT
    const messageNotifications = unreadMessages.map(message => ({
      _id: message._id,
      type: 'message',
      message: `${message.sender?.fullName || 'Someone'}: ${message.content?.text || 'Sent you a message'}`,
      createdAt: message.createdAt,
      isRead: message.isRead,
      readAt: message.readAt,
      sender: message.sender,
      reference: {
        messageId: message._id,
        chatId: message.chatId
      },
      metadata: {
        isActionable: true,
        requiresResponse: false,
        canViewPost: false,
        priority: 'high',
        hasPost: false,
        hasComment: false,
        isMessage: true
      },
      isMessage: true,
      messageData: {
        text: message.content?.text,
        mediaUrl: message.content?.mediaUrl || [],
        type: message.type,
        chatId: message.chatId
      }
    }));

    // ✅ STEP 6: COMBINE EVERYTHING (WITHOUT AUTO-CREATED NOTIFICATIONS)
    const allItems = [
      ...allNotifications,
      ...messageNotifications,
      ...followRequestNotifications
    ];

    // ✅ CRITICAL FIX: Sort by creation date (newest first)
    allItems.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA; // Descending order (newest first)
    });

    console.log(`📊 FINAL TOTAL: ${allItems.length} items`);
    
    // Debug: Log top 5 items to verify ordering
    if (allItems.length > 0) {
      console.log(`\n🔍 TOP 5 NOTIFICATIONS (NEWEST FIRST):`);
      allItems.slice(0, 5).forEach((item, idx) => {
        console.log(`${idx + 1}. [${item.type}] ${item.message} - ${new Date(item.createdAt).toISOString()}`);
      });
    }

    // ✅ STEP 7: APPLY PAGINATION
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    const paginatedItems = allItems.slice(skip, skip + limitNum);

    // ✅ STEP 8: CALCULATE COMPREHENSIVE COUNTS
    const totalCount = allItems.length;
    const unreadCount = allItems.filter(n => !n.isRead).length;
    const readCount = totalCount - unreadCount;

    // Count by type (including both read and unread)
    const countsByType = allItems.reduce((acc, item) => {
      const type = item.type;
      if (!acc[type]) {
        acc[type] = {
          total: 0,
          unread: 0,
          read: 0
        };
      }
      acc[type].total++;
      if (!item.isRead) {
        acc[type].unread++;
      } else {
        acc[type].read++;
      }
      return acc;
    }, {});

    // Count unread by type
    const unreadByType = allItems.reduce((acc, item) => {
      if (!item.isRead) {
        const type = item.type;
        acc[type] = (acc[type] || 0) + 1;
      }
      return acc;
    }, {});

    // Count read by type
    const readByType = allItems.reduce((acc, item) => {
      if (item.isRead) {
        const type = item.type;
        acc[type] = (acc[type] || 0) + 1;
      }
      return acc;
    }, {});

    // ✅ STEP 9: PREPARE COMPREHENSIVE COUNTS OBJECT
    const comprehensiveCounts = {
      // Basic counts
      total: totalCount,
      unread: unreadCount,
      read: readCount,
      
      // Detailed type counts
      byType: {
        // Follow related
        follow_request: countsByType.follow_request || { total: 0, unread: 0, read: 0 },
        follow_approval: countsByType.follow_approval || { total: 0, unread: 0, read: 0 },
        follow: countsByType.follow || { total: 0, unread: 0, read: 0 },
        
        // Post related
        post: countsByType.post || { total: 0, unread: 0, read: 0 },
        like: countsByType.like || { total: 0, unread: 0, read: 0 },
        comment: countsByType.comment || { total: 0, unread: 0, read: 0 },
        mention: countsByType.mention || { total: 0, unread: 0, read: 0 },
        
        // Messages
        message: countsByType.message || { total: 0, unread: 0, read: 0 }
      },
      
      // Unread counts by type (quick access)
      unreadByType: {
        follow_request: unreadByType.follow_request || 0,
        follow_approval: unreadByType.follow_approval || 0,
        follow: unreadByType.follow || 0,
        post: unreadByType.post || 0,
        like: unreadByType.like || 0,
        comment: unreadByType.comment || 0,
        mention: unreadByType.mention || 0,
        message: unreadByType.message || 0
      },
      
      // Read counts by type (quick access)
      readByType: {
        follow_request: readByType.follow_request || 0,
        follow_approval: readByType.follow_approval || 0,
        follow: readByType.follow || 0,
        post: readByType.post || 0,
        like: readByType.like || 0,
        comment: readByType.comment || 0,
        mention: readByType.mention || 0,
        message: readByType.message || 0
      },
      
      // Category summaries
      summaries: {
        // Follow category
        follow: {
          total: (countsByType.follow_request?.total || 0) + 
                 (countsByType.follow_approval?.total || 0) + 
                 (countsByType.follow?.total || 0),
          unread: (unreadByType.follow_request || 0) + 
                  (unreadByType.follow_approval || 0) + 
                  (unreadByType.follow || 0),
          read: (readByType.follow_request || 0) + 
                (readByType.follow_approval || 0) + 
                (readByType.follow || 0)
        },
        
        // Engagement category
        engagement: {
          total: (countsByType.like?.total || 0) + 
                 (countsByType.comment?.total || 0) + 
                 (countsByType.mention?.total || 0),
          unread: (unreadByType.like || 0) + 
                  (unreadByType.comment || 0) + 
                  (unreadByType.mention || 0),
          read: (readByType.like || 0) + 
                (readByType.comment || 0) + 
                (readByType.mention || 0)
        },
        
        // Content category
        content: {
          total: (countsByType.post?.total || 0),
          unread: (unreadByType.post || 0),
          read: (readByType.post || 0)
        },
        
        // Communication category
        communication: {
          total: (countsByType.message?.total || 0),
          unread: (unreadByType.message || 0),
          read: (readByType.message || 0)
        }
      },
      
      // Source breakdown
      bySource: {
        database: allNotifications.length,
        autoCreated: 0, // Removed auto-creation
        messages: messageNotifications.length,
        followRequests: followRequestNotifications.length
      }
    };

    // ✅ STEP 10: PREPARE FINAL RESPONSE
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    const response = {
      success: true,
      message: `Found ${totalCount} total notifications`,
      data: {
        // MAIN NOTIFICATIONS ARRAY
        notifications: paginatedItems,
        
        // COMPREHENSIVE COUNTS
        counts: comprehensiveCounts,
        
        // BREAKDOWN
        breakdown: {
          totalDatabaseNotifications: allNotifications.length,
          totalAutoCreated: 0, // Removed auto-creation
          totalMessages: messageNotifications.length,
          totalFollowRequests: followRequestNotifications.length,
          unreadCount: unreadCount,
          readCount: readCount
        },
        
        // SUMMARY
        summary: {
          total: totalCount,
          unread: unreadCount,
          read: readCount,
          byType: countsByType,
          readPercentage: totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0,
          unreadPercentage: totalCount > 0 ? Math.round((unreadCount / totalCount) * 100) : 0
        },
        
        // PAGINATION
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: totalCount,
          itemsPerPage: limitNum,
          hasNextPage,
          hasPrevPage,
          nextPage: hasNextPage ? parseInt(page) + 1 : null,
          prevPage: hasPrevPage ? parseInt(page) - 1 : null
        },
        
        // USER INFO
        user: {
          _id: userId,
          totalItems: totalCount,
          unreadItems: unreadCount
        }
      },
      timestamp: new Date()
    };

    res.status(200).json(response);

  } catch (err) {
    console.error("❌ Get all notifications error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
      error: err.message,
      timestamp: new Date()
    });
  }
};
// Debug endpoint to check notification-post relationships
exports.debugNotificationPosts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Get all notifications for user
    const notifications = await Notification.find({
      recipient: new mongoose.Types.ObjectId(userId)
    })
    .sort({ createdAt: -1 })
    .lean();

    // Analyze each notification
    const analysis = await Promise.all(
      notifications.map(async (notification) => {
        const analysisItem = {
          _id: notification._id,
          type: notification.type,
          postField: notification.post,
          reference: notification.reference,
          message: notification.message,
          createdAt: notification.createdAt
        };

        // Try to find the post
        let postId = notification.post?._id || notification.post;
        if (!postId && notification.reference?.postId) {
          postId = notification.reference.postId;
        }

        if (postId) {
          // Check if post exists in any user
          const postOwner = await Auth.findOne({ "posts._id": postId })
            .select("fullName posts")
            .lean();

          analysisItem.postExists = !!postOwner;
          analysisItem.postOwner = postOwner ? postOwner.fullName : null;
          
          if (postOwner) {
            const post = postOwner.posts.find(p => p._id.toString() === postId.toString());
            analysisItem.postDetails = {
              description: post?.description?.substring(0, 50) + (post?.description?.length > 50 ? '...' : ''),
              mediaCount: post?.media?.length || 0,
              likesCount: post?.likes?.length || 0,
              commentsCount: post?.comments?.length || 0
            };
          }
        }

        return analysisItem;
      })
    );

    res.status(200).json({
      success: true,
      message: "Notification post analysis",
      data: {
        totalNotifications: notifications.length,
        analysis: analysis,
        summary: {
          notificationsWithPostField: notifications.filter(n => n.post).length,
          notificationsWithPostInReference: notifications.filter(n => n.reference?.postId).length,
          notificationsWithNoPost: notifications.filter(n => !n.post && !n.reference?.postId).length
        }
      }
    });

  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).json({ success: false, message: "Debug error", error: err.message });
  }
};

// Auto-sync helper function
const autoSyncUserNotifications = async (userId) => {
  try {
    console.log(`🔄 AUTO-SYNC: Starting for user ${userId}`);
    
    const userObjectId = new mongoose.Types.ObjectId(userId);
    let createdCount = 0;

    // Get the target user with all relevant data
    const targetUser = await Auth.findById(userId)
      .select("fullName posts followers following followerRequests")
      .populate("followers", "fullName")
      .populate("following", "fullName")
      .populate("followerRequests", "fullName");

    if (!targetUser) {
      console.log("❌ User not found for auto-sync");
      return { createdCount: 0, userStats: {} };
    }

    console.log(`👤 Auto-syncing for: ${targetUser.fullName}`);

    // Sync LIKES on user's posts
    if (targetUser.posts && targetUser.posts.length > 0) {
      for (const post of targetUser.posts) {
        if (post.likes && post.likes.length > 0) {
          for (const likerId of post.likes) {
            // Skip if user liked their own post
            if (likerId.toString() === userId) continue;

            // Check if notification already exists
            const existingNotification = await Notification.findOne({
              recipient: userObjectId,
              sender: likerId,
              type: "like",
              post: post._id
            });

            if (!existingNotification) {
              const liker = await Auth.findById(likerId).select("fullName profile.username");
              const notification = await createNotification(
                userId,
                likerId,
                "like",
                post._id,
                null,
                `${liker?.fullName || "Someone"} liked your post`,
                { allowSelf: false, checkPreferences: false }
              );
              
              if (notification) {
                createdCount++;
                console.log(`✅ Auto-sync: Created LIKE notification from ${liker?.fullName}`);
              }
            }
          }
        }
      }
    }

    // Sync COMMENTS on user's posts
    if (targetUser.posts && targetUser.posts.length > 0) {
      for (const post of targetUser.posts) {
        if (post.comments && post.comments.length > 0) {
          for (const comment of post.comments) {
            // Skip if user commented on their own post
            if (comment.userId.toString() === userId) continue;

            // Check if notification already exists
            const existingNotification = await Notification.findOne({
              recipient: userObjectId,
              sender: comment.userId,
              type: "comment",
              post: post._id,
              "reference.commentId": comment._id
            });

            if (!existingNotification) {
              const commenter = await Auth.findById(comment.userId).select("fullName profile.username");
              const notification = await createNotification(
                userId,
                comment.userId,
                "comment",
                post._id,
                comment._id,
                `${commenter?.fullName || "Someone"} commented on your post`,
                { allowSelf: false, checkPreferences: false }
              );
              
              if (notification) {
                createdCount++;
                console.log(`✅ Auto-sync: Created COMMENT notification from ${commenter?.fullName}`);
              }
            }
          }
        }
      }
    }

    // Sync FOLLOWERS
    if (targetUser.followers && targetUser.followers.length > 0) {
      for (const follower of targetUser.followers) {
        const existingNotification = await Notification.findOne({
          recipient: userObjectId,
          sender: follower._id,
          type: "follow"
        });

        if (!existingNotification) {
          const notification = await createNotification(
            userId,
            follower._id,
            "follow",
            null,
            null,
            `${follower.fullName} started following you`,
            { allowSelf: false, checkPreferences: false }
          );
          
          if (notification) {
            createdCount++;
            console.log(`✅ Auto-sync: Created FOLLOW notification from ${follower.fullName}`);
          }
        }
      }
    }

    // Sync FOLLOW REQUESTS
    if (targetUser.followerRequests && targetUser.followerRequests.length > 0) {
      for (const requester of targetUser.followerRequests) {
        const existingNotification = await Notification.findOne({
          recipient: userObjectId,
          sender: requester._id,
          type: "follow_request"
        });

        if (!existingNotification) {
          const notification = await createNotification(
            userId,
            requester._id,
            "follow_request",
            null,
            null,
            `${requester.fullName} sent you a follow request`,
            { allowSelf: false, checkPreferences: false }
          );
          
          if (notification) {
            createdCount++;
            console.log(`✅ Auto-sync: Created FOLLOW REQUEST notification from ${requester.fullName}`);
          }
        }
      }
    }

    // Sync MENTIONS in other users' posts
    const mentionedPosts = await Auth.aggregate([
      { $unwind: "$posts" },
      { $match: { 
        "posts.mentions": userObjectId,
        "posts.userId": { $ne: userObjectId } // Exclude user's own posts
      }},
      { $project: { 
        "_id": 1,
        "fullName": 1,
        "post": "$posts"
      }}
    ]);

    for (const item of mentionedPosts) {
      const existingNotification = await Notification.findOne({
        recipient: userObjectId,
        sender: item._id,
        type: "mention",
        post: item.post._id
      });

      if (!existingNotification) {
        const notification = await createNotification(
          userId,
          item._id,
          "mention",
          item.post._id,
          null,
          `${item.fullName} mentioned you in a post`,
          { allowSelf: true, checkPreferences: false }
        );
        
        if (notification) {
          createdCount++;
          console.log(`✅ Auto-sync: Created MENTION notification from ${item.fullName}`);
        }
      }
    }

    // Calculate user stats
    const userStats = {
      posts: targetUser.posts?.length || 0,
      likes: targetUser.posts?.reduce((acc, post) => acc + (post.likes?.length || 0), 0) || 0,
      comments: targetUser.posts?.reduce((acc, post) => acc + (post.comments?.length || 0), 0) || 0,
      followers: targetUser.followers?.length || 0,
      following: targetUser.following?.length || 0,
      followerRequests: targetUser.followerRequests?.length || 0
    };

    console.log(`✅ AUTO-SYNC COMPLETED: Created ${createdCount} new notifications`);

    return {
      createdCount,
      userStats
    };

  } catch (err) {
    console.error("❌ Auto-sync error:", err);
    return { createdCount: 0, userStats: {} };
  }
};
// Add this debug endpoint to check notifications
exports.debugNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId)
      .select("fullName posts followers following")
      .populate("followers", "fullName")
      .populate("following", "fullName")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Check existing notifications
    const existingNotifications = await Notification.find({
      recipient: new mongoose.Types.ObjectId(userId)
    })
    .populate("sender", "fullName")
    .populate("post", "description")
    .lean();

    // Analyze what notifications SHOULD exist
    const expectedNotifications = [];

    // Check for POST notifications to followers
    if (user.posts && user.posts.length > 0) {
      user.posts.forEach(post => {
        if (user.followers && user.followers.length > 0) {
          user.followers.forEach(follower => {
            const shouldHaveNotif = existingNotifications.find(n => 
              n.type === 'post' && 
              n.post && n.post._id.toString() === post._id.toString() &&
              n.recipient.toString() === follower._id.toString()
            );
            
            if (!shouldHaveNotif) {
              expectedNotifications.push({
                type: 'MISSING_POST_NOTIFICATION',
                for: 'FOLLOWERS',
                postId: post._id,
                postDescription: post.description?.substring(0, 30),
                followerId: follower._id,
                followerName: follower.fullName
              });
            }
          });
        }
      });
    }

    // Check for COMMENT notifications
    if (user.posts && user.posts.length > 0) {
      user.posts.forEach(post => {
        if (post.comments && post.comments.length > 0) {
          post.comments.forEach(comment => {
            // The post owner should get notification for comments
            const shouldHaveNotif = existingNotifications.find(n => 
              n.type === 'comment' && 
              n.post && n.post._id.toString() === post._id.toString() &&
              n.reference && n.reference.commentId && n.reference.commentId.toString() === comment._id.toString()
            );
            
            if (!shouldHaveNotif) {
              expectedNotifications.push({
                type: 'MISSING_COMMENT_NOTIFICATION',
                for: 'POST_OWNER',
                postId: post._id,
                postDescription: post.description?.substring(0, 30),
                commentId: comment._id,
                commentText: comment.text?.substring(0, 30),
                commenterId: comment.userId
              });
            }
          });
        }
      });
    }

    // Check for MENTION notifications
    if (user.posts && user.posts.length > 0) {
      user.posts.forEach(post => {
        if (post.mentions && post.mentions.length > 0) {
          post.mentions.forEach(mentionedUserId => {
            // Mentioned user should get notification
            const shouldHaveNotif = existingNotifications.find(n => 
              n.type === 'mention' && 
              n.post && n.post._id.toString() === post._id.toString() &&
              n.recipient.toString() === mentionedUserId.toString()
            );
            
            if (!shouldHaveNotif) {
              expectedNotifications.push({
                type: 'MISSING_MENTION_NOTIFICATION',
                for: 'MENTIONED_USER',
                postId: post._id,
                postDescription: post.description?.substring(0, 30),
                mentionedUserId: mentionedUserId
              });
            }
          });
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification analysis completed",
      data: {
        user: {
          fullName: user.fullName,
          postsCount: user.posts?.length || 0,
          followersCount: user.followers?.length || 0,
          followingCount: user.following?.length || 0
        },
        existingNotifications: {
          total: existingNotifications.length,
          byType: existingNotifications.reduce((acc, n) => {
            acc[n.type] = (acc[n.type] || 0) + 1;
            return acc;
          }, {})
        },
        missingNotifications: {
          total: expectedNotifications.length,
          details: expectedNotifications
        },
        postsAnalysis: user.posts?.map(post => ({
          postId: post._id,
          description: post.description?.substring(0, 50),
          likes: post.likes?.length || 0,
          comments: post.comments?.length || 0,
          mentions: post.mentions?.length || 0
        })) || []
      }
    });

  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).json({ success: false, message: "Debug error", error: err.message });
  }
};

/**
 * markAsRead
 */
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) return res.status(400).json({ success: false, message: "Invalid notificationId" });

    const updated = await Notification.findByIdAndUpdate(notificationId, { isRead: true, readAt: new Date() }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Notification not found" });

    res.status(200).json({ success: true, message: "Notification marked as read", data: updated });
  } catch (error) {
    console.error("markAsRead error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * markAllAsRead
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: "Invalid userId" });

    const result = await Notification.updateMany({ recipient: mongoose.Types.ObjectId(userId), isRead: false }, { isRead: true, readAt: new Date() });
    res.status(200).json({ success: true, message: "All notifications marked as read", data: { updatedCount: result.modifiedCount || result.nModified || result.modifiedCount }});
  } catch (error) {
    console.error("markAllAsRead error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * deleteNotification - deletes notification and optionally source data (comment/like/mention)
 */
exports.deleteNotification = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { notificationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    const notification = await Notification.findById(notificationId).session(session);
    if (!notification) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    // Delete related source data for comment/like/mention etc.
    if (notification.type === "comment" && notification.reference?.commentId && notification.post) {
      await Auth.findOneAndUpdate(
        { "posts._id": notification.post },
        { $pull: { "posts.$.comments": { _id: notification.reference.commentId } } },
        { session }
      );
    }

    if (notification.type === "like" && notification.post && notification.sender) {
      await Auth.findOneAndUpdate(
        { "posts._id": notification.post },
        { $pull: { "posts.$.likes": mongoose.Types.ObjectId(notification.sender) } },
        { session }
      );
    }

    if (notification.type === "mention" && notification.post && notification.recipient) {
      await Auth.findOneAndUpdate(
        { "posts._id": notification.post },
        { $pull: { "posts.$.mentions": mongoose.Types.ObjectId(notification.recipient) } },
        { session }
      );
    }

    if (notification.type === "follow_request" && notification.sender && notification.recipient) {
      await Auth.findByIdAndUpdate(notification.recipient, { $pull: { followerRequests: mongoose.Types.ObjectId(notification.sender) } }, { session });
    }

    if (notification.type === "follow" && notification.sender && notification.recipient) {
      await Auth.findByIdAndUpdate(notification.recipient, { $pull: { followers: mongoose.Types.ObjectId(notification.sender) } }, { session });
      await Auth.findByIdAndUpdate(notification.sender, { $pull: { following: mongoose.Types.ObjectId(notification.recipient) } }, { session });
    }

    if (notification.type === "message" && notification.reference?.chatId) {
      await Message.findByIdAndDelete(notification.reference.chatId).session(session);
    }

    await Notification.findByIdAndDelete(notificationId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ success: true, message: "Notification and source data deleted successfully ✅", data: { deletedNotificationId: notificationId } });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("deleteNotification error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * getUnreadCount
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const count = await Notification.countDocuments({
      recipient: new mongoose.Types.ObjectId(userId),
      isRead: false,
      isDeleted: { $ne: true },
    });

    return res.status(200).json({ success: true, message: "Unread count fetched", data: { unreadCount: count } });
  } catch (err) {
    console.error("getUnreadCount error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * updateNotificationPreferences
 */
exports.updateNotificationPreferences = async (req, res) => {
  try {
    const { userId, preferences } = req.body;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.notificationPreferences = { ...(user.notificationPreferences || {}), ...(preferences || {}) };
    await user.save();

    return res.status(200).json({ success: true, message: "Preferences updated", data: user.notificationPreferences });
  } catch (err) {
    console.error("updateNotificationPreferences error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * getNotificationPreferences
 */
exports.getNotificationPreferences = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    const user = await Auth.findById(userId).select("notificationPreferences");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    return res.status(200).json({ success: true, message: "Preferences fetched", data: user.notificationPreferences || {} });
  } catch (err) {
    console.error("getNotificationPreferences error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};
