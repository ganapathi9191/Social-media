const mongoose = require("mongoose");

// ✅ CORRECTED postSchema - Fixed likes structure
const postSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true },
  description: String,
  media: [
    {
      _id: false,
      url: { type: String, required: true },
      type: { type: String, enum: ["image", "video"], required: true }
    }
  ],
  // ✅ FIXED: Ensure likes only contains ObjectIds
  likes: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Auth" 
  }],
  comments: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Auth', required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Auth' }]
  }],
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { _id: true });

// ✅ Register Post as its own model
const Post = mongoose.model("Post", postSchema);

// ... rest of your schemas remain the same
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
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  followerRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  blockedFollowers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
  profile: profileSchema,
  personalInfo: personalInfoSchema,
  privacy: {
    profileVisibility: { type: String, enum: ["public", "private"], default: "public" },
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
  approvedFollowers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  posts: [postSchema],
}, { 
  timestamps: true,
  // Add validation to prevent invalid data
  validate: {
    validator: function(doc) {
      // Validate that posts.likes only contains ObjectIds
      if (doc.posts && Array.isArray(doc.posts)) {
        for (const post of doc.posts) {
          if (post.likes && Array.isArray(post.likes)) {
            for (const like of post.likes) {
              if (!mongoose.Types.ObjectId.isValid(like)) {
                return false;
              }
            }
          }
        }
      }
      return true;
    },
    message: 'Posts likes must contain valid ObjectIds'
  }
});

// ✅ Notification schema
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true, index: true },
  type: {
    type: String,
    enum: ['like', 'comment', 'mention', 'post', 'follow_request', 'follow_approval', 'follow_reject', 'follow', 'message'],
    required: true,
    index: true
  },
  post: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
  actionType: { type: String, enum: ['create', 'update', 'delete', 'accept', 'reject'], default: 'create' },
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

// ✅ Compound indexes for better query performance
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, sender: 1, type: 1, post: 1 }, { unique: true, sparse: true });

// ✅ Export models
const Auth = mongoose.model("Auth", authSchema);
const Notification = mongoose.model("Notification", notificationSchema);

module.exports = { Auth, Notification, Post };