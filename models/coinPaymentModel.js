const mongoose = require("mongoose");

const coinPaymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true
  },
  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CoinPackage",
    required: true
  },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  amount: Number,
  coins: Number,
  status: {
    type: String,
    enum: ["created", "success", "failed"],
    default: "created"
  }
}, { timestamps: true });

module.exports = mongoose.model("CoinPayment", coinPaymentSchema);
