const mongoose = require("mongoose");

// FAQ subdocument
const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }]
}, { _id: true }); // ensures each FAQ has _id

// Media subdocument (optional, can remove if not needed)
const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ["image", "video", "pdf"], required: true }
});

// Campaign model
const campaignSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    media: [mediaSchema], // remove if you don't want media
    faqs: [faqSchema]
  },
  { timestamps: true }
);

// Form Fill model
const formFillSchema = new mongoose.Schema(
{ campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    email: { type: String, required: true },
    mobileNumber: { type: String, required: true },
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
const FormFill = mongoose.model("FormFill", formFillSchema);

module.exports = { Campaign, FormFill };
