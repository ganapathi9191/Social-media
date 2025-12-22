// controllers/postDownloadController.js
const mongoose = require("mongoose");
const { Auth } = require("../models/authModel");
const Wallet = require("../models/walletModel");
const DownloadConfig = require("../models/downloadConfigModel");
const PostDownload = require("../models/postDownloadModel");

/* ======================================================
   CREATE (DOWNLOAD POST)
====================================================== */
exports.downloadPost = async (req, res) => {
  try {
    const { postId, userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId) ||
        !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) return res.status(404).json({ success: false, message: "Post not found" });

    const post = postOwner.posts.id(postId);
    if (!post.media?.length) {
      return res.status(400).json({ success: false, message: "No downloadable media" });
    }

    const mediaType = post.media.some(m => m.type === "video") ? "video" : "image";

    const config = await DownloadConfig.findOne({ mediaType, isActive: true });
    if (!config) return res.status(500).json({ success: false, message: "Admin config missing" });

    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.coins < config.coins) {
      return res.status(403).json({ success: false, message: "Insufficient coins" });
    }

    wallet.coins -= config.coins;
    wallet.history.push({
      type: "download",
      coins: -config.coins,
      message: `Downloaded ${mediaType} post`
    });
    await wallet.save();

    const download = await PostDownload.create({
      postId,
      postOwnerId: postOwner._id,
      downloaderId: userId,
      mediaType,
      coinsUsed: config.coins
    });

    res.status(201).json({
      success: true,
      message: "Post downloaded successfully ✅",
      data: download
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ======================================================
   READ – ALL DOWNLOADS (ADMIN)
====================================================== */
exports.getAllDownloads = async (req, res) => {
  const downloads = await PostDownload.find()
    .populate("downloaderId", "fullName")
    .populate("postOwnerId", "fullName");

  res.json({ success: true, total: downloads.length, data: downloads });
};

/* ======================================================
   READ – BY USER
====================================================== */
exports.getDownloadsByUser = async (req, res) => {
  const { userId } = req.params;
  const downloads = await PostDownload.find({ downloaderId: userId });

  res.json({ success: true, total: downloads.length, data: downloads });
};

/* ======================================================
   READ – BY POST
====================================================== */
exports.getDownloadsByPost = async (req, res) => {
  const { postId } = req.params;
  const downloads = await PostDownload.find({ postId });

  res.json({ success: true, total: downloads.length, data: downloads });
};

/* ======================================================
   UPDATE (ADMIN ONLY)
====================================================== */
exports.updateDownload = async (req, res) => {
  const { downloadId } = req.params;
  const { coinsUsed } = req.body;

  const updated = await PostDownload.findByIdAndUpdate(
    downloadId,
    { coinsUsed },
    { new: true }
  );

  res.json({ success: true, message: "Download updated", data: updated });
};

/* ======================================================
   DELETE (ADMIN – OPTIONAL REFUND)
====================================================== */
exports.deleteDownload = async (req, res) => {
  const { downloadId } = req.params;

  const download = await PostDownload.findById(downloadId);
  if (!download) return res.status(404).json({ success: false });

  const wallet = await Wallet.findOne({ userId: download.downloaderId });
  if (wallet) {
    wallet.coins += download.coinsUsed;
    wallet.history.push({
      type: "refund",
      coins: download.coinsUsed,
      message: "Download refund"
    });
    await wallet.save();
  }

  await download.deleteOne();

  res.json({ success: true, message: "Download deleted & refunded" });
};
