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
      limit = 50, 
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

    // Build query for notifications
    const query = {
      recipient: userObjectId,
      isDeleted: { $ne: true }
    };

    // Filter by type if provided
    if (type && type !== 'all') {
      query.type = type;
    }

    // Filter by read status
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Get ALL notifications first
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
      .lean();

    console.log(`✅ FOUND ${allNotifications.length} NOTIFICATIONS for user ${userId}`);

    // GET LIVE MESSAGES (unread messages as notifications)
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
    .populate("receiver", "fullName profile")
    .sort({ createdAt: -1 })
    .lean();

    console.log(`💬 FOUND ${unreadMessages.length} UNREAD MESSAGES for user ${userId}`);

    // Convert messages to notification format
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
        isMessage: true,
        isLatestNotification: false
      },
      // Mark as message for easy identification
      isMessage: true,
      messageData: {
        text: message.content?.text,
        mediaUrl: message.content?.mediaUrl || [],
        type: message.type,
        chatId: message.chatId
      }
    }));

    // COMBINE NOTIFICATIONS AND MESSAGES
    const allItems = [...allNotifications, ...messageNotifications];
    
    // Sort combined items by createdAt (newest first)
    allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    console.log(`📊 TOTAL ITEMS: ${allItems.length} (${allNotifications.length} notifications + ${messageNotifications.length} messages)`);

    // LATEST NOTIFICATIONS LOGIC - Group by type and get latest
    const itemsByType = {};
    
    allItems.forEach(item => {
      const type = item.type;
      if (!itemsByType[type]) {
        itemsByType[type] = [];
      }
      itemsByType[type].push(item);
    });

    // Get the latest item for each type
    const latestItems = Object.keys(itemsByType).map(type => {
      const typeItems = itemsByType[type];
      // Already sorted by createdAt: -1, so first is latest
      const latestItem = typeItems[0];
      
      return {
        ...latestItem,
        isLatest: true,
        latestForType: type,
        totalCountForType: typeItems.length,
        metadata: {
          ...latestItem.metadata,
          isLatestNotification: true,
          representsMultiple: typeItems.length > 1,
          totalSimilarNotifications: typeItems.length
        }
      };
    });

    // Sort latest items by createdAt (most recent first)
    latestItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Regular items (all except the latest ones)
    const latestItemIds = new Set(latestItems.map(n => n._id.toString()));
    const regularItems = allItems.filter(item => 
      !latestItemIds.has(item._id.toString())
    );

    console.log(`⭐ Found ${latestItems.length} latest items across ${Object.keys(itemsByType).length} types`);
    console.log(`📋 Regular items: ${regularItems.length}`);

    // FIXED: Get all post IDs from notifications and find their owners
    const postIdsFromNotifications = allItems
      .filter(item => !item.isMessage) // Only notifications have posts
      .map(item => {
        return item.post?._id || item.post || 
               (item.reference?.postId) || null;
      })
      .filter(Boolean)
      .map(id => new mongoose.Types.ObjectId(id));

    console.log(`📝 Looking for posts with IDs:`, postIdsFromNotifications);

    // Find all users who have these posts
    const usersWithPosts = await Auth.find({
      "posts._id": { $in: postIdsFromNotifications }
    })
    .select("fullName profile posts")
    .populate("posts.userId", "fullName profile")
    .populate("posts.mentions", "fullName profile")
    .lean();

    console.log(`👥 Found ${usersWithPosts.length} users with matching posts`);

    // Create a map of postId -> full post data
    const postMap = new Map();
    usersWithPosts.forEach(user => {
      user.posts?.forEach(post => {
        const postIdStr = post._id.toString();
        postMap.set(postIdStr, {
          _id: post._id,
          description: post.description,
          media: post.media || [],
          mentions: post.mentions || [],
          likes: post.likes || [],
          comments: post.comments || [],
          likesCount: post.likes?.length || 0,
          commentsCount: post.comments?.length || 0,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          user: {
            _id: user._id,
            fullName: user.fullName,
            username: user.profile?.username,
            image: user.profile?.image
          }
        });
      });
    });

    // FIXED: Also check if the current user has these posts (since they're the recipient)
    const currentUserPosts = await Auth.findById(userId)
      .select("fullName profile posts")
      .populate("posts.userId", "fullName profile")
      .populate("posts.mentions", "fullName profile")
      .lean();

    if (currentUserPosts) {
      currentUserPosts.posts?.forEach(post => {
        const postIdStr = post._id.toString();
        if (!postMap.has(postIdStr)) {
          postMap.set(postIdStr, {
            _id: post._id,
            description: post.description,
            media: post.media || [],
            mentions: post.mentions || [],
            likes: post.likes || [],
            comments: post.comments || [],
            likesCount: post.likes?.length || 0,
            commentsCount: post.comments?.length || 0,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            user: {
              _id: currentUserPosts._id,
              fullName: currentUserPosts.fullName,
              username: currentUserPosts.profile?.username,
              image: currentUserPosts.profile?.image
            }
          });
        }
      });
    }

    console.log(`🗺️ Post map has ${postMap.size} entries`);

    // Function to format a single item (notification or message)
    const formatItem = (item, isLatest = false) => {
      // Handle MESSAGES differently
      if (item.isMessage) {
        return {
          _id: item._id,
          type: 'message',
          message: item.message,
          createdAt: item.createdAt,
          isRead: item.isRead,
          readAt: item.readAt,
          
          // Sender information
          sender: item.sender ? {
            _id: item.sender._id,
            fullName: item.sender.fullName,
            email: item.sender.email,
            mobile: item.sender.mobile,
            gender: item.sender.gender,
            profile: {
              username: item.sender.profile?.username,
              image: item.sender.profile?.image,
              firstName: item.sender.profile?.firstName,
              lastName: item.sender.profile?.lastName,
              about: item.sender.profile?.about,
              website: item.sender.profile?.website
            }
          } : null,
          
          // Message-specific data
          messageData: item.messageData,
          reference: item.reference,
          
          // LATEST ITEM FIELDS
          isLatest: isLatest,
          latestForType: item.latestForType,
          totalCountForType: item.totalCountForType,
          
          // Additional metadata
          metadata: {
            isActionable: true,
            requiresResponse: false,
            canViewPost: false,
            priority: 'high',
            hasPost: false,
            hasComment: false,
            isMessage: true,
            isLatestNotification: isLatest,
            representsMultiple: isLatest && item.totalCountForType > 1,
            totalSimilarNotifications: item.totalCountForType || 1
          }
        };
      }

      // Handle REGULAR NOTIFICATIONS
      // Try to find the post in multiple ways
      let postDetails = null;
      let postId = null;

      // Method 1: Direct post reference
      if (item.post) {
        postId = item.post._id || item.post;
      }
      // Method 2: From reference
      else if (item.reference?.postId) {
        postId = item.reference.postId;
      }
      // Method 3: For comment notifications, the post should be in the notification
      else if (item.type === 'comment' && item.post) {
        postId = item.post._id || item.post;
      }

      if (postId) {
        const postIdStr = postId.toString();
        postDetails = postMap.get(postIdStr) || null;
      }

      // Create meaningful message based on type
      let actionMessage = item.message;
      if (!actionMessage && item.sender) {
        const actionMap = {
          'like': 'liked your post',
          'comment': 'commented on your post', 
          'mention': 'mentioned you in a post',
          'post': 'created a new post',
          'follow': 'started following you',
          'follow_request': 'sent you a follow request',
          'follow_approval': 'approved your follow request',
          'message': 'sent you a message'
        };
        
        let baseMessage = `${item.sender.fullName} ${actionMap[item.type] || 'sent you a notification'}`;
        
        // Enhance message for latest items that represent multiple
        if (isLatest && item.totalCountForType > 1) {
          if (item.type === 'like') {
            actionMessage = `${item.sender.fullName} and ${item.totalCountForType - 1} others liked your post`;
          } else if (item.type === 'comment') {
            actionMessage = `${item.sender.fullName} and ${item.totalCountForType - 1} others commented on your post`;
          } else if (item.type === 'follow') {
            actionMessage = `${item.sender.fullName} and ${item.totalCountForType - 1} others started following you`;
          } else if (item.type === 'message') {
            actionMessage = `${item.sender.fullName} and ${item.totalCountForType - 1} others sent you messages`;
          } else {
            actionMessage = `${baseMessage} (and ${item.totalCountForType - 1} more)`;
          }
        } else {
          actionMessage = baseMessage;
        }
      }

      // Build item data
      const itemData = {
        _id: item._id,
        type: item.type,
        message: actionMessage,
        createdAt: item.createdAt,
        isRead: item.isRead,
        readAt: item.readAt,
        
        // Sender information
        sender: item.sender ? {
          _id: item.sender._id,
          fullName: item.sender.fullName,
          email: item.sender.email,
          mobile: item.sender.mobile,
          gender: item.sender.gender,
          profile: {
            username: item.sender.profile?.username,
            image: item.sender.profile?.image,
            firstName: item.sender.profile?.firstName,
            lastName: item.sender.profile?.lastName,
            about: item.sender.profile?.about,
            website: item.sender.profile?.website
          }
        } : null,
        
        // Post information (only for notifications)
        post: postDetails,
        
        // Reference information
        reference: item.reference || {},
        
        // LATEST ITEM FIELDS
        isLatest: isLatest,
        latestForType: item.latestForType,
        totalCountForType: item.totalCountForType,
        
        // Additional metadata
        metadata: {
          isActionable: ['follow_request', 'message'].includes(item.type),
          requiresResponse: item.type === 'follow_request',
          canViewPost: !!postDetails,
          priority: item.type === 'follow_request' ? 'high' : 'normal',
          hasPost: !!postDetails,
          hasComment: !!item.reference?.commentId,
          isMessage: false,
          isLatestNotification: isLatest,
          representsMultiple: isLatest && item.totalCountForType > 1,
          totalSimilarNotifications: item.totalCountForType || 1
        }
      };

      return itemData;
    };

    // Format LATEST items first
    const formattedLatestItems = latestItems.map(item => 
      formatItem(item, true)
    );
    
    // Format REGULAR items
    const formattedRegularItems = regularItems.map(item => 
      formatItem(item, false)
    );

    // COMBINE: LATEST ITEMS FIRST, then regular ones
    const allFormattedItems = [
      ...formattedLatestItems,
      ...formattedRegularItems
    ];

    // Apply pagination to the combined array
    const paginatedItems = allFormattedItems.slice(skip, skip + limitNum);

    // Calculate statistics
    const totalCount = allFormattedItems.length;
    const unreadCount = allFormattedItems.filter(n => !n.isRead).length;
    const readCount = totalCount - unreadCount;

    // Enhanced type stats with latest item info
    const typeStats = allFormattedItems.reduce((acc, item) => {
      const type = item.type;
      if (!acc[type]) {
        acc[type] = { 
          total: 0, 
          unread: 0,
          percentage: 0,
          hasLatest: false,
          latestItemId: null,
          latestMessage: null
        };
      }
      acc[type].total++;
      if (!item.isRead) {
        acc[type].unread++;
      }
      if (item.isLatest) {
        acc[type].hasLatest = true;
        acc[type].latestItemId = item._id;
        acc[type].latestMessage = item.message;
      }
      return acc;
    }, {});

    // Calculate percentages
    Object.keys(typeStats).forEach(type => {
      typeStats[type].percentage = totalCount > 0 
        ? Math.round((typeStats[type].total / totalCount) * 100) 
        : 0;
    });

    // Prepare pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // LATEST ITEMS SUMMARY
    const latestSummary = {
      totalLatest: formattedLatestItems.length,
      typesWithLatest: formattedLatestItems.map(n => ({
        type: n.type,
        message: n.message,
        totalRepresented: n.totalCountForType,
        createdAt: n.createdAt,
        isMessage: n.metadata?.isMessage || false
      })),
      // Quick access to latest items
      latestItems: formattedLatestItems.map(n => ({
        _id: n._id,
        type: n.type,
        message: n.message,
        createdAt: n.createdAt,
        isRead: n.isRead,
        totalRepresented: n.totalCountForType,
        isMessage: n.metadata?.isMessage || false
      }))
    };

    // Prepare response with LATEST ITEMS FIRST
    const response = {
      success: true,
      message: `Found ${totalCount} items for user (${allNotifications.length} notifications + ${messageNotifications.length} messages)`,
      data: {
        // MAIN ITEMS ARRAY - LATEST FIRST (includes both notifications and messages)
        notifications: paginatedItems,
        
        // LATEST ITEMS SECTION (for easy access)
        latestNotifications: formattedLatestItems,
        
        // BREAKDOWN
        breakdown: {
          totalNotifications: allNotifications.length,
          totalMessages: messageNotifications.length,
          unreadNotifications: allNotifications.filter(n => !n.isRead).length,
          unreadMessages: messageNotifications.filter(m => !m.isRead).length
        },
        
        // SUMMARY
        latestSummary: latestSummary,
        summary: {
          total: totalCount,
          unread: unreadCount,
          read: readCount,
          byType: typeStats,
          readPercentage: totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0,
          unreadPercentage: totalCount > 0 ? Math.round((unreadCount / totalCount) * 100) : 0,
          postsWithData: allFormattedItems.filter(n => n.post).length,
          messagesWithData: allFormattedItems.filter(n => n.metadata?.isMessage).length,
          latestItemsCount: formattedLatestItems.length,
          regularItemsCount: formattedRegularItems.length
        },
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
        user: {
          _id: userId,
          totalItems: totalCount,
          unreadItems: unreadCount,
          latestItems: formattedLatestItems.length,
          unreadMessages: messageNotifications.length
        }
      },
      timestamp: new Date(),
      version: "5.0" // Version with MESSAGES + LATEST NOTIFICATIONS FIRST
    };

    res.status(200).json(response);

  } catch (err) {
    console.error("❌ Get all notifications error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching notifications and messages",
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

    // Check all notifications for this user
    const allNotifications = await Notification.find({
      recipient: new mongoose.Types.ObjectId(userId)
    })
    .populate("sender", "fullName profile.username")
    .populate("post", "description")
    .lean();

    // Check if any users have posts that should generate notifications
    const usersWithPosts = await Auth.find({ 
      "posts.0": { $exists: true } 
    })
    .select("fullName posts")
    .lean();

    // Check followers for the user
    const user = await Auth.findById(userId)
      .select("followers following posts")
      .populate("followers", "fullName")
      .populate("following", "fullName")
      .lean();

    res.status(200).json({
      success: true,
      debugInfo: {
        totalNotificationsInDB: allNotifications.length,
        notifications: allNotifications,
        userFollowers: user?.followers || [],
        userFollowing: user?.following || [],
        userPostsCount: user?.posts?.length || 0,
        totalUsersWithPosts: usersWithPosts.length,
        samplePosts: usersWithPosts.slice(0, 3).map(u => ({
          userId: u._id,
          fullName: u.fullName,
          postsCount: u.posts?.length || 0
        }))
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
