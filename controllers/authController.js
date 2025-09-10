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
    const { fullName, mobile, email, username } = req.body;

    if (!fullName || !mobile || !email || !username) {
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

    const tempData = { fullName, mobile, email, username, otp: '1234' };
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

    const user = await Auth.findOne({ $or: [{ mobile }, { email }] });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (!user.accountStatus) {
      user.accountStatus = { isActive: true };
      await user.save();
    }

    if (!user.accountStatus.isActive)
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });

    const otp = '1234';
    const token = generateTempToken({ userId: user._id, otp });

    res.status(200).json({
      success: true,
      message: 'OTP sent (1234)',
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
    if (!userId || !otp || !token) return res.status(400).json({ success: false, message: 'userId, OTP, and token are required.' });

    const decoded = verifyTempToken(token);
    if (otp !== decoded.otp || userId !== decoded.userId) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.accountStatus.isActive) return res.status(403).json({ success: false, message: 'Account is deactivated.' });

    const authToken = generateToken({ userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Login successful ✅',
      data: {
        userId: user._id,
        fullName: user.fullName,
        username: user.profile?.username || null,
        token: authToken
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    const users = await Auth.find({ profile: { $exists: true, $ne: null } })
      .select("fullName email mobile profile createdAt updatedAt");

    if (!users.length) return res.status(404).json({ success: false, message: "No profiles found" });

    res.status(200).json({
      success: true,
      totalProfiles: users.length,
      message: "Profiles fetched successfully ✅",
      data: users,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get single profile
exports.getProfileById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId).select("fullName profile");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!user.profile) return res.status(404).json({ success: false, message: "Profile not created yet" });

    res.status(200).json({
      success: true,
      message: "Profile fetched successfully ✅",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
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

// Add or update personal info
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

// Get personal info
exports.getPersonalInfo = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId).select("personalInfo");
    if (!user || !user.personalInfo)
      return res.status(404).json({ success: false, message: "Personal information not found" });

    res.status(200).json({
      success: true,
      message: "Personal information fetched ✅",
      data: user.personalInfo
    });
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

// ------------------ FOLLOW/FOLLOWER CONTROLLERS ------------------

// Follow user
exports.followUser = async (req, res) => {
  try {
    const { userId, targetId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(targetId))
      return res.status(400).json({ success: false, message: "Invalid userId or targetId" });

    const user = await Auth.findById(userId);
    const target = await Auth.findById(targetId);
    if (!user || !target) return res.status(404).json({ success: false, message: "User not found" });

    if (target.blockedFollowers.includes(userId))
      return res.status(403).json({ success: false, message: "You are blocked by this user" });

    if (target.privacy.profileVisibility === "public") {
      if (!target.followers.includes(userId)) target.followers.push(userId);
      if (!user.following.includes(targetId)) user.following.push(targetId);
      await target.save();
      await user.save();
      
      // Send follow notification if enabled
      if (target.notificationPreferences.follows) {
        this.sendFollowNotification(userId, targetId);
      }
      
      return res.status(200).json({ success: true, message: "Followed successfully ✅" });
    }

    if (!target.followerRequests.includes(userId)) {
      target.followerRequests.push(userId);
      await target.save();

      // Send follow request notification if enabled
      if (target.notificationPreferences.followRequests) {
        this.sendFollowRequestNotification(userId, targetId);
      }
    }
    return res.status(200).json({ success: true, message: "Follow request sent ✅" });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Approve follower
exports.approveFollower = async (req, res) => {
  try {
    const { userId, followerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(followerId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or followerId" });
    }

    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.followerRequests = user.followerRequests.filter(id => id.toString() !== followerId);

    if (!user.followers.map(id => id.toString()).includes(followerId)) {
      user.followers.push(followerId);
    }

    if (!follower.following.map(id => id.toString()).includes(userId)) {
      follower.following.push(userId);
    }

    await user.save();
    await follower.save();

    const updatedUser = await Auth.findById(userId)
      .populate("followers", "fullName profile.username profile.image");

    // Send follow approval notification if enabled
    if (follower.notificationPreferences.followApprovals) {
      this.sendFollowApprovalNotification(userId, followerId);
    }

    res.status(200).json({
      success: true,
      message: "Follower approved ✅",
      data: updatedUser.followers
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Reject follower
exports.rejectFollower = async (req, res) => {
  try {
    const { userId, followerId } = req.body;
    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.followerRequests = user.followerRequests.filter(id => id.toString() !== followerId);
    await user.save();

    res.status(200).json({ success: true, message: "Follower request rejected ❌" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Block follower
exports.blockFollower = async (req, res) => {
  try {
    const { userId, followerId } = req.body;
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) return res.status(404).json({ success: false, message: "User not found" });

    user.followers = user.followers.filter(id => id.toString() !== followerId);
    follower.following = follower.following.filter(id => id.toString() !== userId);

    if (!user.blockedFollowers.map(id => id.toString()).includes(followerId)) {
      user.blockedFollowers.push(followerId);
    }

    await user.save();
    await follower.save();

    res.status(200).json({ success: true, message: "Follower blocked ⛔" });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get followers
exports.getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId)
      .populate("followers", "fullName profile.username profile.image")
      .populate("followerRequests", "fullName profile.username profile.image");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      followers: user.followers,
      pendingRequests: user.followerRequests
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get following
exports.getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ success: false, message: "Invalid userId" });

    const user = await Auth.findById(userId)
      .populate("following", "fullName profile.username profile.image");

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      following: user.following
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Update followers
exports.updateFollowers = async (req, res) => {
  try {
    const { userId, approve = [], reject = [] } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    for (const followerId of approve) {
      if (user.followerRequests.map(id => id.toString()).includes(followerId)) {
        user.followerRequests = user.followerRequests.filter(id => id.toString() !== followerId);

        if (!user.followers.map(id => id.toString()).includes(followerId)) {
          user.followers.push(followerId);
        }

        const follower = await Auth.findById(followerId);
        if (follower && !follower.following.map(id => id.toString()).includes(userId)) {
          follower.following.push(userId);
          await follower.save();
          
          // Send follow approval notification if enabled
          if (follower.notificationPreferences.followApprovals) {
            this.sendFollowApprovalNotification(userId, followerId);
          }
        }
      }
    }

    for (const followerId of reject) {
      user.followerRequests = user.followerRequests.filter(id => id.toString() !== followerId);
      user.followers = user.followers.filter(id => id.toString() !== followerId);

      const follower = await Auth.findById(followerId);
      if (follower) {
        follower.following = follower.following.filter(id => id.toString() !== userId);
        await follower.save();
      }
    }

    await user.save();

    const updatedUser = await Auth.findById(userId)
      .populate("followers", "fullName profile")
      .populate("followerRequests", "fullName profile");

    res.status(200).json({
      success: true,
      message: "Followers updated ✅",
      data: {
        followers: updatedUser.followers,
        pendingRequests: updatedUser.followerRequests
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete follower
exports.deleteFollower = async (req, res) => {
  try {
    const { userId, followerId } = req.body;
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) return res.status(404).json({ success: false, message: "User not found" });

    user.followers = user.followers.filter(id => id.toString() !== followerId);
    follower.following = follower.following.filter(id => id.toString() !== userId);

    await user.save();
    await follower.save();

    res.status(200).json({ success: true, message: "Follower removed ✅" });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete following
exports.deleteFollowing = async (req, res) => {
  try {
    const { userId, targetId } = req.body;
    const user = await Auth.findById(userId);
    const target = await Auth.findById(targetId);

    if (!user || !target) return res.status(404).json({ success: false, message: "User not found" });

    user.following = user.following.filter(id => id.toString() !== targetId);
    target.followers = target.followers.filter(id => id.toString() !== userId);

    await user.save();
    await target.save();

    res.status(200).json({ success: true, message: "Unfollowed successfully ✅" });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Toggle follow/unfollow
exports.toggleFollow = async (req, res) => {
  try {
    const { userId, targetId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or targetId" });
    }

    const user = await Auth.findById(userId);
    const target = await Auth.findById(targetId);

    if (!user || !target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (target.blockedFollowers.includes(userId)) {
      return res.status(403).json({ success: false, message: "You are blocked by this user" });
    }

    // Check if already following
    const isFollowing = user.following.includes(targetId);

    if (isFollowing) {
      // Unfollow logic
      user.following.pull(targetId);
      target.followers.pull(userId);

      await user.save();
      await target.save();

      return res.status(200).json({
        success: true,
        message: "Unfollowed successfully ✅",
        action: "unfollowed"
      });
    } else {
      // Follow logic
      if (target.privacy.profileVisibility === "public") {
        user.following.push(targetId);
        target.followers.push(userId);

        await user.save();
        await target.save();

        // Send follow notification if enabled
        if (target.notificationPreferences.follows) {
          this.sendFollowNotification(userId, targetId);
        }

        return res.status(200).json({
          success: true,
          message: "Followed successfully ✅",
          action: "followed"
        });
      } else {
        // Private account - send follow request
        if (!target.followerRequests.includes(userId)) {
          target.followerRequests.push(userId);
          await target.save();

          // Send follow request notification if enabled
          if (target.notificationPreferences.followRequests) {
            this.sendFollowRequestNotification(userId, targetId);
          }
        }

        return res.status(200).json({
          success: true,
          message: "Follow request sent ✅",
          action: "requested"
        });
      }
    }

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ POST CONTROLLERS ------------------

// Create a new post with mentions
exports.createPost = async (req, res) => {
  try {
    const { userId, description } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let mediaFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "posts", file.originalname);
        mediaFiles.push({
          url,
          type: file.mimetype.startsWith("video") ? "video" : "image",
        });
      }
    }

    // Extract mentions from description
    const mentionRegex = /@(\w+)/g;
    let mentions = [];
    let match;
    while ((match = mentionRegex.exec(description)) !== null) {
      const mentionedUser = await Auth.findOne({ "profile.username": match[1] });
      if (mentionedUser) {
        mentions.push(mentionedUser._id);
      }
    }

    const newPost = {
      userId,
      description,
      media: mediaFiles,
      mentions,
      likes: [],
      comments: [],
      createdAt: new Date(),
    };

    user.posts.push(newPost);
    await user.save();

    const createdPost = user.posts[user.posts.length - 1];

    // Send post notification if enabled for followers
    if (user.notificationPreferences.posts) {
      this.sendPostNotification(userId, createdPost._id, description || "a new post");
    }

    // Send mention notifications if enabled for mentioned users
    for (const mentionedUserId of mentions) {
      const mentionedUser = await Auth.findById(mentionedUserId);
      if (mentionedUser && mentionedUser.notificationPreferences.mentions) {
        this.sendMentionNotification(userId, mentionedUserId, createdPost._id, description || "mentioned you in a post");
      }
    }

    res.status(201).json({
      success: true,
      message: "Post created ✅",
      data: createdPost
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Get all posts from all users
exports.getAllPosts = async (req, res) => {
  try {
    const users = await Auth.find({ "posts.0": { $exists: true } })
      .populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.mentions", "fullName profile.username profile.image")
      .select("posts");

    const allPosts = users.flatMap(user => user.posts);
    allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      totalPosts: allPosts.length,
      data: allPosts
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Get all posts for a specific user
exports.getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId)
      .populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image")
      .populate("posts.mentions", "fullName profile.username profile.image")
      .select("posts");

    if (!user || !user.posts || user.posts.length === 0) {
      return res.status(404).json({ success: false, message: "No posts found for this user" });
    }

    res.status(200).json({
      success: true,
      message: "Posts fetched successfully ✅",
      data: user.posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Like/Unlike a post
exports.toggleLikePost = async (req, res) => {
  try {
    const { postId, userId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid postId or userId or postOwnerId" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const alreadyLiked = post.likes.some(like => like.toString() === userId);

    if (alreadyLiked) {
      post.likes.pull(userId);
    } else {
      post.likes.push(userId);

      // Send like notification if enabled for post owner
      if (postOwner.notificationPreferences.likes && postOwner._id.toString() !== userId) {
        this.sendLikeNotification(userId, postOwnerId, postId);
      }
    }

    await postOwner.save();

    res.status(200).json({
      success: true,
      message: alreadyLiked ? "Post unliked ✅" : "Post liked ✅",
      likesCount: post.likes.length,
      likes: post.likes
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Add comment to a post with mentions
exports.addComment = async (req, res) => {
  try {
    const { userId, postId, postOwnerId, text } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    if (!text || text.trim() === "") {
      return res.status(400).json({ success: false, message: "Comment text is required" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Extract mentions from comment text
    const mentionRegex = /@(\w+)/g;
    let mentions = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionedUser = await Auth.findOne({ "profile.username": match[1] });
      if (mentionedUser) {
        mentions.push(mentionedUser._id);
      }
    }

    post.comments.push({
      userId,
      text: text.trim(),
      createdAt: new Date()
    });

    await postOwner.save();

    await postOwner.populate('posts.comments.userId', 'fullName profile.username profile.image');

    const updatedPost = postOwner.posts.id(postId);
    const newComment = updatedPost.comments[updatedPost.comments.length - 1];

    // Send comment notification if enabled for post owner
    if (postOwner.notificationPreferences.comments && postOwnerId.toString() !== userId) {
      this.sendCommentNotification(userId, postOwnerId, postId, text.trim());
    }

    // Send mention notifications if enabled for mentioned users
    for (const mentionedUserId of mentions) {
      const mentionedUser = await Auth.findById(mentionedUserId);
      if (mentionedUser && mentionedUser.notificationPreferences.mentions) {
        this.sendMentionNotification(userId, mentionedUserId, postId, text.trim());
      }
    }

    res.status(201).json({
      success: true,
      message: "Comment added successfully ✅",
      data: newComment
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete a post
exports.deletePost = async (req, res) => {
  try {
    const { userId, postId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Invalid userId or postId" });
    }

    const user = await Auth.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Find the post and remove it
    const postIndex = user.posts.findIndex(post => post._id.toString() === postId);

    if (postIndex === -1) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    user.posts.splice(postIndex, 1);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Post deleted successfully ✅"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ SAVE POST CONTROLLERS ------------------

// Save/Unsave Post
exports.toggleSavePost = async (req, res) => {
  try {
    const { userId, postId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId) || !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const user = await Auth.findById(userId);
    const postOwner = await Auth.findById(postOwnerId);
    
    if (!user || !postOwner) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const isSaved = user.savedPosts.some(savedPostId => savedPostId.toString() === postId);

    if (isSaved) {
      user.savedPosts.pull(postId);
      await user.save();
      return res.status(200).json({ success: true, message: "Post unsaved", action: "unsaved" });
    } else {
      user.savedPosts.push(postId);
      await user.save();
      return res.status(200).json({ success: true, message: "Post saved", action: "saved" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get Saved Posts
exports.getSavedPosts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Get all posts that are saved by the user
    const savedPosts = [];
    for (const postId of user.savedPosts) {
      // Find the post in any user's posts
      const postOwner = await Auth.findOne({ "posts._id": postId })
        .populate("posts.userId", "fullName profile.username profile.image")
        .populate("posts.comments.userId", "fullName profile.username profile.image")
        .populate("posts.mentions", "fullName profile.username profile.image");
      
      if (postOwner) {
        const post = postOwner.posts.id(postId);
        if (post) {
          savedPosts.push(post);
        }
      }
    }

    // Sort by creation date (newest first)
    savedPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      message: "Saved posts fetched successfully",
      data: savedPosts
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ NOTIFICATION PREFERENCE CONTROLLERS ------------------

// Update Notification Preferences
exports.updateNotificationPreferences = async (req, res) => {
  try {
    const { userId, preferences } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Update notification preferences
    if (preferences) {
      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...preferences
      };
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Notification preferences updated successfully",
      data: user.notificationPreferences
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get Notification Preferences
exports.getNotificationPreferences = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const user = await Auth.findById(userId).select('notificationPreferences');
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification preferences fetched successfully",
      data: user.notificationPreferences
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ------------------ NOTIFICATION CONTROLLERS ------------------

// Send notification to followers when a new post is created
exports.sendPostNotification = async (userId, postId, postDescription) => {
  try {
    const user = await Auth.findById(userId);
    if (!user) return;

    // Get all followers
    const followers = user.followers;

    if (followers.length === 0) return;

    const message = `${user.fullName} created a new post: "${postDescription.substring(0, 50)}${postDescription.length > 50 ? '...' : ''}"`;

    // Create notifications for all followers who have post notifications enabled
    const notifications = [];
    for (const followerId of followers) {
      const follower = await Auth.findById(followerId);
      if (follower && follower.notificationPreferences.posts) {
        notifications.push({
          recipient: followerId,
          sender: userId,
          type: "post",
          post: postId,
          message: message,
          isRead: false
        });
      }
    }

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

  } catch (error) {
    console.error("Error sending post notifications:", error);
  }
};

// Send follow request notification
exports.sendFollowRequestNotification = async (followerId, targetId) => {
  try {
    const follower = await Auth.findById(followerId);
    const target = await Auth.findById(targetId);

    if (!follower || !target) return;
    
    // Check if target has follow request notifications enabled
    if (!target.notificationPreferences.followRequests) return;

    const notification = new Notification({
      recipient: targetId,
      sender: followerId,
      type: "follow_request",
      message: `${follower.fullName} sent you a follow request`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending follow request notification:", error);
  }
};

// Send follow notification
exports.sendFollowNotification = async (followerId, targetId) => {
  try {
    const follower = await Auth.findById(followerId);
    const target = await Auth.findById(targetId);

    if (!follower || !target) return;
    
    // Check if target has follow notifications enabled
    if (!target.notificationPreferences.follows) return;

    const notification = new Notification({
      recipient: targetId,
      sender: followerId,
      type: "follow",
      message: `${follower.fullName} started following you`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending follow notification:", error);
  }
};

// Send follow approval notification
exports.sendFollowApprovalNotification = async (userId, followerId) => {
  try {
    const user = await Auth.findById(userId);
    const follower = await Auth.findById(followerId);

    if (!user || !follower) return;
    
    // Check if follower has follow approval notifications enabled
    if (!follower.notificationPreferences.followApprovals) return;

    const notification = new Notification({
      recipient: followerId,
      sender: userId,
      type: "follow_approval",
      message: `${user.fullName} approved your follow request`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending follow approval notification:", error);
  }
};

// Send like notification
exports.sendLikeNotification = async (userId, postOwnerId, postId) => {
  try {
    const user = await Auth.findById(userId);
    const postOwner = await Auth.findById(postOwnerId);

    if (!user || !postOwner || userId.toString() === postOwnerId.toString()) return;
    
    // Check if post owner has like notifications enabled
    if (!postOwner.notificationPreferences.likes) return;

    const notification = new Notification({
      recipient: postOwnerId,
      sender: userId,
      type: "like",
      post: postId,
      message: `${user.fullName} liked your post`,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending like notification:", error);
  }
};

// Send comment notification
exports.sendCommentNotification = async (userId, postOwnerId, postId, commentText) => {
  try {
    const user = await Auth.findById(userId);
    const postOwner = await Auth.findById(postOwnerId);

    if (!user || !postOwner || userId.toString() === postOwnerId.toString()) return;
    
    // Check if post owner has comment notifications enabled
    if (!postOwner.notificationPreferences.comments) return;

    const message = `${user.fullName} commented on your post: "${commentText.substring(0, 30)}${commentText.length > 30 ? '...' : ''}"`;

    const notification = new Notification({
      recipient: postOwnerId,
      sender: userId,
      type: "comment",
      post: postId,
      message: message,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending comment notification:", error);
  }
};

// Send mention notification
exports.sendMentionNotification = async (senderId, recipientId, postId, messageText) => {
  try {
    const sender = await Auth.findById(senderId);
    const recipient = await Auth.findById(recipientId);

    if (!sender || !recipient || senderId.toString() === recipientId.toString()) return;
    
    // Check if recipient has mention notifications enabled
    if (!recipient.notificationPreferences.mentions) return;

    const message = `${sender.fullName} mentioned you: "${messageText.substring(0, 30)}${messageText.length > 30 ? '...' : ''}"`;

    const notification = new Notification({
      recipient: recipientId,
      sender: senderId,
      type: "mention",
      post: postId,
      message: message,
      isRead: false
    });

    await notification.save();
  } catch (error) {
    console.error("Error sending mention notification:", error);
  }
};

// Get all notifications for a user
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const notifications = await Notification.find({ recipient: userId })
      .populate("sender", "fullName profile.username profile.image")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      data: notifications
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notificationId" });
    }

    const notification = await Notification.findByIdAndDelete(notificationId);

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get unread notification count
exports.getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const count = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    res.status(200).json({
      success: true,
      message: "Unread count fetched successfully",
      data: { unreadCount: count }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};