const mongoose = require("mongoose");

// Define postSchema FIRST since it's used in authSchema
const postSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "Auth", required: true },
  description: { type: String },
  media: [
    {
      _id: false,
      url: { type: String, required: true },
      type: { type: String, enum: ["image", "video"], required: true }
    }
  ],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  comments: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "Auth" },
      text: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  createdAt: { type: Date, default: Date.now },
});

const profileSchema = new mongoose.Schema({
  firstName: { type: String },
  lastName: { type: String },
  username: { type: String, unique: true },
  about: { type: String },
  website: { type: String },
  image: { type: String },
});

const personalInfoSchema = new mongoose.Schema({
  birthdate: { type: Date },
  gender: { type: String },
  country: { type: String },
  language: { type: String },
});

// Add notification preferences schema
const notificationPreferencesSchema = new mongoose.Schema({
  posts: { type: Boolean, default: true },
  follows: { type: Boolean, default: true },
  likes: { type: Boolean, default: true },
  comments: { type: Boolean, default: true },
  followRequests: { type: Boolean, default: true },
  followApprovals: { type: Boolean, default: true },
  mentions: { type: Boolean, default: true },
});

const authSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  mobile: { type: String, unique: true },
  email: { type: String, unique: true },
  gender:{type:String,unique:true},
  otpVerified: { type: Boolean, default: false },
  accountStatus: {
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null }
  },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  followerRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  blockedFollowers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth.posts" }],
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
    default: () => ({})
  },
  approvedFollowers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Auth" }],
  posts: [postSchema],
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  recipient: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Auth", 
    required: true 
  },
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Auth", 
    required: true 
  },
  type: { 
    type: String, 
    enum: ["post", "follow", "like", "comment", "follow_request", "follow_approval", "mention"],
    required: true 
  },
  post: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Auth.posts" 
  },
  message: { 
    type: String, 
    required: true 
  },
  isRead: { 
    type: Boolean, 
    default: false 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Export only Auth model
const Auth = mongoose.model("Auth", authSchema);
const Notification = mongoose.model("Notification", notificationSchema);

module.exports = { Auth, Notification };