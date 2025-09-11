const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const upload = require('../utils/upload');
const campaign =require("../controllers/campaignController");
const notification =require("../controllers/notificationControllers");
const folloController =require("../controllers/followController");
const postController =require('../controllers/postController');


// Register user
router.post('/register', authController.register);

// Verify OTP & Save user
router.post('/verify-otp', authController.verifyOtp);

// Login user
router.post('/login', authController.login);

// Verify login OTP
router.post('/verify-login-otp', authController.verifyLoginOtp);

// ------------------ USER MANAGEMENT ROUTES ------------------

// Get all users
router.get('/users', authController.getAllUsers);

// Get user by ID
router.get('/users/:userId', authController.getUserById);

// Update user by ID
router.put('/users/:userId', authController.updateUserById);

// Delete user by ID (admin only)
router.delete('/users/:userId', authController.deleteUserById);

// Search users by username or name
router.get('/users/search', authController.searchUsers);

// ------------------ PROFILE ROUTES ------------------

// Create or update profile
router.post('/profile', upload.single('image'), authController.createOrUpdateProfile);

// Get all profiles
router.get('/profiles', authController.getProfiles);

// Get single profile
router.get('/profiles/:userId', authController.getProfileById);

// Delete profile
router.delete('/profiles/:userId', authController.deleteProfile);

// ------------------ PERSONAL INFO ROUTES ------------------

// Add or update personal info
router.post('/personal-info', authController.updatePersonalInfo);

// Get personal info
router.get('/personal-info/:userId', authController.getPersonalInfo);

// ------------------ ACCOUNT MANAGEMENT ROUTES ------------------

// Deactivate account temporarily
router.post('/deactivate', authController.deactivateAccount);

// Reactivate account
router.post('/reactivate', authController.reactivateAccount);

// Delete account permanently
router.post('/delete-account', authController.deleteAccount);

// ------------------ PRIVACY ROUTES ------------------

// Update profile privacy
router.post('/privacy', authController.updateProfilePrivacy);

// Fetch user profile considering visibility
router.get('/profile-visibility/:userId/:viewerId', authController.fetchUserProfile);

// ------------------ FOLLOW/FOLLOWER ROUTES ------------------

// Follow user
router.post('/follow', folloController.followUser);

// Approve follower
router.post('/approve-follower', folloController.approveFollower);

// Reject follower
router.post('/reject-follower', folloController.rejectFollower);

// Block follower
router.post('/block-follower', folloController.blockFollower);

// Get followers
router.get('/followers/:userId', folloController.getFollowers);

// Get following
router.get('/following/:userId', folloController.getFollowing);

// Update followers (approve/reject multiple)
router.put('/followers', folloController.updateFollowers);

// Delete follower
router.delete('/follower', folloController.deleteFollower);

// Delete following
router.delete('/following', folloController.deleteFollowing);

// Toggle follow/unfollow
router.post('/toggle-follow', folloController.toggleFollow);

// ------------------ POST ROUTES ------------------

// Create a new post with mentions
router.post('/posts', upload.array('media', 10), postController.createPost);

// Get all posts from all users
router.get('/posts', postController.getAllPosts);

// Get all posts for a specific user
router.get('/posts/user/:userId', postController.getUserPosts);

// Get post by ID
router.get('/posts/:userId/:postId', postController.getPostById);

// Update post by ID
router.put('/posts/:userId/:postId', upload.array('media', 10), postController.updatePostById);

// Like/Unlike a post
router.post('/posts/like', postController.toggleLikePost);

// Add comment to a post
router.post('/posts/comment', postController.addComment);

// Delete a post
router.delete('/posts', postController.deletePost);

// ------------------ SAVE POST ROUTES ------------------

// Save/Unsave Post
router.post('/posts/save', postController.toggleSavePost);

// Get Saved Posts
router.get('/saved-posts/:userId', postController.getSavedPosts);





// ------------------ NOTIFICATION ROUTES ------------------

// Get all notifications for a user
router.get('/notifications/:userId', notification.getUserNotifications);

// Mark notification as read
router.put('/notifications/read', notification.markAsRead);

// Mark all notifications as read
router.put('/notifications/read-all', notification.markAllAsRead);

// Delete notification
router.delete('/notifications', notification.deleteNotification);

// 🔹 Preferences
router.put("/preferences", notification.updateNotificationPreferences);
router.get("/preferences/:userId", notification.getNotificationPreferences);


// Get unread notification count
router.get('/notifications/unread-count/:userId', notification.getUnreadCount);

// ------------------ MENTION ROUTES ------------------

// Get posts where user mentioned others
router.get('/mentions/posts-by-user/:userId', folloController.getPostsWithUserMentions);

// Get posts where user is mentioned
router.get('/mentions/posts/:userId', folloController.getPostMentions);

// Get comments where user is mentioned
router.get('/mentions/comments/:userId', folloController.getCommentMentions);

// Get all mentions for a user (both posts and comments)
router.get('/mentions/all/:userId', folloController.getAllMentions);

// Remove mention from post
router.delete('/mentions/post', folloController.removePostMention);

// Remove mention from comment
router.delete('/mentions/comment', folloController.removeCommentMention);

// ------------------ ADMIN ROUTES ------------------

// Get all users (admin only) with pagination and search
router.get('/admin/users', authController.adminGetAllUsers);

// Get user statistics (admin only)
router.get('/admin/statistics', authController.getUserStatistics);

// Update user status (admin only)
router.put('/admin/users/:userId/status', authController.adminUpdateUserStatus);

// ------------------ UTILITY ROUTES ------------------

// Check username availability
router.get('/check-username/:username', authController.checkUsernameAvailability);

// Get user dashboard data
router.get('/dashboard/:userId', authController.getUserDashboard);


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
