const Campaign = require("../models/Campaign");
const { uploadImage } = require("../config/cloudinary"); // Your cloudinary utils

// Create Campaign
exports.createCampaign = async (req, res) => {
  try {
    const { fullName, email, mobileNumber, faqs } = req.body;

    // Upload media files to Cloudinary
    let uploadedMedia = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "campaignMedia", file.originalname);

        let type = "image";
        if (file.mimetype.startsWith("video")) type = "video";
        else if (file.mimetype === "application/pdf") type = "pdf";

        uploadedMedia.push({ url, type });
      }
    }

    // Parse FAQs (string → JSON)
    let parsedFaqs = [];
    if (faqs) parsedFaqs = JSON.parse(faqs);

    const campaign = new Campaign({
      fullName,
      email,
      mobileNumber,
      media: uploadedMedia,
      faqs: parsedFaqs
    });

    await campaign.save();

    res.status(201).json({
      success: true,
      message: "Form submitted successfully",
      data: campaign
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Get All Campaigns
exports.getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find();
    res.status(200).json({ success: true, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Single Campaign by ID
exports.getCampaignById = async (req, res) => {
   try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Form not found" });

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Update Campaign
exports.updateCampaign = async (req, res) => {
  try {
    const { fullName, email, mobileNumber, faqs } = req.body;

    // Find existing campaign
    let campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Upload new images if provided
    let uploadedImages = campaign.images;
    if (req.files && req.files.length > 0) {
      uploadedImages = [];
      for (const file of req.files) {
        const imageUrl = await uploadImage(file.buffer, "campaignImages", file.originalname);
        uploadedImages.push(imageUrl);
      }
    }

    // Parse faqs if provided
    let parsedFaqs = campaign.faqs;
    if (faqs) {
      parsedFaqs = JSON.parse(faqs);
    }

    // Update fields
    campaign.fullName = fullName || campaign.fullName;
    campaign.email = email || campaign.email;
    campaign.mobileNumber = mobileNumber || campaign.mobileNumber;
    campaign.images = uploadedImages;
    campaign.faqs = parsedFaqs;

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Campaign updated successfully",
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



// Delete Campaign
exports.deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    res.status(200).json({
      success: true,
      message: "Campaign deleted successfully",
      data: campaign,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
