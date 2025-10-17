const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const upload = require('../utils/upload');
const campaign =require("../controllers/campaignController");
const notification =require("../controllers/notificationControllers");
const followController =require("../controllers/followController");
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


// GET user statistics
router.get("/user/:userId/statistics", authController.getUserStatistics);


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
router.get("/personal-infos", authController.getAllPersonalInfo);
router.get("/personal-info/:userId", authController.getPersonalInfoById);
router.delete("/personal-info/:userId", authController.deletePersonalInfoById);







// ------------------ ACCOUNT MANAGEMENT ROUTES ------------------

// Deactivate account temporarily
router.post('/account/deactivate', authController.deactivateAccount);

// Reactivate account
router.post('/account/reactivate', authController.reactivateAccount);

// Delete account permanently
router.post('/account/delete-account', authController.deleteAccount);

// ------------------ PRIVACY ROUTES ------------------

// Update profile privacy
router.post('/privacy', authController.updateProfilePrivacy);

// Fetch user profile considering visibility
router.get('/profile-visibility/:userId/:viewerId', authController.fetchUserProfile);








// ------------------ FOLLOW/FOLLOWER ROUTES ------------------

// Send follow request
router.post("/send-request", followController.sendFollowRequest);
// Approve follow request
router.post("/approve-request", followController.approveFollowRequest);

// Reject follow request
router.post("/reject-request", followController.rejectFollowRequest);
router.get("/followers/:userId", followController.getFollowers);
router.get("/following/:userId", followController.getFollowing);
router.get("/all-followers", followController.getAllFollowers);
router.get("/all-following", followController.getAllFollowing);


//request
router.get("/requests/all", followController.getAllRequests);
router.get("/requests/:userId", followController.getRequests);
router.get("/requests/:userId/:requesterId", followController.getRequestById);


//block
router.post("/block-user", followController.Blocked);
router.get("/blocked/:userId", followController.getBlockedByUserId);
router.get("/blocked", followController.getAllBlocked);
router.post("/unblock", followController.unblockFollower); 
router.delete("/unblock/:userId/:followerId", followController.unblockFollowerByParams);
 


router.delete("/user/:userId/follower/:followerId", followController.removeFollower);
router.delete("/user/:userId/following/:followingId", followController.removeFollowing);
router.get("/status/:userId/:otherUserId", followController.getFollowStatus);







// ------------------ POST ROUTES ------------------

// Create a new post with mentions
router.post('/posts', upload.array('media'), postController.createPost);

// Get all posts from all users
router.get('/posts', postController.getAllPosts);

// Get all posts for a specific user
router.get('/posts/user/:userId', postController.getUserPosts);

// Get post by ID
router.get('/posts/:userId/:postId', postController.getPostById);

// Update post by ID
router.put('/posts/:userId/:postId', upload.array('media', 10), postController.updatePostById);
router.delete('/deletePost/:userId/:postId', postController.deletePost);

// Like/Unlike a post
router.post('/posts/like', postController.toggleLikePost);
router.get("/post/:postOwnerId/:postId/likes", postController.getAllLikes);
router.get("/post/:postOwnerId/:postId/like/:userId", postController.getLikeById);

// Add comment to a post
router.post('/posts/comment', postController.addComment);
router.get("/:postId/comments", postController.getCommentsByPostId);
router.get('/posts/:postId/comments/:commentId', postController.getCommentById); // Get comment by ID
router.delete('/posts/:postId/comments/:commentId/:userId', postController.deleteCommentById);



// ------------------ SAVE POST ROUTES ------------------

// Save/Unsave Post
router.post('/posts/save', postController.toggleSavePost);

// Get Saved Posts
router.get('/saved-posts/:userId', postController.getSavedPosts);
router.get("/saved-posts/:userId/:postId", postController.getSavedPostById);
// Delete a saved post
router.delete("/saved-posts/:userId/:postId", postController.deleteSavedPost);



// ------------------ NOTIFICATION ROUTES ------------------


router.get("/mentions/:userId", notification.getMentionedComments);
// Get all notifications for a user
router.get('/notifications/:userId', notification.getUserNotifications);

// Mark notification as read
router.put('/notifications/read/:notificationId', notification.markAsRead);

// Mark all notifications as read
router.put('/notifications/read-all/:userId', notification.markAllAsRead);

// Delete notification
router.delete('/notifications/:notificationId', notification.deleteNotification);




// 🔹 Preferences
router.put("/preferences", notification.updateNotificationPreferences);
router.get("/preferences/:userId", notification.getNotificationPreferences);


// Get unread notification count
router.get('/notifications/unread-count/:userId', notification.getUnreadCount);

// Get all live notifications combined
router.get('/notifications/all-live/:userId', notification.getAllLiveNotifications);
// Get ONLY new/unread notifications for popup
router.get('/popup-notifications/live/:userId', notification.getLivepopupNotifications);




//live notifications
router.get("/notifications/get-live/:userId", notification.getAllLiveNotifications );

// ------------------ MENTION ROUTES ------------------

// Get posts where user mentioned others
router.get('/mentions/posts-by-user/:userId', followController.getPostsWithUserMentions);

// Get posts where user is mentioned
router.get('/mentions/posts/:userId', followController.getPostMentions);

// Get comments where user is mentioned
router.get('/mentions/comments/:userId', followController.getCommentMentions);

// Get all mentions for a user (both posts and comments)
router.get('/mentions/all/:userId', followController.getAllMentions);

// Remove mention from post
router.delete('/mentions/post', followController.removePostMention);

// Remove mention from comment
router.delete('/mentions/comment', followController.removeCommentMention);

// ------------------ UTILITY ROUTES ------------------

// Check username availability
router.get('/check-username/:username', authController.checkUsernameAvailability);

// Get user dashboard data
router.get('/dashboard/:userId', authController.getUserDashboard);


// Create Campaign (with multiple images)
router.post("/campaign",upload.array("media"),campaign.createCampaign);

// Get all campaigns
router.get("/campaigns", campaign.getCampaigns);

// Get campaign by ID
router.get("/campaign/:id", campaign.getCampaignById);

// Update campaign by ID (with new images if uploaded)
router.put("/campaign/:id",upload.array("media"),campaign.updateCampaign);

// Delete campaign by ID
router.delete("/campaign/:id", campaign.deleteCampaign);


router.post("/submit", campaign.submitForm);
router.get("/all-forms", campaign.getAllFormFills);           // Get all forms
router.get("/form/:id", campaign.getFormFillById);       // Get form by ID
router.put("/form/:id", campaign.updateFormFillById);    // Update form by ID
router.delete("/form/:id", campaign.deleteFormFillById); // Delete form by ID


module.exports = router;
