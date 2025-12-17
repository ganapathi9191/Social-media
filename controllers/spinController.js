// controllers/spinController.js
const Spin = require("../models/spinModel");
const Wallet = require("../models/walletModel");
const { Auth } = require("../models/authModel");
const mongoose = require("mongoose");


const SPIN_REWARDS = [
  { label: "1 Coin", coins: 1 },
  { label: "2 Coins", coins: 2 },
  { label: "3 Coins", coins: 3 },
  { label: "Spin Again", coins: 0, spinAgain: true },
  { label: "4 Coins", coins: 4 },
  { label: "5 Coins", coins: 5 },
  { label: "Better Luck Next Time", coins: 0 },
  { label: "2 Coins", coins: 2 }
];

const MAX_DAILY_SPINS = 2;
exports.spinWheel = async (req, res) => {
  try {
    const { userId } = req.body;

    /* ================= VALIDATE USER ================= */
    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    /* ================= TODAY ================= */
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const spinsToday = await Spin.countDocuments({
      userId,
      spinDate: today
    });

    if (spinsToday >= MAX_DAILY_SPINS) {
      return res.status(400).json({
        success: false,
        message: "Today's spins are over. Come back tomorrow ⏰"
      });
    }

    /* ================= PICK REWARD ================= */
    const reward =
      SPIN_REWARDS[Math.floor(Math.random() * SPIN_REWARDS.length)];

    const coinsWon = reward.coins || 0;

    /* ================= SAVE SPIN ================= */
    await Spin.create({
      userId,
      reward: reward.label,
      coins: coinsWon,
      spinDate: today
    });

    /* ================= WALLET (ALWAYS SAFE) ================= */
    let wallet = await Wallet.findOne({ userId });

    // 🔥 CREATE WALLET IF MISSING
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        coins: 10,
        history: [{
          type: "bonus",
          coins: 10,
          message: "Welcome bonus 🎁"
        }]
      });

      // link wallet safely
      user.wallet = wallet._id;
      await user.save();
    }

    // ➕ ADD COINS
    if (coinsWon > 0) {
      wallet.coins += coinsWon;
      wallet.history.push({
        type: "spin",
        coins: coinsWon,
        message: `🎉 You won ${coinsWon} coins`
      });
      await wallet.save();
    }

    /* ================= RESPONSE ================= */
    return res.status(200).json({
      success: true,
      message:
        reward.label === "Better Luck Next Time"
          ? "😔 Better luck next time"
          : reward.label === "Spin Again"
          ? "🔄 Spin again"
          : `🎉 Congratulations! You got ${coinsWon} coins`,
      data: {
        reward: reward.label,
        coinsWon,
        spinsLeft: MAX_DAILY_SPINS - (spinsToday + 1),
        walletCoins: wallet.coins   // ✅ ALWAYS SAFE
      }
    });

  } catch (error) {
    console.error("Spin Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/spin/:spinId
exports.getSpinById = async (req, res) => {
  try {
    const { spinId } = req.params;

    const spin = await Spin.findById(spinId);
    if (!spin) {
      return res.status(404).json({
        success: false,
        message: "Spin not found"
      });
    }

    res.status(200).json({
      success: true,
      data: spin
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// GET /api/spin/user/:userId
exports.getUserSpins = async (req, res) => {
  try {
    const { userId } = req.params;

    const spins = await Spin.find({ userId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      total: spins.length,
      data: spins
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// GET /api/spin/user/:userId/today
exports.getTodayUserSpins = async (req, res) => {
  try {
    const { userId } = req.params;

    const today = new Date();
    today.setHours(0,0,0,0);

    const spins = await Spin.find({
      userId,
      spinDate: today
    });

    res.status(200).json({
      success: true,
      spinsUsed: spins.length,
      data: spins
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// PUT /api/spin/:spinId
exports.updateSpin = async (req, res) => {
  try {
    const { spinId } = req.params;

    const spin = await Spin.findByIdAndUpdate(
      spinId,
      req.body,
      { new: true }
    );

    if (!spin) {
      return res.status(404).json({
        success: false,
        message: "Spin not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Spin updated",
      data: spin
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/spin/:spinId
exports.deleteSpin = async (req, res) => {
  try {
    const { spinId } = req.params;

    const spin = await Spin.findByIdAndDelete(spinId);
    if (!spin) {
      return res.status(404).json({
        success: false,
        message: "Spin not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Spin deleted"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/wallet/:userId
exports.getWalletByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }

    res.status(200).json({
      success: true,
      data: wallet
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/wallet/:userId/history
exports.getWalletHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    const wallet = await Wallet.findOne(
      { userId },
      { history: 1, coins: 1 }
    );

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }

    res.status(200).json({
      success: true,
      coins: wallet.coins,
      history: wallet.history.reverse()
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.todaySpinSummary = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /* ================= USER ================= */
    const user = await Auth.findById(userId)
      .populate("wallet", "coins")
      .populate("followers", "fullName")
      .populate("following", "fullName");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    /* ================= TODAY SPINS ================= */
    const spins = await Spin.find({ userId, spinDate: today });

    const spinsUsed = spins.length;
    const spinsLeft = Math.max(0, 2 - spinsUsed);

    /* ================= FRIENDS (MUTUAL FOLLOW) ================= */
    const followerIds = user.followers.map(f => f._id.toString());
    const followingIds = user.following.map(f => f._id.toString());

    const friendIds = followerIds.filter(id => followingIds.includes(id));

    /* ================= FRIENDS RECENT SPINS ================= */
    const friendsRecentSpins = [];

    for (const fid of friendIds) {
      const friend = await Auth.findById(fid).select("fullName");

      const lastSpin = await Spin.findOne({ userId: fid })
        .sort({ createdAt: -1 });

      if (lastSpin) {
        const minsAgo = Math.floor(
          (Date.now() - lastSpin.createdAt.getTime()) / 60000
        );

        friendsRecentSpins.push({
          friendId: fid,
          name: friend.fullName,
          reward: lastSpin.reward,
          coins: lastSpin.coins,
          timeAgo:
            minsAgo === 0 ? "Just now" : `${minsAgo} mins ago`,
          createdAt: lastSpin.createdAt
        });
      }
    }

    // sort latest first
    friendsRecentSpins.sort(
      (a, b) => b.createdAt - a.createdAt
    );

    /* ================= RESPONSE ================= */
    res.status(200).json({
      success: true,
      data: {
        yourCoins: user.wallet?.coins || 0,
        todayRewards: spins.map(s => s.reward),
        spinsUsed,
        spinsLeft,
        nextSpin: spinsLeft === 0 ? "Tomorrow" : `${spinsLeft} spins available`,
        mostCommonReward: getMostCommon(spins.map(s => s.reward)),
        friendsRecentSpins   // ✅ UI DATA
      }
    });

  } catch (error) {
    console.error("Spin Summary Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMostCommon = (arr) => {
  if (!arr.length) return null;
  const map = {};
  arr.forEach(v => map[v] = (map[v] || 0) + 1);
  return Object.keys(map).reduce((a, b) =>
    map[a] > map[b] ? a : b
  );
};