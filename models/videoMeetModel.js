const mongoose = require("mongoose");

// Media for chat
const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ["image", "video", "pdf"], required: true }
}, { _id: false });

// Chat
const chatSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String },
  media: [mediaSchema],
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

// Video Meeting
const videoMeetSchema = new mongoose.Schema({
  title: { type: String, required: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  meetLink: { type: String, required: true, unique: true },
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isPinned: { type: Boolean, default: false }
  }],
  chat: [chatSchema],
  isActive: { type: Boolean, default: true },
  startedAt: { type: Date },
  endedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model("VideoMeet", videoMeetSchema);
