const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const coinRoutes =require("./routes/coinRoutes")


dotenv.config();

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = require('socket.io')(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ✅ CRITICAL: Attach Socket.IO instance to app for controllers
app.set('io', io);

// ✅ Also make io globally accessible (backup method)
global.io = io;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
// mongo
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error(err));

// Routes
app.use("/api", authRoutes);
app.use("/api", messageRoutes);
app.use("/api",coinRoutes);

// Health check route
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is running!',
    timestamp: new Date(),
    onlineUsers: Array.from(onlineUsers.keys()).length
  });
});

// -----------------------
// Socket.IO Chat Real-time Events
// -----------------------
const onlineUsers = new Map();   // userId -> socketId
const lastSeen = new Map();      // userId -> last active time
const userSockets = new Map();   // userId -> Set of socketIds (for multiple devices)

// Make available globally for all controllers
global.onlineUsers = onlineUsers;
global.lastSeen = lastSeen;
global.userSockets = userSockets;

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  // ✅ User goes online with their userId
  socket.on('userOnline', (userId) => {
    if (!userId) return;
    
    // Support multiple devices per user
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    
    onlineUsers.set(userId, socket.id);
    socket.userId = userId; // Store userId on socket for disconnect handling
    socket.join(userId); // Join personal room for notifications
    
    console.log(`✅ User ${userId} is online (Socket: ${socket.id})`);
    
    // Broadcast online status to all connected clients
    io.emit('userStatusChanged', { userId, status: 'online' });
  });

  // ✅ Join notification room for personal notifications
  socket.on('joinNotificationRoom', (userId) => {
    if (!userId) return;
    
    socket.join(userId);
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    console.log(`📢 User ${userId} joined notification room`);
  });

  // ✅ Join a specific chat room
  socket.on('joinChat', (chatId) => {
    if (!chatId) return;
    socket.join(chatId);
    console.log(`📩 Socket ${socket.id} joined chat: ${chatId}`);
    
    // Notify others in the chat that someone joined
    socket.to(chatId).emit('userJoinedChat', { 
      chatId, 
      userId: socket.userId,
      timestamp: new Date()
    });
  });

  // ✅ Leave a specific chat room
  socket.on('leaveChat', (chatId) => {
    if (!chatId) return;
    socket.leave(chatId);
    console.log(`👋 Socket ${socket.id} left chat: ${chatId}`);
    
    // Notify others in the chat that someone left
    socket.to(chatId).emit('userLeftChat', { 
      chatId, 
      userId: socket.userId,
      timestamp: new Date()
    });
  });

  // ✅ Typing indicator in chat
  socket.on('typing', ({ chatId, userId, isTyping }) => {
    if (!chatId || !userId) return;
    socket.to(chatId).emit('userTyping', { userId, isTyping, chatId });
    console.log(`✍️ User ${userId} ${isTyping ? 'started' : 'stopped'} typing in chat ${chatId}`);
  });

  // ✅ Message delivered acknowledgment
  socket.on('messageDelivered', ({ messageId, chatId }) => {
    if (!messageId || !chatId) return;
    io.to(chatId).emit('deliveryConfirmed', { messageId, chatId });
    console.log(`📨 Message ${messageId} delivered in chat ${chatId}`);
  });

  // ✅ Message read acknowledgment
  socket.on('messageRead', ({ chatId, userId, messageIds }) => {
    if (!chatId || !userId) return;
    socket.to(chatId).emit('messagesMarkedRead', { userId, messageIds, chatId });
    console.log(`👀 User ${userId} read ${messageIds?.length || 0} messages in chat ${chatId}`);
  });

  // ✅ Message deleted event
  socket.on('messageDeleted', ({ chatId, messageId, userId }) => {
    if (!chatId || !messageId) return;
    io.to(chatId).emit('messageRemoved', { messageId, deletedBy: userId, chatId });
    console.log(`🗑️ User ${userId} deleted message ${messageId} in chat ${chatId}`);
  });

  // ✅ Chat blocked event
  socket.on('chatBlocked', ({ chatId, userId, blockedUserId }) => {
    if (!chatId || !userId) return;
    io.to(chatId).emit('chatBlockedNotification', { 
      chatId, 
      blockedBy: userId, 
      blockedUser: blockedUserId 
    });
    console.log(`🚫 User ${userId} blocked chat ${chatId}`);
  });

  // ✅ Chat unblocked event
  socket.on('chatUnblocked', ({ chatId, userId }) => {
    if (!chatId || !userId) return;
    io.to(chatId).emit('chatUnblockedNotification', { 
      chatId, 
      unblockedBy: userId 
    });
    console.log(`✅ User ${userId} unblocked chat ${chatId}`);
  });

  // ✅ New message notification for recipient
  socket.on('newMessageNotification', ({ recipientId, message }) => {
    if (!recipientId || !message) return;
    io.to(recipientId).emit('incomingMessage', message);
    console.log(`📢 New message notification sent to user ${recipientId}`);
  });

  // ✅ Manual notification sending
  socket.on('sendNotification', ({ recipientId, notification }) => {
    if (!recipientId || !notification) return;
    console.log(`📢 Manual notification to user ${recipientId}`);
    io.to(recipientId).emit('newNotification', notification);
  });

  // ✅ Notification read event
  socket.on('notificationRead', ({ recipientId, notificationId }) => {
    if (!recipientId || !notificationId) return;
    io.to(recipientId).emit('notificationMarkedRead', { notificationId });
    console.log(`👀 Notification ${notificationId} marked as read by user ${recipientId}`);
  });

  // ✅ Notification deleted event
  socket.on('notificationDeleted', ({ recipientId, notificationId }) => {
    if (!recipientId || !notificationId) return;
    io.to(recipientId).emit('notificationRemoved', { notificationId });
    console.log(`🗑️ Notification ${notificationId} deleted by user ${recipientId}`);
  });

  // ✅ User goes offline (manual)
  socket.on('userOffline', (userId) => {
    if (!userId) return;
    
    handleUserOffline(userId, socket.id);
  });

  // ✅ Heartbeat/ping to keep connection alive
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // ✅ Update last seen timestamp
  socket.on('updateLastSeen', (userId) => {
    if (userId) {
      lastSeen.set(userId, new Date());
    }
  });

  // -----------------------
  // Disconnect handling
  // -----------------------
  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
    
    const userId = socket.userId;
    
    if (userId) {
      handleUserOffline(userId, socket.id);
    } else {
      // Find user by socket ID if userId not stored
      for (let [uid, sid] of onlineUsers.entries()) {
        if (sid === socket.id) {
          handleUserOffline(uid, socket.id);
          break;
        }
      }
    }
  });

  // -----------------------
  // Error handling
  // -----------------------
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});

