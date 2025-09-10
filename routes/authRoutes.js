const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const upload = require('../utils/upload');
const campaign =require("../controllers/campaignController");

// ------------------ AUTHENTICATION ROUTES ------------------
router.post('/register', authController.register);
router.post('/verify-otp', authController.verifyOtp);
router.post('/login', authController.login);
router.post('/verify-login-otp', authController.verifyLoginOtp);

// ------------------ PROFILE ROUTES ------------------
router.post('/profile', upload.single('image'), authController.createOrUpdateProfile);
router.get('/profiles', authController.getProfiles);
router.get('/profile/:userId', authController.getProfileById);
router.delete('/profile/:userId', authController.deleteProfile);

// ------------------ PERSONAL INFO ROUTES ------------------
router.post('/personal-info', authController.updatePersonalInfo);
router.get('/personal-info/:userId', authController.getPersonalInfo);

// ------------------ ACCOUNT MANAGEMENT ROUTES ------------------
router.post('/deactivate', authController.deactivateAccount);
router.post('/reactivate', authController.reactivateAccount);
router.post('/delete', authController.deleteAccount);

// ------------------ PRIVACY ROUTES ------------------
router.post('/privacy', authController.updateProfilePrivacy);
router.get('/profile/:userId/viewer/:viewerId', authController.fetchUserProfile);

// ------------------ FOLLOW/FOLLOWER ROUTES ------------------
router.post('/follow', authController.followUser);
router.post('/approve-follower', authController.approveFollower);
router.post('/reject-follower', authController.rejectFollower);
router.post('/block-follower', authController.blockFollower);
router.get('/followers/:userId', authController.getFollowers);
router.get('/following/:userId', authController.getFollowing);
router.put('/followers', authController.updateFollowers);
router.delete('/follower', authController.deleteFollower);
router.delete('/following', authController.deleteFollowing);

// ------------------ POST ROUTES ------------------
router.post('/post', upload.array('media'), authController.createPost);
router.get('/posts', authController.getAllPosts);
router.get('/posts/:userId', authController.getUserPosts);
router.post('/like', authController.toggleLikePost);
router.post('/comment', authController.addComment);

router.delete('/post', authController.deletePost);

// Follow routes
router.post('/toggle-follow', authController.toggleFollow); 

// Save Post Routes
router.post('/save-post', authController.toggleSavePost);
router.get('/saved-posts/:userId', authController.getSavedPosts);

// Notification Preference Routes
router.post('/notification-preferences', authController.updateNotificationPreferences);
router.get('/notification-preferences/:userId', authController.getNotificationPreferences);





// Get all notifications for a user
router.get('/notification/user/:userId', authController.getUserNotifications);

// Get unread notification count
router.get('/notification/unread-count/:userId', authController.getUnreadCount);

// Mark notification as read
router.post('/notification/mark-read', authController.markAsRead);

// Mark all notifications as read
router.post('/notification/mark-all-read', authController.markAllAsRead);

// Delete notification
router.delete('/notification/delete', authController.deleteNotification);



// Create Campaign (with multiple images)
router.post("/campaign",upload.array("images"),campaign.createCampaign);

// Get all campaigns
router.get("/campaigns", campaign.getCampaigns);

// Get campaign by ID
router.get("/campaign/:id", campaign.getCampaignById);

// Update campaign by ID (with new images if uploaded)
router.put("/campaign/:id",upload.array("images"),campaign.updateCampaign);

// Delete campaign by ID
router.delete("/campaign/:id", campaign.deleteCampaign);



module.exports = router;
