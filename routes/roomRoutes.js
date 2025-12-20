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

module.exports = router;
