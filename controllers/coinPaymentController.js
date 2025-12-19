// controllers/coinPaymentController.js
const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const CoinPackage = require("../models/coinPackageModel");
const CoinPayment = require("../models/coinPaymentModel");
const Wallet = require("../models/walletModel");

/* ================= CREATE RAZORPAY ORDER ================= */
exports.createCoinOrder = async (req, res) => {
  try {
    const { userId, packageId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) ||
        !mongoose.Types.ObjectId.isValid(packageId)) {
      return res.status(400).json({ success: false, message: "Invalid IDs" });
    }

    const pack = await CoinPackage.findById(packageId);
    if (!pack || !pack.isActive) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const order = await razorpay.orders.create({
      amount: pack.price * 100,
      currency: "INR",
      receipt: `coin_${Date.now()}`
    });

    await CoinPayment.create({
      userId,
      packageId,
      razorpayOrderId: order.id,
      amount: pack.price,
      coins: pack.coins
    });

    res.status(200).json({
      success: true,
      message: "Order created",
      data: {
        razorpayOrderId: order.id,
        amount: pack.price,
        coins: pack.coins,
        razorpayKey: "rzp_test_BxtRNvflG06PTV"
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= VERIFY PAYMENT ================= */
exports.verifyCoinPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const payment = await CoinPayment.findOne({ razorpayOrderId, isDeleted: false });
    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      payment.status = "failed";
      await payment.save();
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

    payment.status = "success";
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    await payment.save();

    const wallet = await Wallet.findOne({ userId: payment.userId });
    wallet.coins += payment.coins;
    wallet.history.push({
      type: "purchase",
      coins: payment.coins,
      message: `Purchased ${payment.coins} coins`
    });
    await wallet.save();

    res.status(200).json({
      success: true,
      message: "Coins added to wallet 🎉",
      data: {
        addedCoins: payment.coins,
        totalCoins: wallet.coins
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= GET ALL PAYMENTS (ADMIN) ================= */
exports.getAllCoinPayments = async (req, res) => {
  try {
    const payments = await CoinPayment.find({ isDeleted: false })
      .populate("userId", "fullName email")
      .populate("packageId", "coins price")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      total: payments.length,
      data: payments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= GET PAYMENT BY ID ================= */
exports.getCoinPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ success: false, message: "Invalid paymentId" });
    }

    const payment = await CoinPayment.findById(paymentId)
      .populate("userId", "fullName email")
      .populate("packageId", "coins price");

    if (!payment || payment.isDeleted) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= GET PAYMENTS BY USER ================= */
exports.getUserCoinPayments = async (req, res) => {
  try {
    const { userId } = req.params;

    const payments = await CoinPayment.find({
      userId,
      isDeleted: false
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      total: payments.length,
      data: payments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= DELETE PAYMENT (SOFT) ================= */
exports.deleteCoinPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await CoinPayment.findByIdAndUpdate(
      paymentId,
      { isDeleted: true },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    res.status(200).json({
      success: true,
      message: "Payment deleted ❌"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
