const mongoose = require("mongoose");
const Room = require("../models/roomModel");
const GroupInvite = require("../models/groupInviteModel"); // ✅ MISSING IMPORT FIX
const Auth = require("../models/authModel").Auth;

/* ================= ROOM ID GENERATOR ================= */
const generateRoomId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let roomId = "";
  for (let i = 0; i < 6; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return roomId; // Example: A9K2PZ
};

/* ================= CREATE ROOM ================= */
exports.createRoomByUserId = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    const user = await Auth.findById(userId)
      .select("fullName profile.username profile.image");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    /* ---------- UNIQUE ROOM ID ---------- */
    let roomId;
    let exists = true;
    while (exists) {
      roomId = generateRoomId();
      exists = await Room.findOne({ roomId });
    }

    /* ---------- CREATE ROOM ---------- */
    const room = await Room.create({
      roomId,
      createdBy: userId,
      members: [userId]
    });

    return res.status(201).json({
      success: true,
      message: "Room created and user joined successfully ✅",
      data: {
        roomId: room.roomId,
        user: {
          userId: user._id,
          fullName: user.fullName,
          username: user.profile?.username || null,
          profileImage: user.profile?.image || null
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ================= JOIN ROOM ================= */
exports.joinRoom = async (req, res) => {
  try {
    const { roomId, userId } = req.body;

    if (!roomId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "roomId and valid userId required"
      });
    }

    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found"
      });
    }

    if (room.members.includes(userId)) {
      return res.status(200).json({
        success: true,
        message: "User already joined this room"
      });
    }

    room.members.push(userId);
    await room.save();

    return res.status(200).json({
      success: true,
      message: "Joined room successfully ✅",
      data: {
        roomId: room.roomId,
        userId
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ================= GET ROOM DETAILS ================= */
exports.getRoomDetails = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ roomId })
      .populate("members", "fullName profile.username profile.image");

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Room details fetched successfully",
      data: {
        roomId: room.roomId,
        members: room.members.map(m => ({
          userId: m._id,
          fullName: m.fullName,
          username: m.profile?.username || null,
          profileImage: m.profile?.image || null
        }))
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ================= INVITE FRIEND TO GROUP ================= */
exports.inviteToGroup = async (req, res) => {
  try {
    const { userId, friendId, roomId, text, link } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(friendId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId or friendId"
      });
    }

    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found"
      });
    }

    /* ---------- PREVENT DUPLICATE INVITE ---------- */
    const alreadyInvited = await GroupInvite.findOne({
      roomId,
      invitedUser: friendId,
      status: "pending"
    });

    if (alreadyInvited) {
      return res.status(400).json({
        success: false,
        message: "Invite already sent"
      });
    }

    const invite = await GroupInvite.create({
      roomId,
      invitedBy: userId,
      invitedUser: friendId,
      text,
      inviteLink: link
    });

    /* ---------- SOCKET EVENT ---------- */
    const io = global.io;
    if (io) {
      io.to(friendId.toString()).emit("groupInvite", {
        inviteId: invite._id,
        roomId,
        text,
        link,
        invitedBy: userId
      });
    }

    res.status(200).json({
      success: true,
      message: "Group invite sent successfully ✅",
      data: {
        inviteId: invite._id,
        roomId,
        invitedUser: friendId
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ================= ACCEPT INVITE ================= */
exports.acceptGroupInvite = async (req, res) => {
  try {
    const { inviteId, userId } = req.body;

    const invite = await GroupInvite.findById(inviteId);
    if (!invite || invite.status !== "pending") {
      return res.status(404).json({
        success: false,
        message: "Invite not found or already handled"
      });
    }

    if (invite.invitedUser.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const room = await Room.findOne({ roomId: invite.roomId });
    if (!room.members.includes(userId)) {
      room.members.push(userId);
      await room.save();
    }

    invite.status = "accepted";
    await invite.save();

    const io = global.io;
    if (io) {
      io.to(userId.toString()).emit("joinRoom", invite.roomId);
    }

    res.status(200).json({
      success: true,
      message: "Joined group successfully ✅",
      data: {
        roomId: invite.roomId
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ================= REJECT INVITE ================= */
exports.rejectGroupInvite = async (req, res) => {
  try {
    const { inviteId, userId } = req.body;

    const invite = await GroupInvite.findById(inviteId);
    if (!invite) {
      return res.status(404).json({
        success: false,
        message: "Invite not found"
      });
    }

    if (invite.invitedUser.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }

    invite.status = "rejected";
    await invite.save();

    res.status(200).json({
      success: true,
      message: "Invite rejected ❌"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/* ================= GET ALL INVITES FOR A USER ================= */
exports.getUserInvites = async (req, res) => {
  try {
    const { userId } = req.params;

    const invites = await GroupInvite.find({ invitedUser: userId })
      .populate("invitedBy", "fullName profile")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      total: invites.length,
      data: invites
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/* ================= GET PENDING INVITES FOR USER ================= */
exports.getPendingInvites = async (req, res) => {
  try {
    const { userId } = req.params;

    const invites = await GroupInvite.find({
      invitedUser: userId,
      status: "pending"
    }).populate("invitedBy", "fullName profile");

    res.status(200).json({
      success: true,
      total: invites.length,
      data: invites
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/* ================= GET SENT INVITES (BY USER) ================= */
exports.getSentInvites = async (req, res) => {
  try {
    const { userId } = req.params;

    const invites = await GroupInvite.find({ invitedBy: userId })
      .populate("invitedUser", "fullName profile")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      total: invites.length,
      data: invites
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/* ================= GET INVITE BY ID ================= */
exports.getInviteById = async (req, res) => {
  try {
    const { inviteId } = req.params;

    const invite = await GroupInvite.findById(inviteId)
      .populate("invitedBy", "fullName profile")
      .populate("invitedUser", "fullName profile");

    if (!invite) {
      return res.status(404).json({
        success: false,
        message: "Invite not found"
      });
    }

    res.status(200).json({
      success: true,
      data: invite
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/* ================= GET INVITES FOR A ROOM ================= */
exports.getRoomInvites = async (req, res) => {
  try {
    const { roomId } = req.params;

    const invites = await GroupInvite.find({ roomId })
      .populate("invitedUser", "fullName profile")
      .populate("invitedBy", "fullName profile");

    res.status(200).json({
      success: true,
      total: invites.length,
      data: invites
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/* ================= GET PENDING INVITE COUNT ================= */
exports.getPendingInviteCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const count = await GroupInvite.countDocuments({
      invitedUser: userId,
      status: "pending"
    });

    res.status(200).json({
      success: true,
      pendingInvites: count
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
