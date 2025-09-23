const mongoose = require("mongoose");
const crypto = require("crypto");

// Media for chat
const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ["image", "video", "pdf"], required: true }
}, { _id: false });

// Chat
const chatSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true },
  message: { type: String },
  media: [mediaSchema],
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const participantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "Auth" },
  isPinned: { type: Boolean, default: false },
  invitedAt: { type: Date, default: Date.now }
}, { _id: false });

const sharedMediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ["video", "pdf"], required: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Auth" },
  playbackPosition: { type: Number, default: 0 }
}, { _id: true });

// Video Meeting
const videoMeetSchema = new mongoose.Schema({
  title: { type: String, required: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true },
  meetLink: {
    type: String,
    required: true,
    unique: true,
    default: () => `https://meet.yourdomain.com/${crypto.randomBytes(6).toString("hex")}`
  },
  participants: [participantSchema],
  chat: [chatSchema],
  sharedMedia: [sharedMediaSchema],
  screenShareActive: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  startedAt: { type: Date },
  endedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model("VideoMeet", videoMeetSchema);
