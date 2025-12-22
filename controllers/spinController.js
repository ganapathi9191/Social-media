// controllers/spinController.js
const Spin = require("../models/spinModel");
const Wallet = require("../models/walletModel");
const { Auth } = require("../models/authModel");
const mongoose = require("mongoose");
const SpinWheel = require("../models/spinRewardModel");
const SpinConfig = require("../models/spinConfigModel");

/* ================= CREATE / UPDATE SLOT ================= */
exports.upsertSpinSlot = async (req, res) => {
  try {
    const { position, label, coins, spinAgain, isActive } = req.body;

    if (position < 1 || position > 8) {
      return res.status(400).json({
        success: false,
        message: "Position must be between 1 and 8"
      });
    }

    const slot = await SpinWheel.findOneAndUpdate(
      { position },
      { label, coins, spinAgain, isActive },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: "Spin slot saved",
      data: slot
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= GET FULL WHEEL ================= */
exports.getSpinWheel = async (req, res) => {
  try {
    const wheel = await SpinWheel.find({ isActive: true }).sort({ position: 1 });

    if (wheel.length !== 8) {
      return res.status(400).json({
        success: false,
        message: "Spin wheel must have exactly 8 active slots"
      });
    }

    res.status(200).json({
      success: true,
      data: wheel
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= SET DAILY SPIN LIMIT ================= */
exports.setSpinLimit = async (req, res) => {
  try {
    const { maxDailySpins } = req.body;

    const config = await SpinConfig.findOneAndUpdate(
      {},
      { maxDailySpins },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.spinWheel = async (req, res) => {
  try {
    const { userId, spinSlotId } = req.body;

    /* ================= VALIDATION ================= */
    if (!userId || !spinSlotId) {
      return res.status(400).json({
        success: false,
        message: "userId and spinSlotId are required"
      });
    }

    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(spinSlotId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId or spinSlotId"
      });
    }

    /* ================= USER ================= */
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

    /* ================= DAILY SPIN LIMIT ================= */
    const config = await SpinConfig.findOne();
    const MAX_DAILY_SPINS = config?.maxDailySpins || 20;

    const spinsToday = await Spin.countDocuments({
      userId,
      spinDate: today
    });

    if (spinsToday >= MAX_DAILY_SPINS) {
      return res.status(202).json({
        success: true,
        message: "Today's spins are over. Come back tomorrow ⏰"
      });
    }

    /* ================= GET SLOT BY ID ================= */
    const rewardSlot = await SpinWheel.findOne({
      _id: spinSlotId,
      isActive: true
    });

    if (!rewardSlot) {
      return res.status(400).json({
        success: false,
        message: "Invalid or inactive spin slot"
      });
    }

    const coinsWon = rewardSlot.coins || 0;

    /* ================= SAVE SPIN ================= */
    await Spin.create({
      userId,
      reward: rewardSlot.label,
      coins: coinsWon,
      spinDate: today
    });

    /* ================= WALLET ================= */
    let wallet = await Wallet.findOne({ userId });

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

      user.wallet = wallet._id;
      await user.save();
    }

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
        rewardSlot.spinAgain
          ? "🔄 Spin again"
          : coinsWon === 0
          ? "😔 Better luck next time"
          : `🎉 Congratulations! You got ${coinsWon} coins`,
      data: {
        spinSlotId: rewardSlot._id,
        reward: rewardSlot.label,
        coinsWon,
        spinsUsed: spinsToday + 1,
        spinsLeft: MAX_DAILY_SPINS - (spinsToday + 1),
        walletCoins: wallet.coins
      }
    });

  } catch (error) {
    console.error("❌ Spin Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};




// GET /api/spin
exports.getAllSpins = async (req, res) => {
  try {
    const spins = await Spin.find()
      .populate("userId", "fullName email phone")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      total: spins.length,
      data: spins
    });

  } catch (error) {
    console.error("Get All Spins Error:", error);
    res.status(500).json({
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


exports.transferCoinsToFriend = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { senderId, friendId, coins } = req.body;

    // ---------------- VALIDATIONS ----------------
    if (!senderId || !friendId || !coins) {
      return res.status(400).json({
        success: false,
        message: "senderId, friendId and coins are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(senderId) || !mongoose.Types.ObjectId.isValid(friendId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid senderId or friendId"
      });
    }

    if (senderId === friendId) {
      return res.status(400).json({
        success: false,
        message: "Cannot send coins to yourself"
      });
    }

    if (coins <= 0) {
      return res.status(400).json({
        success: false,
        message: "Coins must be greater than 0"
      });
    }

    // ---------------- CHECK FRIENDSHIP ----------------
    const sender = await Auth.findById(senderId).session(session);
    if (!sender) {
      return res.status(404).json({ success: false, message: "Sender not found" });
    }

    const isFriend =
      sender.following?.includes(friendId) ||
      sender.followers?.includes(friendId) ||
      sender.approvedFollowers?.includes(friendId);

    if (!isFriend) {
      return res.status(403).json({
        success: false,
        message: "Coins can be sent only to friends"
      });
    }

    // ---------------- FETCH WALLETS ----------------
    const senderWallet = await Wallet.findOne({ userId: senderId }).session(session);
    const friendWallet = await Wallet.findOne({ userId: friendId }).session(session);

    if (!senderWallet || !friendWallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }

    if (senderWallet.coins < coins) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance"
      });
    }

    // ---------------- TRANSFER COINS ----------------
    senderWallet.coins -= coins;
    friendWallet.coins += coins;

    // Sender history
    senderWallet.history.push({
      type: "transfer_sent",
      coins: -coins,
      message: `Sent ${coins} coins to friend`,
      createdAt: new Date()
    });

    // Receiver history
    friendWallet.history.push({
      type: "transfer_received",
      coins: coins,
      message: `Received ${coins} coins from friend`,
      createdAt: new Date()
    });

    await senderWallet.save({ session });
    await friendWallet.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Coins transferred successfully ✅",
      data: {
        senderBalance: senderWallet.coins,
        receiverBalance: friendWallet.coins
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("❌ Coin transfer error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};