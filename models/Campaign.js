const mongoose = require("mongoose");

// FAQ subdocument with answer validation
const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  answer: { type: String, required: true } // Correct answer for validation
}, { _id: true });

// Media subdocument
const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ["image", "video", "pdf"], required: true }
});

// Campaign model - linked to user
const campaignSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    link: { type: String },
    media: [mediaSchema],
    faqs: [faqSchema], // Optional FAQs with answers
    isActive: { type: Boolean, default: false }, // Inactive until admin pushes
    isPushedByAdmin: { type: Boolean, default: false }, // Admin control
    adminApprovalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },
    adminNotes: { type: String },
    purchasedPackage: {
      packageId: { type: mongoose.Schema.Types.ObjectId, ref: "CampaignPackage" },
      packageName: String,
      price: Number,
      durationHours: Number,
      postsInterval: Number,
      targetUsers: Number,
      content: [{ type: String }],
      purchaseDate: Date,
      expiresAt: Date,
      razorpayOrderId: String,
      razorpayPaymentId: String,
      paymentStatus: { 
        type: String, 
        enum: ["pending", "completed", "failed"], 
        default: "pending" 
      }
    },
    stats: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      faqAttempts: { type: Number, default: 0 },
      faqCompletions: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

// Campaign Package Model (Admin side)
const campaignPackageSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: true,
      enum: ["Basic", "Standard", "Premium", "Enterprise"]
    },
    description: String,
    price: { type: Number, required: true },
    durationHours: { type: Number, required: true },
    postsInterval: { 
      type: Number, 
      required: true,
      default: 10
    },
    targetUsers: { 
      type: Number, 
      required: true,
      min: 100,
      max: 100000
    },
    content: [{ 
      type: String, 
      required: true 
    }],
    isActive: { type: Boolean, default: true },
    features: [String],
    priority: { type: Number, default: 1 }
  },
  { timestamps: true }
);

// FAQ Response model - track user interactions with FAQs
const faqResponseSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    userEmail: { type: String, required: true }, // Changed from userId to email for non-authenticated users
    userName: { type: String },
    answers: [
      {
        questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
        questionText: String,
        selectedOption: String,
        correctOption: String,
        isCorrect: Boolean
      }
    ],
    completedAt: Date,
    score: Number,
    totalQuestions: Number
  },
  { timestamps: true }
);

// Form Fill model - for lead generation
const formFillSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    email: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    fullName: { type: String },
    answers: [
      {
        questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
        questionText: String,
        selectedOption: String
      }
    ]
  },
  { timestamps: true }
);

const Campaign = mongoose.model("Campaign", campaignSchema);
const CampaignPackage = mongoose.model("CampaignPackage", campaignPackageSchema);
const FAQResponse = mongoose.model("FAQResponse", faqResponseSchema);
const FormFill = mongoose.model("FormFill", formFillSchema);

module.exports = { Campaign, CampaignPackage, FAQResponse, FormFill };