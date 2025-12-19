const Wallet = require("../models/walletModel");

const DAILY_POST_LIMIT = 5;

exports.rewardPostCoin = async (userId) => {
  const wallet = await Wallet.findOne({ userId });
  if (!wallet) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0); // midnight

  // 🔄 Reset if new day
  if (
    !wallet.dailyPostReward.lastRewardDate ||
    new Date(wallet.dailyPostReward.lastRewardDate).setHours(0,0,0,0) !== today.getTime()
  ) {
    wallet.dailyPostReward.count = 0;
    wallet.dailyPostReward.lastRewardDate = today;
  }

  // 🚫 Daily limit reached
  if (wallet.dailyPostReward.count >= DAILY_POST_LIMIT) {
    return;
  }

  // 🎁 Reward coin
  wallet.coins += 1;
  wallet.dailyPostReward.count += 1;

  wallet.history.push({
    type: "post_reward",
    coins: 1,
    message: "Coin earned for creating a post 🪙",
    createdAt: new Date()
  });

  await wallet.save();
};
