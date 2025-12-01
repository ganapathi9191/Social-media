const express = require("express");
const router = express.Router();
const upload = require("../utils/upload"); // your multer file
const messageController = require("../controllers/messageController");

// CHAT
router.post("/chat/permission", messageController.chat);
router.post("/chat/get-or-create", messageController.getOrCreateChat);

// SEND MESSAGE (TEXT/IMAGE/VIDEO)
router.post(
  "/messages/send",
  upload.array("media", 20),
  messageController.sendMessage
);

// GET MESSAGES
router.get("/messages/:chatId", messageController.getMessages);

// SEARCH
router.get("/messages/search/:chatId", messageController.searchMessages);

// LAST MESSAGE
router.get("/messages/last/:chatId", messageController.getLastMessage);

// READ / DELIVERY
router.post("/messages/mark-read", messageController.markAsRead);
router.post("/messages/delivery-confirm", messageController.confirmDelivery);

// DELETE
router.post("/messages/delete", messageController.deleteMessage);
router.delete(
  "/messages/delete/:messageId/:userId",
  messageController.deletechatmessage
);

// BLOCK / UNBLOCK
router.post("/chat/block", messageController.blockChat);
router.post("/chat/unblock", messageController.unblockChat);

// UNREAD COUNTS
router.get("/messages/unread/count/:userId", messageController.getUnreadCount);
router.get(
  "/messages/unread/count/:userId/:chatId",
  messageController.getUnreadCountPerChat
);

// USER STATUS
router.get("/user/status/:userId", messageController.getUserStatus);
router.get("/users/online", messageController.getAllOnlineUsers);
router.get("/user/last-seen/:userId", messageController.getLastSeen);

// TYPING
router.post("/messages/typing", messageController.setTyping);

module.exports = router;