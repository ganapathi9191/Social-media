const mongoose = require("mongoose");

const downloadConfigSchema = new mongoose.Schema({
  mediaType: {
    type: String,
    enum: ["image", "video"],
    required: true,
    unique: true
  },
  coins: {
    type: Number,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model("DownloadConfig", downloadConfigSchema);
