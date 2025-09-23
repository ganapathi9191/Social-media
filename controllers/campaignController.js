const {Campaign,FormFill} = require("../models/Campaign");
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


// Submit Form
exports.submitForm = async (req, res) => {
  try {
    const { campaignId, email, mobileNumber, answers } = req.body;

    // 1️⃣ Fetch campaign
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // 2️⃣ Validate answers against campaign FAQs
    const validatedAnswers = answers.map((answer) => {
      const campaignFaq = campaign.faqs.find(f => f._id.toString() === answer.questionId);
      if (!campaignFaq) throw new Error(`Question ID "${answer.questionId}" does not exist in campaign`);
      if (!campaignFaq.options.includes(answer.selectedOption))
        throw new Error(`Option "${answer.selectedOption}" is invalid for question "${campaignFaq.question}"`);

      return {
        questionId: campaignFaq._id,
        questionText: campaignFaq.question,
        selectedOption: answer.selectedOption
      };
    });

    // 3️⃣ Create and save form fill
    const formFill = new FormFill({
      campaign: campaignId,
      email,
      mobileNumber,
      answers: validatedAnswers
    });

    await formFill.save();

    res.status(201).json({
      success: true,
      message: "Form submitted successfully",
      data: formFill
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get all form fills
exports.getAllFormFills = async (req, res) => {
  try {
    const forms = await FormFill.find().populate("campaign");
    res.status(200).json({ success: true, data: forms });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single form fill by ID
exports.getFormFillById = async (req, res) => {
  try {
    const form = await FormFill.findById(req.params.id).populate("campaign");
    if (!form) return res.status(404).json({ success: false, message: "Form not found" });

    res.status(200).json({ success: true, data: form });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update form fill by ID
exports.updateFormFillById = async (req, res) => {
  try {
    const { email, mobileNumber, answers } = req.body;

    const form = await FormFill.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Form not found" });

    // Optional: Validate answers against campaign FAQs
    let validatedAnswers = form.answers;
    if (answers && answers.length > 0) {
      const campaign = await Campaign.findById(form.campaign);
      if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

      validatedAnswers = answers.map((answer) => {
        const campaignFaq = campaign.faqs.find(f => f._id.toString() === answer.questionId);
        if (!campaignFaq) throw new Error(`Question ID "${answer.questionId}" does not exist in campaign`);
        if (!campaignFaq.options.includes(answer.selectedOption))
          throw new Error(`Option "${answer.selectedOption}" is invalid for question "${campaignFaq.question}"`);

        return {
          questionId: campaignFaq._id,
          questionText: campaignFaq.question,
          selectedOption: answer.selectedOption
        };
      });
    }

    // Update fields
    form.email = email || form.email;
    form.mobileNumber = mobileNumber || form.mobileNumber;
    form.answers = validatedAnswers;

    await form.save();

    res.status(200).json({ success: true, message: "Form updated successfully", data: form });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete form fill by ID
exports.deleteFormFillById = async (req, res) => {
  try {
    const form = await FormFill.findByIdAndDelete(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Form not found" });

    res.status(200).json({ success: true, message: "Form deleted successfully", data: form });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};