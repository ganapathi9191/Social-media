const mongoose = require("mongoose");
const bcrypt = require('bcrypt');
const { generateToken, generateTempToken, verifyTempToken } = require('../utils/token');
const { uploadImage, uploadToCloudinary, uploadImages, uploadToCloudinarys } = require('../config/cloudinary');
const { Auth, Notification } = require('../models/authModel');

let tempForgotToken = null;

// ------------------ AUTHENTICATION CONTROLLERS ------------------

// Register user
exports.register = async (req, res) => {
  try {
    const { fullName, mobile, email, username, gender } = req.body;

    if (!fullName || !mobile || !email || !username || !gender) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const existingUser = await Auth.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Mobile already registered.' });
    }

    const existingUsername = await Auth.findOne({ "profile.username": username });
    if (existingUsername) {
      return res.status(400).json({ success: false, message: 'Username already exists.' });
    }

    const tempData = { fullName, mobile, email, username, gender, otp: '1234' };
    const token = generateTempToken(tempData);

    res.status(200).json({
      success: true,
      message: 'OTP sent (1234)',
      data: { token, otp: '1234' }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// Verify OTP & Save user
exports.verifyOtp = async (req, res) => {
  try {
    const { otp, token } = req.body;
    if (!otp || !token)
      return res.status(400).json({ success: false, message: 'OTP and token required.' });

    const decoded = verifyTempToken(token);

    if (otp !== decoded.otp)
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });

    const existingMobile = await Auth.findOne({ mobile: decoded.mobile });
    if (existingMobile)
      return res.status(400).json({ success: false, message: 'Mobile already registered.' });

    const existingEmail = await Auth.findOne({ email: decoded.email });
    if (existingEmail)
      return res.status(400).json({ success: false, message: 'Email already registered.' });

    const existingUsername = await Auth.findOne({ "profile.username": decoded.username });
    if (existingUsername)
      return res.status(400).json({ success: false, message: 'Username already exists.' });

    const user = await Auth.create({
      fullName: decoded.fullName,
      mobile: decoded.mobile,
      email: decoded.email,
      gender: decoded.gender,   // ✅ Added gender
      otpVerified: true,
      profile: {
        firstName: decoded.fullName.split(" ")[0],
        lastName: decoded.fullName.split(" ")[1] || "",
        username: decoded.username
      },
      notificationPreferences: {
        posts: true,
        follows: true,
        likes: true,
        comments: true,
        followRequests: true,
        followApprovals: true,
        mentions: true
      }
    });

    const authToken = generateToken({ userId: user._id });

    res.status(200).json({
      success: true,
      message: 'OTP verified. User registered successfully.',
      data: { userId: user._id, token: authToken }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { mobile, email } = req.body;

    if (!mobile && !email) {
      return res.status(400).json({ success: false, message: 'Mobile or Email is required.' });
    }

    // Find user either by mobile or email
    const user = await Auth.findOne({ $or: [{ mobile }, { email }] });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Ensure accountStatus exists
    if (!user.accountStatus) {
      user.accountStatus = { isActive: true };
      await user.save();
    }

    // If account is deactivated
    if (!user.accountStatus.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    // Generate OTP (hardcoded 1234 for now)
    const otp = '1234';

    // Create temp token with OTP
    const token = generateTempToken({ userId: user._id.toString(), otp });

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully (1234)',
      data: { userId: user._id, otp, token }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Verify login OTP
exports.verifyLoginOtp = async (req, res) => {
  try {
    const { userId, otp, token } = req.body;

    if (!userId || !otp || !token) {
      return res.status(400).json({ success: false, message: 'userId, OTP, and token are required.' });
    }

    // Decode token
    const decoded = verifyTempToken(token);

    // Validate OTP + user
    if (otp !== decoded.otp || userId !== decoded.userId) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!user.accountStatus.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    // Generate final auth token
    const authToken = generateToken({ userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Login successful ✅',
      data: {
        userId: user._id,
        fullName: user.fullName,
        username: user.profile?.username || null,
        email: user.email || null,
        mobile: user.mobile || null,
        gender: user.gender || null,
        token: authToken
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ------------------ USER MANAGEMENT CONTROLLERS ------------------

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await Auth.find({})
      .select("fullName email mobile profile accountStatus createdAt updatedAt")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      totalUsers: users.length,
      message: "Users fetched successfully ✅",
      data: users,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId)
      .select("fullName email mobile profile personalInfo accountStatus privacy notificationPreferences createdAt updatedAt");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      message: "User fetched successfully ✅",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};




// ------------------ STATISTICS CONTROLLER ------------------
exports.getUserStatistics = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId)
      .populate("followers", "_id")
      .populate("following", "_id")
      .populate("posts", "_id likes comments"); // assuming posts collection is referenced

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const stats = {
      posts: user.posts?.length || 0,
      followers: user.followers?.length || 0,
      following: user.following?.length || 0,
      likesReceived: user.posts?.reduce((acc, post) => acc + (post.likes?.length || 0), 0) || 0,
      commentsReceived: user.posts?.reduce((acc, post) => acc + (post.comments?.length || 0), 0) || 0,
    };

    res.status(200).json({
      success: true,
      message: "User statistics fetched successfully ✅",
      data: stats,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};













// Update user by ID
exports.updateUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.password;
    delete updateData.otpVerified;

    const user = await Auth.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select("fullName email mobile profile personalInfo accountStatus privacy notificationPreferences");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      message: "User updated successfully ✅",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete user by ID (admin only)
exports.deleteUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, message: "User deleted successfully ✅" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Search users by username or name
exports.searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, message: "Search query is required" });

    const users = await Auth.find({
      $or: [
        { fullName: { $regex: query, $options: 'i' } },
        { "profile.username": { $regex: query, $options: 'i' } }
      ]
    }).select("fullName profile.username profile.image");

    res.status(200).json({
      success: true,
      message: "Users found successfully ✅",
      data: users,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ PROFILE CONTROLLERS ------------------

// Create or update profile
exports.createOrUpdateProfile = async (req, res) => {
  try {
    const { userId, firstName, lastName, username, about, website } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user || !user.accountStatus.isActive)
      return res.status(404).json({ success: false, message: "User not found or deactivated" });

    if (username) {
      const existing = await Auth.findOne({ "profile.username": username, _id: { $ne: userId } });
      if (existing) return res.status(400).json({ success: false, message: "Username already exists" });
    }

    let imageUrl = user.profile?.image || "";
    if (req.file) {
      imageUrl = await uploadToCloudinary(req.file.buffer, "profileImages", req.file.originalname);
    }

    user.profile = {
      firstName: firstName || user.profile?.firstName,
      lastName: lastName || user.profile?.lastName,
      username: username || user.profile?.username,
      about: about || user.profile?.about,
      website: website || user.profile?.website,
      image: imageUrl,
    };

    user.fullName = `${user.profile.firstName} ${user.profile.lastName}`;
    await user.save();

    res.status(200).json({ success: true, message: "Profile updated ✅", data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get all profiles
exports.getProfiles = async (req, res) => {
   try {
    const users = await Auth.find({ "accountStatus.isActive": true })
      .select("fullName email mobile profile personalInfo accountStatus followers following posts savedPosts createdAt updatedAt")
      .populate("followers", "_id")
      .populate("following", "_id");

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No users found",
      });
    }

    // Format response with limited posts data
    const profilesWithCounts = users.map(user => ({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      mobile: user.mobile,
      profile: {
        firstName: user.profile?.firstName || "",
        lastName: user.profile?.lastName || "",
        username: user.profile?.username || "",
        about: user.profile?.about || "",
        website: user.profile?.website || "",
        image: user.profile?.image || "",
      },
      counts: {
        followers: user.followers?.length || 0,
        following: user.following?.length || 0,
      },
      // Include limited posts info (first 3 posts)
      posts: user.posts?.slice(0, 3).map(post => ({
        _id: post._id,
        description: post.description?.substring(0, 100) + (post.description?.length > 100 ? '...' : ''),
        mediaCount: post.media?.length || 0,
        likesCount: post.likes?.length || 0,
        commentsCount: post.comments?.length || 0,
        createdAt: post.createdAt
      })) || [],
      // Include savedPosts IDs or limited info
      savedPosts: user.savedPosts?.slice(0, 5) || [], // First 5 saved posts
      personalInfo: user.personalInfo || {},
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      message: "Profiles fetched successfully",
      totalProfiles: profilesWithCounts.length,
      data: profilesWithCounts,
    });

  } catch (error) {
    console.error("Error fetching profiles:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
// Get single profile
exports.getProfileById = async (req, res) => {
    try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid userId" 
      });
    }

    const user = await Auth.findById(userId)
      .select("fullName email mobile gender profile personalInfo accountStatus privacy notificationPreferences followers following posts savedPosts createdAt updatedAt")
      .populate("followers", "fullName profile.username profile.image")
      .populate("following", "fullName profile.username profile.image");

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Calculate counts only for followers and following
    const followersCount = user.followers?.length || 0;
    const followingCount = user.following?.length || 0;

    // Format the response
    const profileData = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      mobile: user.mobile,
      gender: user.gender,
      profile: {
        firstName: user.profile?.firstName || "",
        lastName: user.profile?.lastName || "",
        username: user.profile?.username || "",
        about: user.profile?.about || "",
        website: user.profile?.website || "",
        image: user.profile?.image || "",
      },
      counts: {
        followers: followersCount,
        following: followingCount,
        // Don't include posts and savedPosts in counts
      },
      
      posts: user.posts || [], // Show posts normally
      savedPosts: user.savedPosts || [], // Show saved posts normally
      personalInfo: user.personalInfo || {},
      privacy: user.privacy || {},
      notificationPreferences: user.notificationPreferences || {},
      accountStatus: user.accountStatus || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: "Profile fetched successfully ✅",
      data: profileData,
    });

  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};
// Delete profile
exports.deleteProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.profile = undefined;
    user.fullName = "";
    await user.save();

    res.status(200).json({ success: true, message: "Profile deleted ✅" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ PERSONAL INFO CONTROLLERS ------------------

// post or update personal info
exports.updatePersonalInfo = async (req, res) => {
  try {
    const { userId, birthdate, gender, country, language } = req.body;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user || !user.accountStatus.isActive)
      return res.status(404).json({ success: false, message: "User not found or deactivated" });

    user.personalInfo = {
      birthdate: birthdate || user.personalInfo?.birthdate,
      gender: gender || user.personalInfo?.gender,
      country: country || user.personalInfo?.country,
      language: language || user.personalInfo?.language,
    };

    await user.save();
    res.status(200).json({ success: true, message: "Personal Information updated ✅", data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


// ✅ Get All Users Personal Info
exports.getAllPersonalInfo = async (req, res) => {
  try {
    const users = await Auth.find({ "accountStatus.isActive": true }).select("personalInfo");
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ✅ Get Personal Info By UserId
exports.getPersonalInfoById = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    // select both personalInfo and accountStatus
    const user = await Auth.findById(userId).select("personalInfo accountStatus");
    if (!user || !user.accountStatus?.isActive)
      return res.status(404).json({ success: false, message: "User not found or deactivated" });

    res.status(200).json({ success: true, data: user.personalInfo });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ✅ Delete Personal Info By UserId
exports.deletePersonalInfoById = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user || !user.accountStatus.isActive)
      return res.status(404).json({ success: false, message: "User not found or deactivated" });

    user.personalInfo = undefined; // clear personal info
    await user.save();

    res.status(200).json({ success: true, message: "Personal Information deleted ❌" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ ACCOUNT MANAGEMENT CONTROLLERS ------------------

// Deactivate account temporarily
exports.deactivateAccount = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user || !user.accountStatus.isActive)
      return res.status(404).json({ success: false, message: "User not found or already deactivated" });

    user.accountStatus.isActive = false;
    await user.save();

    res.status(200).json({ success: true, message: "Account deactivated temporarily ✅" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Reactivate account
exports.reactivateAccount = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.accountStatus.isActive = true;
    await user.save();

    res.status(200).json({ success: true, message: "Account reactivated ✅" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete account permanently
exports.deleteAccount = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.accountStatus.isActive = false;
    user.accountStatus.deletedAt = new Date();
    user.profile = undefined;
    user.personalInfo = undefined;
    user.fullName = "";
    user.mobile = "";
    user.email = "";
    user.password = undefined;

    await user.save();

    res.status(200).json({ success: true, message: "Account permanently deleted ✅" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};



// ------------------ PRIVACY CONTROLLERS ------------------

// Update profile privacy
exports.updateProfilePrivacy = async (req, res) => {
  try {
    const { userId, profileVisibility, searchEngineIndexing } = req.body;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId);
    if (!user || !user.accountStatus?.isActive)
      return res.status(404).json({ success: false, message: "User not found or deactivated" });

    if (profileVisibility) {
      if (!["public", "private"].includes(profileVisibility)) {
        return res.status(400).json({ success: false, message: "profileVisibility must be 'public' or 'private'" });
      }
      user.privacy.profileVisibility = profileVisibility;
    }

    if (searchEngineIndexing !== undefined) {
      if (searchEngineIndexing !== "on" && searchEngineIndexing !== "off") {
        return res.status(400).json({ success: false, message: "searchEngineIndexing must be 'on' or 'off'" });
      }
      user.privacy.searchEngineIndexing = (searchEngineIndexing === "on");
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Profile privacy updated ✅",
      data: user.privacy
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Fetch user profile considering visibility
exports.fetchUserProfile = async (req, res) => {
  try {
    const { userId, viewerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId).populate("approvedFollowers", "fullName profile.username");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (user.privacy.profileVisibility === "private") {
      const isApproved = user.approvedFollowers.some(f => f._id.toString() === viewerId);
      if (!isApproved) {
        return res.status(403).json({ success: false, message: "This profile is private" });
      }
    }

    res.status(200).json({
      success: true,
      message: "Profile fetched successfully ✅",
      data: user
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


// ------------------ UTILITY CONTROLLERS ------------------

// Check username availability
exports.checkUsernameAvailability = async (req, res) => {
  try {
    const { username } = req.params;

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    const existingUser = await Auth.findOne({ "profile.username": username });
    
    res.status(200).json({
      success: true,
      available: !existingUser,
      message: existingUser ? "Username is taken" : "Username is available"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get user dashboard data
exports.getUserDashboard = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId)
      .populate("followers", "fullName profile.username profile.image")
      .populate("following", "fullName profile.username profile.image")
      .select("fullName profile posts followers following");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const postCount = user.posts.length;
    const followerCount = user.followers.length;
    const followingCount = user.following.length;

    // Get recent notifications count
    const notificationCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    res.status(200).json({
      success: true,
      message: "Dashboard data fetched successfully",
      data: {
        user: {
          fullName: user.fullName,
          username: user.profile?.username,
          image: user.profile?.image
        },
        stats: {
          posts: postCount,
          followers: followerCount,
          following: followingCount
        },
        notifications: notificationCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};



