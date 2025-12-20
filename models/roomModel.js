const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      unique: true,
      required: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Auth",
      required: true
    },

    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Auth"
      }
    ],

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Room", roomSchema);
