const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require("path");
const authRoutes = require("./routes/authRoutes");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: { origin: "*" }
});

// Attach Socket.IO instance to app for later use
app.set('io', io);

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
  })
  .catch((err) => {
    console.error('Mongo Error:', err);
  });



app.use("/api", authRoutes);


// Socket.IO connection
io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;

// IMPORTANT: Use server.listen instead of app.listen
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
