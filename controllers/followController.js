const mongoose = require("mongoose");
const { Auth } = require('../models/authModel');
const { sendFollowNotification, sendFollowRequestNotification, sendFollowApprovalNotification } = require('./notificationControllers');

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
        sendFollowNotification(userId, targetId);
      }
      
      return res.status(200).json({ success: true, message: "Followed successfully ✅" });
    }

    if (!target.followerRequests.includes(userId)) {
      target.followerRequests.push(userId);
      await target.save();

      // Send follow request notification if enabled
      if (target.notificationPreferences.followRequests) {
        sendFollowRequestNotification(userId, targetId);
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
      sendFollowApprovalNotification(userId, followerId);
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
            sendFollowApprovalNotification(userId, followerId);
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
          sendFollowNotification(userId, targetId);
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
            sendFollowRequestNotification(userId, targetId);
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


// Get posts where user mentioned others
exports.getPostsWithUserMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Find all posts created by this user that have mentions
    const user = await Auth.findById(userId)
      .populate("posts.mentions", "fullName profile.username profile.image");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const postsWithMentions = user.posts.filter(post => 
      post.mentions && post.mentions.length > 0
    );

    // Sort by creation date (newest first)
    postsWithMentions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      message: "Posts with mentions fetched successfully",
      data: postsWithMentions
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get posts where user is mentioned
exports.getPostMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Find all posts where the user is mentioned
    const usersWithMentions = await Auth.find({ 
      "posts.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image");

    const mentionedPosts = [];
    usersWithMentions.forEach(user => {
      user.posts.forEach(post => {
        if (post.mentions.includes(userId)) {
          mentionedPosts.push(post);
        }
      });
    });

    // Sort by creation date (newest first)
    mentionedPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      message: "Mentioned posts fetched successfully",
      data: mentionedPosts
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get comments where user is mentioned
exports.getCommentMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Find all posts with comments where the user is mentioned
    const usersWithMentions = await Auth.find({ 
      "posts.comments.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image");

    const mentionedComments = [];
    usersWithMentions.forEach(user => {
      user.posts.forEach(post => {
        post.comments.forEach(comment => {
          if (comment.mentions && comment.mentions.includes(userId)) {
            mentionedComments.push({
              postId: post._id,
              postDescription: post.description,
              comment: comment
            });
          }
        });
      });
    });

    // Sort by creation date (newest first)
    mentionedComments.sort((a, b) => new Date(b.comment.createdAt) - new Date(a.comment.createdAt));

    res.status(200).json({
      success: true,
      message: "Mentioned comments fetched successfully",
      data: mentionedComments
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get all mentions for a user (both posts and comments)
exports.getAllMentions = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    // Get post mentions
    const usersWithPostMentions = await Auth.find({ 
      "posts.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image");

    const postMentions = [];
    usersWithPostMentions.forEach(user => {
      user.posts.forEach(post => {
        if (post.mentions.includes(userId)) {
          postMentions.push(post);
        }
      });
    });

    // Get comment mentions
    const usersWithCommentMentions = await Auth.find({ 
      "posts.comments.mentions": userId 
    }).populate("posts.userId", "fullName profile.username profile.image")
      .populate("posts.comments.userId", "fullName profile.username profile.image");

    const commentMentions = [];
    usersWithCommentMentions.forEach(user => {
      user.posts.forEach(post => {
        post.comments.forEach(comment => {
          if (comment.mentions && comment.mentions.includes(userId)) {
            commentMentions.push({
              postId: post._id,
              postDescription: post.description,
              comment: comment
            });
          }
        });
      });
    });

    // Sort by creation date (newest first)
    postMentions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    commentMentions.sort((a, b) => new Date(b.comment.createdAt) - new Date(a.comment.createdAt));

    res.status(200).json({
      success: true,
      message: "All mentions fetched successfully",
      data: {
        postMentions,
        commentMentions
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Remove mention from post
exports.removePostMention = async (req, res) => {
  try {
    const { userId, postId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || 
        !mongoose.Types.ObjectId.isValid(postId) || 
        !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Remove the mention
    post.mentions = post.mentions.filter(mentionId => mentionId.toString() !== userId);
    await postOwner.save();

    res.status(200).json({
      success: true,
      message: "Mention removed from post successfully"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Remove mention from comment
exports.removeCommentMention = async (req, res) => {
  try {
    const { userId, postId, commentId, postOwnerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || 
        !mongoose.Types.ObjectId.isValid(postId) || 
        !mongoose.Types.ObjectId.isValid(commentId) || 
        !mongoose.Types.ObjectId.isValid(postOwnerId)) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    const postOwner = await Auth.findById(postOwnerId);
    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post owner not found" });
    }

    const post = postOwner.posts.id(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    // Remove the mention
    if (comment.mentions) {
      comment.mentions = comment.mentions.filter(mentionId => mentionId.toString() !== userId);
      await postOwner.save();
    }

    res.status(200).json({
      success: true,
      message: "Mention removed from comment successfully"
    });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};