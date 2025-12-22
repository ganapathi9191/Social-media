// controllers/postDownloadController.js
const mongoose = require("mongoose");
const { Auth } = require("../models/authModel");
const Wallet = require("../models/walletModel");
const DownloadConfig = require("../models/downloadConfigModel");
const PostDownload = require("../models/postDownloadModel");

exports.downloadPost = async (req, res) => {
  try {
    const { postId, userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId) ||
        !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid postId or userId"
      });
    }

    /* ================= FIND POST ================= */
    const postOwner = await Auth.findOne({ "posts._id": postId });
    if (!postOwner) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    const post = postOwner.posts.id(postId);

    if (!post.media || post.media.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No downloadable media in this post"
      });
    }

    /* ================= DETECT MEDIA TYPE ================= */
    const mediaType = post.media.some(m => m.type === "video")
      ? "video"
      : "image";

    /* ================= GET ADMIN COIN CONFIG ================= */
    const config = await DownloadConfig.findOne({
      mediaType,
      isActive: true
    });

    if (!config) {
      return res.status(500).json({
        success: false,
        message: `Download config not set for ${mediaType}`
      });
    }

    const requiredCoins = config.coins;

    /* ================= WALLET CHECK ================= */
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.coins < requiredCoins) {
      return res.status(403).json({
        success: false,
        message: "Insufficient coins to download"
      });
    }

    /* ================= DEDUCT COINS ================= */
    wallet.coins -= requiredCoins;
    wallet.history.push({
      type: "download",
      coins: -requiredCoins,
      message: `Downloaded ${mediaType} post`
    });

    await wallet.save();

    /* ================= SAVE DOWNLOAD HISTORY ================= */
    const download = await PostDownload.create({
      postId,
      postOwnerId: postOwner._id,
      downloaderId: userId,
      mediaType,
      coinsUsed: requiredCoins
    });

    /* ================= RESPONSE ================= */
    res.status(200).json({
      success: true,
      message: "Post downloaded successfully ✅",
      data: {
        postId,
        mediaType,
        coinsDeducted: requiredCoins,
        remainingCoins: wallet.coins,
        downloadId: download._id
      }
    });

  } catch (error) {
    console.error("❌ downloadPost error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};
