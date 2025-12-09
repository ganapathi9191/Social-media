const mongoose = require('mongoose');
const { uploadImages } = require('../config/cloudinary');
const { Message, Chat } = require('../models/messageModel');
const { Auth } = require('../models/authModel');

/* ============================================================
   CHECK MUTUAL FOLLOW (CAN CHAT)
============================================================ */
exports.canChat = async (userId, targetId) => {
  try {
    const user = await Auth.findById(userId);
    const target = await Auth.findById(targetId);
    if (!user || !target) return false;

    return (
      user.following.includes(targetId) &&
      target.following.includes(userId)
    );
  } catch (error) {
    console.error("Error checking chat permission:", error);
    return false;
  }
};

/* ============================================================
   CHAT PERMISSION ROUTE
============================================================ */
exports.chat = async (req, res) => {
  try {
    const { userId, targetId } = req.body;

    const canChat = await exports.canChat(userId, targetId);

    if (!canChat) {
      return res.status(403).json({
        success: false,
        message: "You can only chat with users you mutually follow",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Chat allowed",
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   GET OR CREATE CHAT
============================================================ */
exports.getOrCreateChat = async (req, res) => {
  try {
    const { userId, targetId } = req.body;

    if (!userId || !targetId) {
      return res.status(400).json({ success: false, message: 'User ID and Target ID are required' });
    }

    const canUserChat = await this.canChat(userId, targetId);
    const canTargetChat = await this.canChat(targetId, userId);

    if (!canUserChat || !canTargetChat) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only chat with approved followers' 
      });
    }

    let chat = await Chat.findOne({
      participants: { $all: [userId, targetId] }
    }).populate('participants', 'fullName profile.username profile.image');

    if (!chat) {
      chat = new Chat({ participants: [userId, targetId] });
      await chat.save();

      chat = await Chat.findById(chat._id)
        .populate('participants', 'fullName profile.username profile.image');
    }

    res.status(200).json({
      success: true,
      message: 'Chat retrieved successfully',
      data: chat
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/* ============================================================
   SEND MESSAGE (Real-time integrated with Socket.IO)
============================================================ */
exports.sendMessage = async (req, res) => {
  try {
    const { chatId, senderId, receiverId, type } = req.body;

    const io = req.app.get("io"); // Get Socket.IO instance

    const text =
      req.body.text ||
      req.body.message ||
      req.body?.content?.text ||
      "";

    // Image uploads
    let mediaUrls = [];
    if (type === "image" && req.files && req.files.length > 0) {
      const uploads = await Promise.all(
        req.files.map(async (file) => {
          return await uploadImages(file.buffer, file.originalname);
        })
      );
      mediaUrls = uploads;
    }

    const newMessage = new Message({
      chatId,
      sender: senderId,
      receiver: receiverId,
      type: type || (mediaUrls.length > 0 ? "image" : "text"),
      content: {
        text: text.trim(),
        mediaUrl: mediaUrls,
      },
    });

    const savedMessage = await newMessage.save();

    // Update chat's last message
    await Chat.findByIdAndUpdate(chatId, { 
      lastMessage: savedMessage._id,
      updatedAt: new Date()
    });

    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .lean();

    populatedMessage.text = populatedMessage.content?.text || "";
    populatedMessage.mediaUrl = populatedMessage.content?.mediaUrl || [];

    /* ======================================================
       🔥 SOCKET.IO REAL-TIME EVENTS
    ====================================================== */

    // Emit to chat room (both participants)
    io.to(chatId).emit("newMessage", populatedMessage);

    // Send notification to receiver's personal room
    io.to(receiverId).emit("messageNotification", {
      ...populatedMessage,
      chatId,
      senderId
    });

    // Emit incoming message to receiver
    io.to(receiverId).emit("incomingMessage", populatedMessage);

    // Stop typing indicator for sender
    io.to(chatId).emit('userTyping', { 
      userId: senderId, 
      isTyping: false 
    });

    res.status(200).json({
      success: true,
      message: "Message sent successfully",
      data: populatedMessage,
    });

  } catch (error) {
    console.error("Message Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
};

/* ============================================================
   GET MESSAGES (With pagination)
============================================================ */
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.query; // Optional: to filter deleted messages
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    let query = { chatId };
    
    // Filter out messages deleted by this user
    if (userId) {
      query.deletedFor = { $ne: userId };
    }

    const messages = await Message.find(query)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalMessages = await Message.countDocuments(query);

    const formattedMessages = messages.map(msg => ({
      _id: msg._id,
      chatId: msg.chatId,
      sender: msg.sender,
      receiver: msg.receiver,
      type: msg.type,
      text: msg.content?.text || "",
      mediaUrl: msg.content?.mediaUrl || [],
      isRead: msg.isRead,
      readAt: msg.readAt,
      deletedFor: msg.deletedFor,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: "Messages retrieved successfully",
      data: formattedMessages,
      page,
      totalPages: Math.ceil(totalMessages / limit),
      totalMessages
    });
  } catch (err) {
    console.error("Get Messages Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* ============================================================
   GET USER CHATS
============================================================ */
exports.getUserChats = async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Sort by updatedAt DESC to show latest chats first
    const chats = await Chat.find({
      participants: userId,
      isBlocked: false
    })
      .populate('participants', 'fullName profile.username profile.image')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'sender receiver',
          select: 'fullName profile.username profile.image'
        }
      })
      .sort({ updatedAt: -1 }) // ✅ NEWEST FIRST
      .lean();

    // Get unread count for each chat
    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chatId: chat._id,
          receiver: userId,
          isRead: false,
          deletedFor: { $ne: userId }
        });

        // ✅ Format last message properly
        let lastMessageFormatted = null;
        if (chat.lastMessage) {
          lastMessageFormatted = {
            _id: chat.lastMessage._id,
            text: chat.lastMessage.content?.text || '',
            mediaUrl: chat.lastMessage.content?.mediaUrl || [],
            type: chat.lastMessage.type || 'text',
            sender: chat.lastMessage.sender,
            receiver: chat.lastMessage.receiver,
            isRead: chat.lastMessage.isRead,
            createdAt: chat.lastMessage.createdAt
          };
        }

        return {
          _id: chat._id,
          participants: chat.participants,
          lastMessage: lastMessageFormatted,
          unreadCount,
          isBlocked: chat.isBlocked,
          blockedBy: chat.blockedBy,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt
        };
      })
    );

    // ✅ Sort again by updatedAt (in case async operations changed order)
    chatsWithUnread.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.status(200).json({
      success: true,
      message: 'Chats retrieved successfully (sorted by latest)',
      data: chatsWithUnread,
      count: chatsWithUnread.length
    });

  } catch (error) {
    console.error('getUserChats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
};

/* ============================================================
   MARK AS READ (REAL-TIME)
============================================================ */
exports.markAsRead = async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    const io = req.app.get("io");

    const result = await Message.updateMany(
      { chatId, receiver: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    // Get the messageIds that were marked as read
    const markedMessages = await Message.find({
      chatId, 
      receiver: userId, 
      isRead: true
    }).select('_id');

    const messageIds = markedMessages.map(msg => msg._id.toString());

    // 🔥 Real-time update to chat room
    io.to(chatId).emit("messagesRead", { 
      chatId, 
      userId,
      messageIds 
    });

    // 🔥 Also emit to sender specifically
    io.to(chatId).emit("messagesMarkedRead", { 
      userId, 
      messageIds 
    });

    res.status(200).json({
      success: true,
      message: 'Messages marked as read successfully',
      data: { 
        modifiedCount: result.modifiedCount,
        messageIds 
      },
    });

  } catch (error) {
    console.error("Mark As Read Error:", error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

/* ============================================================
   DELETE MESSAGE FOR SINGLE USER (SOFT DELETE)
============================================================ */
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId, userId } = req.body;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    if (message.sender.toString() !== userId && message.receiver.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
    }

    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
      await message.save();
    }

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/* ============================================================
   DELETE MESSAGE FOR BOTH (PERMANENT DELETE) - REAL-TIME
============================================================ */
exports.deletechatmessage = async (req, res) => {
  try {
    const { messageId, userId } = req.params;
    const io = req.app.get("io");

    if (!messageId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Message ID and User ID are required in params",
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // Check if user is either sender or receiver
    if (
      message.sender.toString() !== userId &&
      message.receiver.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this message",
      });
    }

    const chatId = message.chatId;

    // Permanently delete the message
    await Message.findByIdAndDelete(messageId);

    // Update Chat last message if deleted message was last one
    const chat = await Chat.findById(chatId);
    if (chat && chat.lastMessage?.toString() === messageId) {
      const latestMessage = await Message.findOne({ chatId: chat._id })
        .sort({ createdAt: -1 })
        .select("_id");

      chat.lastMessage = latestMessage ? latestMessage._id : null;
      await chat.save();
    }

    // 🔥 Real-time event to chat room
    io.to(chatId).emit('messageRemoved', { 
      messageId, 
      deletedBy: userId,
      chatId 
    });

    // 🔥 Also emit messageDeleted event
    io.to(chatId).emit('messageDeleted', {
      chatId,
      messageId,
      userId
    });

    res.status(200).json({
      success: true,
      message: "Message deleted for both sender and receiver",
    });
  } catch (error) {
    console.error("Delete Message Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ============================================================
   BLOCK CHAT (REAL-TIME)
============================================================ */
exports.blockChat = async (req, res) => {
  try {
    const { chatId, userId, blockedUserId } = req.body;
    const io = req.app.get("io");

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

    chat.isBlocked = true;
    chat.blockedBy = userId;
    await chat.save();

    // 🔥 Real-time event to chat room
    io.to(chatId).emit("chatBlocked", { 
      chatId, 
      blockedBy: userId,
      blockedUser: blockedUserId 
    });

    // 🔥 Also emit to both users specifically
    io.to(chatId).emit("chatBlockedNotification", { 
      chatId, 
      blockedBy: userId, 
      blockedUser: blockedUserId 
    });

    res.status(200).json({
      success: true,
      message: 'Chat blocked successfully',
      data: chat
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/* ============================================================
   UNBLOCK CHAT (REAL-TIME)
============================================================ */
exports.unblockChat = async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    const io = req.app.get("io");

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

    chat.isBlocked = false;
    chat.blockedBy = null;
    await chat.save();

    // 🔥 Real-time event to chat room
    io.to(chatId).emit("chatUnblocked", { 
      chatId, 
      unblockedBy: userId 
    });

    // 🔥 Also emit notification
    io.to(chatId).emit("chatUnblockedNotification", { 
      chatId, 
      unblockedBy: userId 
    });

    res.status(200).json({
      success: true,
      message: 'Chat unblocked successfully',
      data: chat
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/* ============================================================
   UNREAD MESSAGE COUNT
============================================================ */
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const count = await Message.countDocuments({
      receiver: userId,
      isRead: false,
      deletedFor: { $ne: userId }
    });

    res.status(200).json({
      success: true,
      message: 'Unread count retrieved successfully',
      data: { unreadCount: count }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

/* ============================================================
   GET UNREAD COUNT PER CHAT
============================================================ */
exports.getUnreadCountPerChat = async (req, res) => {
  try {
    const { userId, chatId } = req.params;

    const count = await Message.countDocuments({
      chatId,
      receiver: userId,
      isRead: false,
      deletedFor: { $ne: userId }
    });

    res.status(200).json({
      success: true,
      message: 'Unread count for chat retrieved successfully',
      data: { chatId, unreadCount: count }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};


/* ============================================================
   GET ALL CHATS BY USER ID (LATEST FIRST + ONLINE STATUS)
============================================================ */
exports.getAllChatsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Fetch chats for this user
    const chats = await Chat.find({
      participants: userId
    })
      .populate("participants", "fullName profile.username profile.image")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender receiver",
          select: "fullName profile.username profile.image"
        }
      })
      .sort({ updatedAt: -1 })
      .lean();

    const formattedChats = await Promise.all(
      chats.map(async (chat) => {

        // ---------------------------------------------------------
        // UNREAD MESSAGES
        // ---------------------------------------------------------
        const unreadCount = await Message.countDocuments({
          chatId: chat._id,
          receiver: userId,
          isRead: false,
          deletedFor: { $ne: userId }
        });

        // ---------------------------------------------------------
        // LAST MESSAGE
        // ---------------------------------------------------------
        let lastMessage = null;

        if (chat.lastMessage) {
          lastMessage = {
            _id: chat.lastMessage._id,
            text: chat.lastMessage.content?.text || "",
            mediaUrl: chat.lastMessage.content?.mediaUrl || [],
            type: chat.lastMessage.type || "text",
            sender: chat.lastMessage.sender,
            receiver: chat.lastMessage.receiver,
            createdAt: chat.lastMessage.createdAt,
            isRead: chat.lastMessage.isRead
          };
        } else {
          // fallback find last message
          const fallback = await Message.findOne({ chatId: chat._id })
            .sort({ createdAt: -1 })
            .populate("sender receiver", "fullName profile.username profile.image");

          if (fallback) {
            lastMessage = {
              _id: fallback._id,
              text: fallback.content?.text || "",
              mediaUrl: fallback.content?.mediaUrl || [],
              type: fallback.type,
              sender: fallback.sender,
              receiver: fallback.receiver,
              createdAt: fallback.createdAt,
              isRead: fallback.isRead
            };
          }
        }

        // ---------------------------------------------------------
        // ONLINE STATUS USING GLOBAL onlineUsers Map
        // ---------------------------------------------------------
        let otherUser = chat.participants.find(p => p._id.toString() !== userId);
        const isOnline = global.onlineUsers.has(otherUser._id.toString());
        const lastSeen = global.lastSeen.get(otherUser._id.toString()) || null;

        return {
          _id: chat._id,
          participants: chat.participants,
          lastMessage,
          unreadCount,
          isBlocked: chat.isBlocked,
          blockedBy: chat.blockedBy,
          isOnline,
          lastSeen,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        };

      })
    );

    // Re-sort after async processing
    formattedChats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.status(200).json({
      success: true,
      message: "Chats retrieved successfully",
      count: formattedChats.length,
      data: formattedChats
    });

  } catch (error) {
    console.error("getAllChatsByUserId Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ============================================================
   GET LAST MESSAGE BETWEEN TWO USERS
============================================================ */
exports.getLastMessage = async (req, res) => {
  try {
    const { chatId } = req.params;

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "Chat ID is required",
      });
    }

    const lastMessage = await Message.findOne({ chatId })
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .lean();

    if (!lastMessage) {
      return res.status(404).json({
        success: false,
        message: "No messages found for this chat",
      });
    }

    const formattedMessage = {
      _id: lastMessage._id,
      chatId: lastMessage.chatId,
      sender: lastMessage.sender,
      receiver: lastMessage.receiver,
      type: lastMessage.type,
      text: lastMessage.content?.text || "",
      mediaUrl: lastMessage.content?.mediaUrl || [],
      isRead: lastMessage.isRead,
      readAt: lastMessage.readAt,
      deletedFor: lastMessage.deletedFor,
      createdAt: lastMessage.createdAt,
      updatedAt: lastMessage.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: "Last message retrieved successfully",
      data: formattedMessage,
    });

  } catch (error) {
    console.error("Get Last Message Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ============================================================
   MESSAGE DELIVERY CONFIRMATION (REAL-TIME)
============================================================ */
exports.confirmDelivery = async (req, res) => {
  try {
    const { messageId, chatId } = req.body;
    const io = req.app.get("io");

    const message = await Message.findByIdAndUpdate(
      messageId,
      { isDelivered: true, deliveredAt: new Date() },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found"
      });
    }

    // 🔥 Real-time delivery confirmation
    io.to(chatId).emit('deliveryConfirmed', { 
      messageId,
      chatId,
      deliveredAt: message.deliveredAt
    });

    res.status(200).json({
      success: true,
      message: "Delivery confirmed",
      data: message
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
};

// ===============================
//  ONLINE / OFFLINE CONTROLLER
// ===============================

/* ============================================================
   GET USER STATUS (ONLINE/OFFLINE)
============================================================ */
exports.getUserStatus = (req, res) => {
  const { userId } = req.params;

  const isOnline = global.onlineUsers.has(userId);
  const lastSeen = global.lastSeen.get(userId) || null;

  return res.status(200).json({
    success: true,
    userId,
    status: isOnline ? "online" : "offline",
    lastSeen: isOnline ? null : lastSeen
  });
};

/* ============================================================
   GET ALL ONLINE USERS
============================================================ */
exports.getAllOnlineUsers = (req, res) => {
  const online = Array.from(global.onlineUsers.keys());

  return res.status(200).json({
    success: true,
    count: online.length,
    onlineUsers: online
  });
};

/* ============================================================
   GET LAST SEEN
============================================================ */
exports.getLastSeen = (req, res) => {
  const { userId } = req.params;

  return res.status(200).json({
    success: true,
    userId,
    lastSeen: global.lastSeen.get(userId) || null
  });
};

/* ============================================================
   TYPING INDICATOR (REAL-TIME)
============================================================ */
exports.setTyping = async (req, res) => {
  try {
    const { chatId, userId, isTyping } = req.body;
    const io = req.app.get("io");

    // 🔥 Real-time typing indicator
    io.to(chatId).emit('userTyping', { 
      userId, 
      isTyping,
      chatId 
    });

    res.status(200).json({
      success: true,
      message: 'Typing status updated'
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
};

/* ============================================================
   SEARCH MESSAGES IN CHAT
============================================================ */
exports.searchMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query, userId } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required"
      });
    }

    const messages = await Message.find({
      chatId,
      'content.text': { $regex: query, $options: 'i' },
      deletedFor: { $ne: userId }
    })
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const formattedMessages = messages.map(msg => ({
      _id: msg._id,
      chatId: msg.chatId,
      sender: msg.sender,
      receiver: msg.receiver,
      type: msg.type,
      text: msg.content?.text || "",
      mediaUrl: msg.content?.mediaUrl || [],
      isRead: msg.isRead,
      createdAt: msg.createdAt,
    }));

    res.status(200).json({
      success: true,
      message: "Search results retrieved successfully",
      data: formattedMessages,
      count: formattedMessages.length
    });

  } catch (error) {
    console.error("Search Messages Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};