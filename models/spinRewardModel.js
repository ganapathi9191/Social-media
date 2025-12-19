const mongoose = require("mongoose");

const spinWheelSchema = new mongoose.Schema(
  {
    position: {
      type: Number,
      required: true,
      min: 1,
      max: 8,
      unique: true // 🔒 exactly one per slot
    },
    label: {
      type: String,
      required: true
    },
    coins: {
      type: Number,
      default: 0
    },
    spinAgain: {
      type: Boolean,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SpinWheel", spinWheelSchema);
