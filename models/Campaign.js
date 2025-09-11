const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }]
});

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ["image", "video", "pdf"], required: true }
});

const campaignSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    media: [mediaSchema],
    faqs: [faqSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Campaign", campaignSchema);
