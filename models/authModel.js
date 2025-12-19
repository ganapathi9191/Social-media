// models/authModel.js - COMPLETE ERROR-FREE VERSION
const mongoose = require("mongoose");

// ========================================
// POST SCHEMA
// ========================================
const postSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  media: [{
    _id: false,
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], required: true }
  }],
  // ✅ CLEAN: Only ObjectIds allowed
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  comments: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Auth',
      required: true
    },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    mentions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Auth'
    }]
  }],
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { _id: true });

// ✅ Pre-save hook to clean likes array
postSchema.pre('save', function (next) {
  if (this.likes && Array.isArray(this.likes)) {
    // Remove any non-ObjectId entries
    this.likes = this.likes.filter(like => {
      if (!like) return false;
      // Reject objects with extra properties
      if (typeof like === 'object' && Object.keys(like).length > 0 && !mongoose.Types.ObjectId.isValid(like)) {
        return false;
      }
      return mongoose.Types.ObjectId.isValid(like);
    });
  }
  next();
});

// ========================================
// OTHER SCHEMAS
// ========================================
const profileSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  username: { type: String, unique: true, sparse: true },
  about: String,
  website: String,
  image: String,
}, { _id: false });

const personalInfoSchema = new mongoose.Schema({
  birthdate: Date,
  gender: String,
  country: String,
  language: String,
}, { _id: false });

const notificationPreferencesSchema = new mongoose.Schema({
  posts: { type: Boolean, default: true },
  follows: { type: Boolean, default: true },
  likes: { type: Boolean, default: true },
  comments: { type: Boolean, default: true },
  followRequests: { type: Boolean, default: true },
  followApprovals: { type: Boolean, default: true },
  mentions: { type: Boolean, default: true },
  messages: { type: Boolean, default: true }
}, { _id: false });

// ========================================
// AUTH SCHEMA
// ========================================
const authSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  mobile: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, sparse: true },
  gender: { type: String },
  otpVerified: { type: Boolean, default: false },
  accountStatus: {
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null }
  },
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  followerRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  blockedFollowers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  savedPosts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post"
  }],
  profile: profileSchema,
  personalInfo: personalInfoSchema,
  privacy: {
    profileVisibility: {
      type: String,
      enum: ["public", "private"],
      default: "public"
    },
    searchEngineIndexing: { type: Boolean, default: true }
  },
  notificationPreferences: {
    type: notificationPreferencesSchema,
    default: () => ({
      posts: true,
      follows: true,
      likes: true,
      comments: true,
      followRequests: true,
      followApprovals: true,
      mentions: true,
      messages: true
    })
  },
  approvedFollowers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth"
  }],
  posts: [postSchema],
  wallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Wallet",
    default: null
  },
}, {
  timestamps: true
});

// ✅ Pre-save hook to clean all posts
authSchema.pre('save', function (next) {
  if (this.posts && Array.isArray(this.posts)) {
    this.posts.forEach(post => {
      // Clean likes
      if (post.likes && Array.isArray(post.likes)) {
        post.likes = post.likes.filter(like => {
          if (!like) return false;
          if (typeof like === 'object' && Object.keys(like).length > 1) {
            return false;
          }
          return mongoose.Types.ObjectId.isValid(like);
        });
      }

      // Clean comments
      if (post.comments && Array.isArray(post.comments)) {
        post.comments.forEach(comment => {
          // Remove any extra fields
          const allowedFields = ['_id', 'userId', 'text', 'createdAt', 'mentions'];
          Object.keys(comment.toObject ? comment.toObject() : comment).forEach(key => {
            if (!allowedFields.includes(key)) {
              delete comment[key];
            }
          });
        });
      }
    });
  }
  next();
});

// ========================================
// NOTIFICATION SCHEMA
// ========================================
const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true,
    index: true
  },
  /* ===== WALLET ===== */
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auth",
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['like', 'comment', 'mention', 'post', 'follow_request', 'follow_approval', 'follow_reject', 'follow', 'message'],
    required: true,
    index: true
  },
  post: {
    type: mongoose.Schema.Types.ObjectId
  },
  actionType: {
    type: String,
    enum: ['create', 'update', 'delete', 'accept', 'reject'],
    default: 'create'
  },
  reference: {
    postId: mongoose.Schema.Types.ObjectId,
    commentId: mongoose.Schema.Types.ObjectId,
    chatId: mongoose.Schema.Types.ObjectId
  },
  content: {
    title: String,
    description: String,
    preview: String
  },
  message: String,
  isRead: { type: Boolean, default: false, index: true },
  readAt: Date,
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// ✅ Compound indexes for performance
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, sender: 1, type: 1, post: 1 }, { unique: true, sparse: true });

// ========================================
// EXPORT MODELS
// ========================================
const Auth = mongoose.model("Auth", authSchema);
const Notification = mongoose.model("Notification", notificationSchema);

module.exports = { Auth, Notification }