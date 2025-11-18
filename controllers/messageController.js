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
   SEND MESSAGE (real-time integrated)
============================================================ */
exports.sendMessage = async (req, res) => {
  try {
    const { chatId, senderId, receiverId, type } = req.body;

    const io = req.app.get("io"); // 🎯 Socket instance

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

    await Chat.findByIdAndUpdate(chatId, { lastMessage: savedMessage._id });

    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .lean();

    populatedMessage.text = populatedMessage.content?.text || "";
    populatedMessage.mediaUrl = populatedMessage.content?.mediaUrl || [];

    /* ======================================================
       🔥 SOCKET.IO REAL-TIME EVENTS
    ====================================================== */

    io.to(chatId).emit("newMessage", populatedMessage);

    io.to(receiverId).emit("messageNotification", populatedMessage);

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
   GET MESSAGES
============================================================ */
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ chatId })
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalMessages = await Message.countDocuments({ chatId });

    const formattedMessages = messages.map(msg => ({
      _id: msg._id,
      chatId: msg.chatId,
      sender: msg.sender,
      receiver: msg.receiver,
      type: msg.type,
      text: msg.content?.text || "",
      mediaUrl: msg.content?.mediaUrl || [],
      isRead: msg.isRead,
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

    const chats = await Chat.find({
      participants: userId,
      isBlocked: false
    })
      .populate('participants', 'fullName profile.username profile.image')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      message: 'Chats retrieved successfully',
      data: chats
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
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

    // 🔥 Real-time update
    io.to(chatId).emit("messagesRead", { chatId, userId });

    res.status(200).json({
      success: true,
      message: 'Messages marked as read successfully',
      data: { modifiedCount: result.modifiedCount },
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
   DELETE FOR SINGLE USER (SOFT DELETE)
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
   BLOCK CHAT (REAL-TIME)
============================================================ */
exports.blockChat = async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    const io = req.app.get("io");

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

    chat.isBlocked = true;
    chat.blockedBy = userId;
    await chat.save();

    // 🔥 Real-time event
    io.to(chatId).emit("chatBlocked", { chatId, userId });

    res.status(200).json({
      success: true,
      message: 'Chat blocked successfully'
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

    // 🔥 Real-time event
    io.to(chatId).emit("chatUnblocked", { chatId, userId });

    res.status(200).json({
      success: true,
      message: 'Chat unblocked successfully'
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
      isRead: false
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
   GET LAST MESSAGE BETWEEN TWO USERS
============================================================ */
exports.getLastMessage = async (req, res) => {
  try {
    const { chatId, senderId, receiverId } = req.query;

    let filter = {};
    if (chatId) {
      filter.chatId = chatId;
    } else {
      filter.$or = [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ];
    }

    const lastMessage = await Message.findOne(filter)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .sort({ createdAt: -1 })
      .lean();

    if (!lastMessage) {
      return res.status(404).json({
        success: false,
        message: "No messages found between these users",
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

// Delete message for both sender and receiver (permanent delete)
exports.deletechatmessage = async (req, res) => {
  try {
    const { messageId, userId } = req.params;

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

    // ✅ Check if user is either sender or receiver
    if (
      message.sender.toString() !== userId &&
      message.receiver.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this message",
      });
    }

    // ✅ Permanently delete the message (delete for both sides)
    await Message.findByIdAndDelete(messageId);

    // ✅ Optionally update Chat last message (if deleted message was last one)
    const chat = await Chat.findById(message.chatId);
    if (chat && chat.lastMessage?.toString() === messageId) {
      const latestMessage = await Message.findOne({ chatId: chat._id })
        .sort({ createdAt: -1 })
        .select("_id");

      chat.lastMessage = latestMessage ? latestMessage._id : null;
      await chat.save();
    }

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

