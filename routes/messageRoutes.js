const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const upload = require('../utils/multer');  // Multer for image/file upload

/* ============================================================
   CHAT ROUTES
============================================================ */
router.post('/chat', messageController.getOrCreateChat);
router.get('/chats/:userId', messageController.getUserChats);

router.post('/chat/block', messageController.blockChat);
router.post('/chat/unblock', messageController.unblockChat);

/* ============================================================
   MESSAGE ROUTES
============================================================ */

// Send message (text/image/file)
router.post('/message', upload.array('file'), messageController.sendMessage);

// Get messages in a chat
router.get('/messages/:chatId', messageController.getMessages);

// Mark messages as read
router.put('/messages/read', messageController.markAsRead);

// Soft delete (delete only for user)
router.delete('/message', messageController.deleteMessage);

// Unread message count
router.get('/messages/unread/:userId', messageController.getUnreadCount);

// Get last message between users or by chatId
router.get('/last-message', messageController.getLastMessage);

// Permanent delete for both sides
router.delete('/messages/:messageId/:userId', messageController.deletechatmessage);

module.exports = router;
