const mongoose = require("mongoose");

const spinConfigSchema = new mongoose.Schema(
  {
    maxDailySpins: {
      type: Number,
      default: 20
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SpinConfig", spinConfigSchema);
