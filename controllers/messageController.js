const mongoose = require('mongoose');
const { uploadImages, uploadToCloudinary } = require('../config/cloudinary');
const { Message, Chat } = require('../models/messageModel');
const { Auth } = require('../models/authModel');


// Check if users can chat (must follow each other)
exports.canChat = async (userId, targetId) => {
  try {
    const user = await Auth.findById(userId);
    const target = await Auth.findById(targetId);
    if (!user || !target) return false;

    // ✅ Chat allowed only if both follow each other
    const isMutual =
      user.following.includes(targetId) &&
      target.following.includes(userId);

    return isMutual;
  } catch (error) {
    console.error("Error checking chat permission:", error);
    return false;
  }
};

// Chat route example
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

// Get or create chat
exports.getOrCreateChat = async (req, res) => {
  try {
    const { userId, targetId } = req.body;

    if (!userId || !targetId) {
      return res.status(400).json({ success: false, message: 'User ID and Target ID are required' });
    }

    // Check if users can chat
    const canUserChat = await this.canChat(userId, targetId);
    const canTargetChat = await this.canChat(targetId, userId);

    if (!canUserChat || !canTargetChat) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only chat with approved followers' 
      });
    }

    // Find existing chat
    let chat = await Chat.findOne({
      participants: { $all: [userId, targetId] }
    }).populate('participants', 'fullName profile.username profile.image');

    // Create new chat if doesn't exist
    if (!chat) {
      chat = new Chat({
        participants: [userId, targetId]
      });
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

// Send message
exports.sendMessage = async (req, res) => {
   try {
    const { chatId, senderId, receiverId, type, text } = req.body;

    // ✅ Upload multiple images if type is image and files exist
    let mediaUrls = [];
    if (type === "image" && req.files && req.files.length > 0) {
      const uploads = await Promise.all(
        req.files.map(async (file) => {
          const url = await uploadImages(file.buffer, file.originalname);
          return url;
        })
      );
      mediaUrls = uploads;
    }

    // ✅ Create message
    const newMessage = new Message({
      chatId,
      sender: senderId,
      receiver: receiverId,
      type,
      content: {
        text: text || "",
        mediaUrl: mediaUrls, // now stores array
      },
    });

    const savedMessage = await newMessage.save();

    // ✅ Update chat's last message
    await Chat.findByIdAndUpdate(chatId, { lastMessage: savedMessage._id });

    // ✅ Populate sender and receiver
    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image");

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
// Get messages for a chat
exports.getMessages = async (req, res) => {
  try {
    const { chatId, senderId, receiverId, type } = req.body;

    // ✅ Handle both JSON and multipart body
    const text =
      req.body.text ||
      req.body?.message ||
      req.body?.content?.text ||
      "";

    if (!chatId || !senderId || !receiverId) {
      return res.status(400).json({
        success: false,
        message: "chatId, senderId, and receiverId are required",
      });
    }

    let mediaUrls = [];

    // ✅ Upload images if available
    if (type === "image" && req.files && req.files.length > 0) {
      const uploads = await Promise.all(
        req.files.map(async (file) => {
          const url = await uploadImages(file.buffer, file.originalname);
          return url;
        })
      );
      mediaUrls = uploads;
    }

    // ✅ Create message document
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

    // ✅ Update chat last message
    await Chat.findByIdAndUpdate(chatId, { lastMessage: savedMessage._id });

    // ✅ Populate sender/receiver
    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image");

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

// Get user chats
exports.getUserChats = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

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

// Mark messages as read
exports.markAsRead = async (req, res) => {
  try {
    const { messageIds, userId } = req.body;

    if (!messageIds || !Array.isArray(messageIds) || !userId) {
      return res.status(400).json({ success: false, message: 'Message IDs array and User ID are required' });
    }

    await Message.updateMany(
      { _id: { $in: messageIds }, receiver: userId, isRead: false },
      { 
        isRead: true,
        readAt: new Date()
      }
    );

    res.status(200).json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Delete message
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId, userId } = req.body;

    if (!messageId || !userId) {
      return res.status(400).json({ success: false, message: 'Message ID and User ID are required' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Check if user is sender or receiver
    if (message.sender.toString() !== userId && message.receiver.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
    }

    // Add user to deletedFor array (soft delete)
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

// Block chat
exports.blockChat = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ success: false, message: 'Chat ID and User ID are required' });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    // Check if user is participant
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({ success: false, message: 'Not authorized to block this chat' });
    }

    chat.isBlocked = true;
    chat.blockedBy = userId;
    await chat.save();

    res.status(200).json({
      success: true,
      message: 'Chat blocked successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Unblock chat
exports.unblockChat = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ success: false, message: 'Chat ID and User ID are required' });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    // Check if user is the one who blocked
    if (chat.blockedBy.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to unblock this chat' });
    }

    chat.isBlocked = false;
    chat.blockedBy = null;
    await chat.save();

    res.status(200).json({
      success: true,
      message: 'Chat unblocked successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get unread message count
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

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