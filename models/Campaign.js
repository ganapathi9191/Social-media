const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }], // Four options per question
});

const campaignSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    images: [{ type: String }], // Array of Cloudinary URLs
    faqs: [faqSchema],          // Array of Q&A with options
  },
  { timestamps: true }
);

module.exports = mongoose.model("Campaign", campaignSchema);
