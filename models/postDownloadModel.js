const mongoose = require("mongoose");

const postDownloadSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  postOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true
  },
  downloaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true
  },
  mediaType: {
    type: String,
    enum: ["image", "video"],
    required: true
  },
  coinsUsed: {
    type: Number,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("PostDownload", postDownloadSchema);
