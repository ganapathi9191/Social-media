const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const meetRoutes = require("./routes/videoMeetRoutes");

dotenv.config();

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = require('socket.io')(server, {
  cors: { origin: "*" }
});

// Attach Socket.IO instance to app for controllers if needed
app.set('io', io);

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('Mongo Error:', err));

// Routes
app.use("/api", authRoutes);
app.use("/api", messageRoutes);
app.use("/api", meetRoutes);

// -----------------------
// Socket.IO real-time events
// -----------------------
io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  // Join a meeting room
  socket.on('joinRoom', ({ meetLink, userId }) => {
    socket.join(meetLink);
    socket.to(meetLink).emit('userJoined', { userId });
  });

  // Chat message in a meeting
  socket.on('sendMessage', ({ meetLink, sender, message }) => {
    io.to(meetLink).emit('receiveMessage', { sender, message });
  });

  // Mute/unmute mic
  socket.on('toggleMic', ({ meetLink, userId, status }) => {
    io.to(meetLink).emit('micToggled', { userId, status });
  });

  // Video on/off
  socket.on('toggleVideo', ({ meetLink, userId, status }) => {
    io.to(meetLink).emit('videoToggled', { userId, status });
  });

  // Screen share
  socket.on('shareScreen', ({ meetLink, userId }) => {
    io.to(meetLink).emit('screenShared', { userId });
  });

  // Leave room
  socket.on('leaveRoom', ({ meetLink, userId }) => {
    socket.leave(meetLink);
    io.to(meetLink).emit('userLeft', { userId });
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
