const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");

dotenv.config();

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = require('socket.io')(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// ✅ CRITICAL: Attach Socket.IO instance to app for controllers
app.set('io', io);

// ✅ Also make io globally accessible (backup method)
global.io = io;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ Mongo Error:', err));

// Routes
app.use("/api", authRoutes);
app.use("/api", messageRoutes);

// Health check route
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is running!',
    timestamp: new Date()
  });
});

// -----------------------
// Socket.IO Chat Real-time Events
// -----------------------
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  // ✅ User goes online with their userId
  socket.on('userOnline', (userId) => {
    if (!userId) return;
    
    onlineUsers.set(userId, socket.id);
    socket.join(userId); // Join personal room for notifications
    console.log(`✅ User ${userId} is online and joined room: ${userId}`);
    
    // Broadcast online status to all connected clients
    io.emit('userStatusChanged', { userId, status: 'online' });
  });

  // ✅ Join notification room for personal notifications
  socket.on('joinNotificationRoom', (userId) => {
    if (!userId) return;
    
    socket.join(userId);
    onlineUsers.set(userId, socket.id);
    console.log(`📢 User ${userId} joined notification room`);
  });

  // ✅ Join a specific chat room
  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
    console.log(`📩 Socket ${socket.id} joined chat: ${chatId}`);
  });

  // ✅ Leave a specific chat room
  socket.on('leaveChat', (chatId) => {
    socket.leave(chatId);
    console.log(`👋 Socket ${socket.id} left chat: ${chatId}`);
  });

  // ✅ Typing indicator in chat
  socket.on('typing', ({ chatId, userId, isTyping }) => {
    socket.to(chatId).emit('userTyping', { userId, isTyping });
    console.log(`✍️ User ${userId} ${isTyping ? 'started' : 'stopped'} typing in chat ${chatId}`);
  });

  // ✅ Message delivered acknowledgment
  socket.on('messageDelivered', ({ messageId, chatId }) => {
    io.to(chatId).emit('deliveryConfirmed', { messageId });
    console.log(`📨 Message ${messageId} delivered in chat ${chatId}`);
  });

  // ✅ Message read acknowledgment
  socket.on('messageRead', ({ chatId, userId, messageIds }) => {
    socket.to(chatId).emit('messagesMarkedRead', { userId, messageIds });
    console.log(`👀 User ${userId} read messages in chat ${chatId}`);
  });

  // ✅ Message deleted event
  socket.on('messageDeleted', ({ chatId, messageId, userId }) => {
    io.to(chatId).emit('messageRemoved', { messageId, deletedBy: userId });
    console.log(`🗑️ User ${userId} deleted message ${messageId} in chat ${chatId}`);
  });

  // ✅ Chat blocked event
  socket.on('chatBlocked', ({ chatId, userId, blockedUserId }) => {
    io.to(chatId).emit('chatBlockedNotification', { 
      chatId, 
      blockedBy: userId, 
      blockedUser: blockedUserId 
    });
    console.log(`🚫 User ${userId} blocked chat ${chatId}`);
  });

  // ✅ Chat unblocked event
  socket.on('chatUnblocked', ({ chatId, userId }) => {
    io.to(chatId).emit('chatUnblockedNotification', { 
      chatId, 
      unblockedBy: userId 
    });
    console.log(`✅ User ${userId} unblocked chat ${chatId}`);
  });

  // ✅ New message notification for recipient
  socket.on('newMessageNotification', ({ recipientId, message }) => {
    io.to(recipientId).emit('incomingMessage', message);
    console.log(`📢 New message notification sent to user ${recipientId}`);
  });

  // ✅ Manual notification sending
  socket.on('sendNotification', ({ recipientId, notification }) => {
    console.log(`📢 Manual notification to user ${recipientId}`);
    io.to(recipientId).emit('newNotification', notification);
  });

  // ✅ Notification read event
  socket.on('notificationRead', ({ recipientId, notificationId }) => {
    io.to(recipientId).emit('notificationMarkedRead', { notificationId });
    console.log(`👀 Notification ${notificationId} marked as read by user ${recipientId}`);
  });

  // ✅ Notification deleted event
  socket.on('notificationDeleted', ({ recipientId, notificationId }) => {
    io.to(recipientId).emit('notificationRemoved', { notificationId });
    console.log(`🗑️ Notification ${notificationId} deleted by user ${recipientId}`);
  });

  // ✅ User goes offline
  socket.on('userOffline', (userId) => {
    onlineUsers.delete(userId);
    socket.leave(userId);
    io.emit('userStatusChanged', { userId, status: 'offline' });
    console.log(`🔴 User ${userId} went offline`);
  });

  // -----------------------
  // Disconnect handling
  // -----------------------
  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
    
    // Find and remove user from online users
    for (let [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        io.emit('userStatusChanged', { userId, status: 'offline' });
        console.log(`🔴 User ${userId} is offline (disconnected)`);
        break;
      }
    }
  });
});

// ✅ Helper function to emit notifications from anywhere in the application
const emitNotification = (recipientId, notification) => {
  const socketId = onlineUsers.get(recipientId.toString());
  if (socketId) {
    io.to(socketId).emit('newNotification', notification);
    console.log(`📡 Notification emitted to ${recipientId}`);
  } else {
    console.log(`⚠️ User ${recipientId} is offline, notification queued`);
  }
};

// ✅ Helper function to emit chat events from controllers
const emitToChat = (chatId, event, data) => {
  io.to(chatId).emit(event, data);
  console.log(`📡 Event ${event} emitted to chat ${chatId}`);
};

// ✅ Helper function to emit to specific user
const emitToUser = (userId, event, data) => {
  const socketId = onlineUsers.get(userId.toString());
  if (socketId) {
    io.to(socketId).emit(event, data);
    console.log(`📡 Event ${event} emitted to user ${userId}`);
  } else {
    console.log(`⚠️ User ${userId} is offline, event ${event} not delivered`);
  }
};

// Export helpers for use in controllers
module.exports.emitNotification = emitNotification;
module.exports.emitToChat = emitToChat;
module.exports.emitToUser = emitToUser;

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error', 
    error: err.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO enabled for chat features`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = { app, server, io };