// ✅ Helper function to handle user going offline
const handleUserOffline = (userId, socketId) => {
  // Remove socket from user's socket set
  if (userSockets.has(userId)) {
    userSockets.get(userId).delete(socketId);
    
    // If user has no more active sockets, mark as offline
    if (userSockets.get(userId).size === 0) {
      userSockets.delete(userId);
      onlineUsers.delete(userId);
      lastSeen.set(userId, new Date());
      
      io.emit('userStatusChanged', { 
        userId, 
        status: 'offline',
        lastSeen: new Date()
      });
      
      console.log(`🔴 User ${userId} is offline`);
    } else {
      console.log(`🔶 User ${userId} still has ${userSockets.get(userId).size} active connection(s)`);
    }
  } else {
    // Fallback for single device tracking
    onlineUsers.delete(userId);
    lastSeen.set(userId, new Date());
    
    io.emit('userStatusChanged', { 
      userId, 
      status: 'offline',
      lastSeen: new Date()
    });
    
    console.log(`🔴 User ${userId} is offline (disconnected)`);
  }
};

// ✅ Helper function to emit notifications from anywhere in the application
const emitNotification = (recipientId, notification) => {
  if (!recipientId || !notification) return;
  
  const socketId = onlineUsers.get(recipientId.toString());
  if (socketId) {
    io.to(recipientId.toString()).emit('newNotification', notification);
    console.log(`📡 Notification emitted to ${recipientId}`);
  } else {
    console.log(`⚠️ User ${recipientId} is offline, notification queued`);
  }
};

// ✅ Helper function to emit chat events from controllers
const emitToChat = (chatId, event, data) => {
  if (!chatId || !event) return;
  io.to(chatId).emit(event, data);
  console.log(`📡 Event ${event} emitted to chat ${chatId}`);
};

// ✅ Helper function to emit to specific user
const emitToUser = (userId, event, data) => {
  if (!userId || !event) return;
  
  const socketId = onlineUsers.get(userId.toString());
  if (socketId) {
    io.to(userId.toString()).emit(event, data);
    console.log(`📡 Event ${event} emitted to user ${userId}`);
  } else {
    console.log(`⚠️ User ${userId} is offline, event ${event} not delivered`);
  }
};

// ✅ Helper function to check if user is online
const isUserOnline = (userId) => {
  return onlineUsers.has(userId.toString()) || 
         (userSockets.has(userId.toString()) && userSockets.get(userId.toString()).size > 0);
};

// ✅ Helper function to get all online users
const getOnlineUsers = () => {
  return Array.from(onlineUsers.keys());
};

// Export helpers for use in controllers
module.exports.emitNotification = emitNotification;
module.exports.emitToChat = emitToChat;
module.exports.emitToUser = emitToUser;
module.exports.isUserOnline = isUserOnline;
module.exports.getOnlineUsers = getOnlineUsers;

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error', 
    error: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
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
const PORT = process.env.PORT || 5002;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Socket.IO enabled for chat features`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, closing server...');
  
  // Close all socket connections
  io.close(() => {
    console.log('✅ Socket.IO closed');
    
    server.close(() => {
      console.log('✅ Server closed');
      mongoose.connection.close(false, () => {
        console.log('✅ MongoDB connection closed');
        process.exit(0);
      });
    });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, closing server...');
  
  io.close(() => {
    console.log('✅ Socket.IO closed');
    
    server.close(() => {
      console.log('✅ Server closed');
      mongoose.connection.close(false, () => {
        console.log('✅ MongoDB connection closed');
        process.exit(0);
      });
    });
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = { app, server, io };