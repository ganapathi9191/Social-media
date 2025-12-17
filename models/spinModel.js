// models/spinModel.js
const mongoose = require("mongoose");

const spinSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true
  },
  reward: {
    type: String, // "1 coin", "better_luck", "spin_again"
  },
  coins: {
    type: Number,
    default: 0
  },
  spinDate: {
    type: Date,
    default: () => new Date().setHours(0,0,0,0)
  }
}, { timestamps: true });

spinSchema.index({ userId: 1, spinDate: 1 });

module.exports = mongoose.model("Spin", spinSchema);
