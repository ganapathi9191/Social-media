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
    const { chatId, senderId, receiverId, type } = req.body;

    // ✅ Handle text safely for both JSON & form-data
    const text =
      req.body.text ||
      req.body.message ||
      req.body?.content?.text ||
      "";

    // ✅ Handle image uploads
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

    // ✅ Create message with proper text handling
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

    // ✅ Populate sender and receiver
    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "fullName profile.username profile.image")
      .populate("receiver", "fullName profile.username profile.image")
      .lean();

    // ✅ Add text and mediaUrl to top-level for cleaner output
    populatedMessage.text = populatedMessage.content?.text || "";
    populatedMessage.mediaUrl = populatedMessage.content?.mediaUrl || [];

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
      .lean(); // ✅ Convert to plain object for easy transformation

    const totalMessages = await Message.countDocuments({ chatId });

    // ✅ Flatten `content.text` and `content.mediaUrl` for cleaner response
    const formattedMessages = messages.map(msg => ({
      _id: msg._id,
      chatId: msg.chatId,
      sender: msg.sender,
      receiver: msg.receiver,
      type: msg.type,
      text: msg.content?.text || "",       // ✅ extract text clearly
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



// Get last message between two users or in a chat
exports.getLastMessage = async (req, res) => {
  try {
    const { chatId, senderId, receiverId } = req.query;

    // Validate inputs
    if (!chatId && (!senderId || !receiverId)) {
      return res.status(400).json({
        success: false,
        message: "chatId or (senderId and receiverId) are required",
      });
    }

    // Build filter
    let filter = {};
    if (chatId) {
      filter.chatId = chatId;
    } else {
      filter.$or = [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ];
    }

    // Fetch the last (most recent) message
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

    // Format output
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
exports.deleteMessage = async (req, res) => {
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

