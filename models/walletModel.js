// models/walletModel.js
const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true,
    unique: true
  },
  coins: {
    type: Number,
    default: 10
  },
  history: [{
    type: {
      type: String, // spin, bonus, admin
    },
    coins: Number,
    message: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

module.exports = mongoose.model("Wallet", walletSchema);
