const express = require("express");
const router = express.Router();
const roomController = require("../controllers/roomController");

// Create room by userId
router.post("/room-create", roomController.createRoomByUserId);

// Join room
router.post("/room-join", roomController.joinRoom);

// Get room details
router.get("/room/:roomId", roomController.getRoomDetails);

router.post("/invite", roomController.inviteToGroup);
router.post("/accept", roomController.acceptGroupInvite);
router.post("/reject", roomController.rejectGroupInvite);

// GET routes
router.get("/invites/user/:userId", roomController.getUserInvites);
router.get("/invites/user/:userId/pending", roomController.getPendingInvites);
router.get("/invites/sent/:userId", roomController.getSentInvites);
router.get("/invites/:inviteId", roomController.getInviteById);
router.get("/invites/room/:roomId", roomController.getRoomInvites);
router.get("/invites/user/:userId/count", roomController.getPendingInviteCount);

module.exports = router;
