const mongoose = require("mongoose");

const groupInviteSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Auth",
      required: true
    },

    invitedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Auth",
      required: true
    },

    text: {
      type: String,
      default: ""
    },

    inviteLink: {
      type: String,
      required: true
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("GroupInvite", groupInviteSchema);
