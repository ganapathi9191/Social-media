const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // In-memory storage

const videoMeetController = require("../controllers/videoMeetController");

// CRUD routes
router.post("/video-meet/create", videoMeetController.createVideoMeet);
router.get("/video-meets/all", videoMeetController.getAllVideoMeets);
router.get("/video-meet/:meetid", videoMeetController.getVideoMeetById);
router.put("/video-meet/:meetid", videoMeetController.updateVideoMeetById);
router.delete("/video-meet/:meetid", videoMeetController.deleteVideoMeetById);

// Chat & media routes
router.post("/upload/:meetId", upload.single("file"), videoMeetController.uploadMedia);
router.post("/chat/:meetId", videoMeetController.addChatMessage);
router.post("/:meetId/chat", videoMeetController.addChatMessage);          
router.get("/:meetId/chat", videoMeetController.getAllMessagesByMeetId);   
router.put("/:meetId/chat/:messageId", videoMeetController.updateChatMessage); 
router.delete("/:meetId/chat/:messageId", videoMeetController.deleteChatMessage); 




// Screen share toggle
router.patch("/screenshare/:meetId", videoMeetController.toggleScreenShare);

// Invite participants
router.post("/invite/:meetId", videoMeetController.inviteParticipants);

// Watch together
router.post("/watch/:meetId", upload.single("file"), videoMeetController.addSharedMedia);
router.patch("/watch/:meetId/:mediaId", videoMeetController.updatePlaybackPosition);



module.exports = router;
