const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const upload = require('../utils/multer'); // You'll need to set up multer for file uploads

// Chat routes
router.post('/chat', messageController.getOrCreateChat);
router.get('/chats/:userId', messageController.getUserChats);
router.post('/chat/block', messageController.blockChat);
router.post('/chat/unblock', messageController.unblockChat);

// Message routes
router.post('/message', upload.array('file'), messageController.sendMessage);
router.get('/messages/:chatId', messageController.getMessages);
router.put('/messages/read', messageController.markAsRead);
router.delete('/message', messageController.deleteMessage);
router.get('/messages/unread/:userId', messageController.getUnreadCount);
router.get("/last-message", messageController.getLastMessage);
router.delete("/messages/:messageId/:userId", messageController.deleteMessage);


module.exports = router;