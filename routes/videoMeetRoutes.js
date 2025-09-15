const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // memory storage
const controller = require("../controllers/videoMeetController");

// Meeting CRUD
router.post("/video-meet/create", controller.createVideoMeet);
router.get("/video-meet/:meetLink", controller.getMeetByLink);
router.put("/video-meet/:meetLink", controller.updateMeet);
router.post("/video-meet/:meetLink/end", controller.endMeeting);

// Participants
router.post("/video-meet/:meetLink/participant", controller.addParticipant);
router.delete("/video-meet/:meetLink/participant", controller.removeParticipant);
router.post("/video-meet/:meetLink/participant/pin", controller.pinParticipant);

// Chat
router.post("/video-meet/:meetLink/chat", upload.array("media"), controller.addChatMessage);
router.delete("/video-meet/:meetLink/chat/:chatId", controller.deleteChatMessage);

module.exports = router;
