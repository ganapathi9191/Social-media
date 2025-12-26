const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const upload = require('../utils/upload');
const campaign =require("../controllers/campaignController");
const notification =require("../controllers/notificationControllers");
const followController =require("../controllers/followController");
const postController =require('../controllers/postController');
const spinCtrl = require("../controllers/spinController");
const ctrl = require("../controllers/postDownloadController");



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



// ✅ Single combined route
router.get("/get-friends/:userId", authController.getAllFriendRelations);




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

// ------------------ NOTIFICATION ROUTES ------------------

// Fetch comments where user is mentioned
router.get("/mentions/:userId", notification.getMentionedComments);

// Get all notifications
router.get('/notifications/:userId', notification.getUserNotifications);

// Mark single notification as read
router.put('/notifications/read/:notificationId', notification.markAsRead);

// Mark all notifications as read
router.put('/notifications/read-all/:userId', notification.markAllAsRead);

// Delete a notification
router.delete('/notifications/:notificationId', notification.deleteNotification);

// Notification preferences
router.put("/preferences", notification.updateNotificationPreferences);
router.get("/preferences/:userId", notification.getNotificationPreferences);

// Unread notification count
router.get('/notifications/unread-count/:userId', notification.getUnreadCount);

// Live notifications (combined)
router.get('/notifications/all-live/:userId', notification.getAllLiveNotifications);

router.get('/debug/:userId', notification.debugNotifications);


// Only unread notifications (popup)
router.get('/popup-notifications/live/:userId', notification.getLivepopupNotifications);



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


// Create Campaign (User) - Pass userId in body
router.post(
  "/campaigns",
  upload.array("media"),
  campaign.createCampaign
);

// Get User's Own Campaigns - Pass userId as param
router.get(
  "/campaigns/user/:userId",
  campaign.getUserCampaigns
);

// Get Single Campaign by ID (Public)
router.get(
  "/campaigns/:id",
  campaign.getCampaignById
);

// Update Campaign - Pass userId in body
router.put(
  "/campaigns/:id",
  upload.array("media"),
  campaign.updateCampaign
);

// Delete Campaign - Pass userId in body
router.delete(
  "/campaigns/:id",
  campaign.deleteCampaign
);

// Get Campaign Analytics - Pass userId as query param
router.get(
  "/campaigns/:id/analytics",
  campaign.getCampaignAnalytics
);

// ========================================
// ADMIN CAMPAIGN MANAGEMENT ROUTES
// ========================================

// Get All Campaigns - Pass isAdmin=true in query
router.get(
  "/admin/campaigns",
  campaign.getAllCampaigns
);

// Admin: Approve/Reject Campaign - Pass isAdmin=true in body
router.put(
  "/admin/campaigns/:id/review",
  campaign.adminReviewCampaign
);

// Admin: Push Campaign - Pass isAdmin=true in body
router.put(
  "/admin/campaigns/:id/push",
  campaign.adminPushCampaign
);

// Admin: Stop Campaign - Pass isAdmin=true in body
router.put(
  "/admin/campaigns/:id/stop",
  campaign.adminStopCampaign
);

// ========================================
// CAMPAIGN PACKAGE ROUTES
// ========================================

// Get All Packages (Public)
router.get(
  "/campaign-packages",
  campaign.getCampaignPackages
);

// Get Single Package (Public)
router.get(
  "/campaign-packages/:id",
  campaign.getCampaignPackageById
);

// Create Package - Pass isAdmin=true in body
router.post(
  "/campaign-packages",
  campaign.createCampaignPackage
);

// Update Package - Pass isAdmin=true in body
router.put(
  "/campaign-packages/:id",
  campaign.updateCampaignPackage
);

// Delete Package - Pass isAdmin=true in body
router.delete(
  "/campaign-packages/:id",
  campaign.deleteCampaignPackage
);

// ========================================
// PAYMENT ROUTES
// ========================================

// Create Payment Order - Pass userId in body
router.post(
  "/campaigns/payment/create-order",
  campaign.createPaymentOrder
);

// Verify Payment - Pass userId in body
router.post(
  "/campaigns/payment/verify",
  campaign.verifyPayment
);

// ========================================
// FAQ INTERACTION ROUTES (PUBLIC)
// ========================================

// Get Campaign FAQs (Public)
router.get(
  "/campaigns/:id/faqs",
  campaign.getCampaignFAQs
);

// Validate Single FAQ Answer (Public - live validation)
router.post(
  "/campaigns/faqs/validate",
  campaign.validateFAQAnswer
);

// Submit Complete FAQ Response (Public - pass userEmail in body)
router.post(
  "/campaigns/faqs/submit",
  campaign.submitFAQResponse
);

// Get FAQ Responses for Campaign - Pass userId or isAdmin in query
router.get(
  "/campaigns/:campaignId/faq-responses",
  campaign.getCampaignFAQResponses
);

// ========================================
// CAMPAIGN FEED & STATS
// ========================================

// Get Active Campaigns for Feed (Public)
router.get(
  "/campaigns/feed/active",
  campaign.getActiveCampaignsForFeed
);

// Update Campaign Stats (Public)
router.post(
  "/campaigns/stats/update",
  campaign.updateCampaignStats
);

// 8 Slots
router.post("/slot", spinCtrl.upsertSpinSlot);
router.get("/wheel", spinCtrl.getSpinWheel);

// Config
router.post("/config", spinCtrl.setSpinLimit);

// routes/spinRoutes
router.post("/spin", spinCtrl.spinWheel);
router.get("/allspins",spinCtrl.getAllSpins);
router.get("/spin/:spinId", spinCtrl.getSpinById);
router.get("/spin/user/:userId", spinCtrl.getUserSpins);
router.get("/spin/user/:userId/today", spinCtrl.getTodayUserSpins);
router.put("/spin/:spinId", spinCtrl.updateSpin);
router.delete("/spin/:spinId", spinCtrl.deleteSpin);
router.get("/spin/summary/:userId", spinCtrl.todaySpinSummary);
router.get("/wallet/:userId", spinCtrl.getWalletByUserId);
router.get("/wallet/:userId/history", spinCtrl.getWalletHistory);



router.post("/transfer-coins", spinCtrl.transferCoinsToFriend);

 
//download the post sections
router.post("/post-download", ctrl.downloadPost);
router.get("/post-downloads", ctrl.getAllDownloads);            
router.get("/post-downloads/user/:userId", ctrl.getDownloadsByUser);
router.get("/post-downloads/post/:postId",ctrl.getDownloadsByPost);

router.put("/post-download/:downloadId", ctrl.updateDownload); 
router.delete("/post-download/:downloadId",ctrl.deleteDownload); 

module.exports = router;
