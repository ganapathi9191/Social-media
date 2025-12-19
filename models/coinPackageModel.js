const mongoose = require("mongoose");

const coinPackageSchema = new mongoose.Schema({
  coins: {
    type: Number,
    required: true
  },
  price: {
    type: Number, // final payable price
    required: true
  },
  originalPrice: {
    type: Number, // optional (for offer display)
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model("CoinPackage", coinPackageSchema);
