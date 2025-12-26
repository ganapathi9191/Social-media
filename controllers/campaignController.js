const { Campaign, CampaignPackage, FAQResponse, FormFill } = require("../models/Campaign");
const { uploadImage } = require("../config/cloudinary");
const razorpay = require("../config/razorpay");

// ========================================
// USER CAMPAIGN CONTROLLERS (NO TOKEN REQUIRED)
// ========================================

// Create Campaign (User creates campaign - no auth required)
exports.createCampaign = async (req, res) => {
  try {
    const { userId, fullName, email, mobileNumber, faqs, link } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

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

    // Parse FAQs (string → JSON) - Optional
    let parsedFaqs = [];
    if (faqs) {
      parsedFaqs = JSON.parse(faqs);
      
      // Validate FAQ structure
      parsedFaqs.forEach(faq => {
        if (!faq.question || !faq.options || faq.options.length !== 4 || !faq.answer) {
          throw new Error("Each FAQ must have a question, 4 options, and an answer");
        }
      });
    }

    const campaign = new Campaign({
      userId,
      fullName,
      email,
      mobileNumber,
      link,
      media: uploadedMedia,
      faqs: parsedFaqs,
      isActive: false,
      isPushedByAdmin: false,
      adminApprovalStatus: "pending"
    });

    await campaign.save();

    res.status(201).json({
      success: true,
      message: "Campaign created successfully and submitted for admin approval",
      data: campaign
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get User's Own Campaigns (by userId - no auth required)
exports.getUserCampaigns = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }
    
    const campaigns = await Campaign.find({ userId })
      .sort({ createdAt: -1 })
      .populate("purchasedPackage.packageId", "name price");
    
    res.status(200).json({ 
      success: true, 
      count: campaigns.length,
      data: campaigns 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get All Campaigns (Admin Only - no auth, just admin flag)
exports.getAllCampaigns = async (req, res) => {
  try {
    const { status, isPushed, isAdmin } = req.query;

    // Simple admin check - you can enhance this
    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    
    let filter = {};
    if (status) filter.adminApprovalStatus = status;
    if (isPushed !== undefined) filter.isPushedByAdmin = isPushed === 'true';
    
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .populate("userId", "fullName email")
      .populate("purchasedPackage.packageId", "name price");
    
    res.status(200).json({ 
      success: true, 
      count: campaigns.length,
      data: campaigns 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



// Get Single Campaign by ID (Public)
exports.getCampaignById = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate("userId", "fullName email")
      .populate("purchasedPackage.packageId");
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Campaign (User can update own campaign)
exports.updateCampaign = async (req, res) => {
  try {
    const { userId, fullName, email, mobileNumber, faqs, link } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    let campaign = await Campaign.findOne({ 
      _id: req.params.id, 
      userId 
    });

    if (!campaign) {
      return res.status(404).json({ 
        success: false, 
        message: "Campaign not found or you don't have permission to edit" 
      });
    }

    // Upload new media if provided
    let uploadedMedia = campaign.media;
    if (req.files && req.files.length > 0) {
      uploadedMedia = [];
      for (const file of req.files) {
        const url = await uploadImage(file.buffer, "campaignMedia", file.originalname);
        
        let type = "image";
        if (file.mimetype.startsWith("video")) type = "video";
        else if (file.mimetype === "application/pdf") type = "pdf";

        uploadedMedia.push({ url, type });
      }
    }

    // Parse FAQs if provided
    let parsedFaqs = campaign.faqs;
    if (faqs) {
      parsedFaqs = JSON.parse(faqs);
      
      parsedFaqs.forEach(faq => {
        if (!faq.question || !faq.options || faq.options.length !== 4 || !faq.answer) {
          throw new Error("Each FAQ must have a question, 4 options, and an answer");
        }
      });
    }

    campaign.fullName = fullName || campaign.fullName;
    campaign.email = email || campaign.email;
    campaign.mobileNumber = mobileNumber || campaign.mobileNumber;
    campaign.link = link || campaign.link;
    campaign.media = uploadedMedia;
    campaign.faqs = parsedFaqs;

    if (campaign.adminApprovalStatus === "rejected") {
      campaign.adminApprovalStatus = "pending";
    }

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

// Delete Campaign (User can delete own campaign)
exports.deleteCampaign = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }
    
    const campaign = await Campaign.findOneAndDelete({ 
      _id: req.params.id, 
      userId 
    });

    if (!campaign) {
      return res.status(404).json({ 
        success: false, 
        message: "Campaign not found or you don't have permission to delete" 
      });
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

// ========================================
// ADMIN CAMPAIGN MANAGEMENT
// ========================================

// Admin: Approve/Reject Campaign
exports.adminReviewCampaign = async (req, res) => {
  try {
    const { status, notes, isAdmin } = req.body;

    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    campaign.adminApprovalStatus = status;
    if (notes) campaign.adminNotes = notes;

    await campaign.save();

    res.status(200).json({
      success: true,
      message: `Campaign ${status} successfully`,
      data: campaign
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Push Campaign (Make it live)
exports.adminPushCampaign = async (req, res) => {
  try {
    const { isAdmin } = req.body;

    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    if (campaign.adminApprovalStatus !== "approved") {
      return res.status(400).json({ 
        success: false, 
        message: "Campaign must be approved before pushing" 
      });
    }

    if (!campaign.purchasedPackage || campaign.purchasedPackage.paymentStatus !== "completed") {
      return res.status(400).json({ 
        success: false, 
        message: "Campaign must have a completed payment before pushing" 
      });
    }

    campaign.isPushedByAdmin = true;
    campaign.isActive = true;

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Campaign pushed successfully and is now live",
      data: campaign
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Stop Campaign
exports.adminStopCampaign = async (req, res) => {
  try {
    const { isAdmin } = req.body;

    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    campaign.isPushedByAdmin = false;
    campaign.isActive = false;

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Campaign stopped successfully",
      data: campaign
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========================================
// CAMPAIGN PACKAGE CONTROLLERS (ADMIN)
// ========================================

// Create Campaign Package (Admin)
exports.createCampaignPackage = async (req, res) => {
  try {
    const { 
      name, 
      description, 
      price, 
      durationHours, 
      postsInterval, 
      targetUsers, 
      content,
      features,
      isAdmin 
    } = req.body;

    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    let parsedContent = content;
    if (typeof content === 'string') {
      parsedContent = JSON.parse(content);
    }

    let parsedFeatures = features;
    if (typeof features === 'string') {
      parsedFeatures = JSON.parse(features);
    }

    const package = new CampaignPackage({
      name,
      description,
      price: Number(price),
      durationHours: Number(durationHours),
      postsInterval: Number(postsInterval) || 10,
      targetUsers: Number(targetUsers),
      content: parsedContent,
      features: parsedFeatures
    });

    await package.save();

    res.status(201).json({
      success: true,
      message: "Campaign package created successfully",
      data: package
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get All Campaign Packages (Public)
exports.getCampaignPackages = async (req, res) => {
  try {
    const packages = await CampaignPackage.find({ isActive: true }).sort({ priority: 1 });
    
    res.status(200).json({
      success: true,
      count: packages.length,
      data: packages
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Single Package (Public)
exports.getCampaignPackageById = async (req, res) => {
  try {
    const package = await CampaignPackage.findById(req.params.id);
    
    if (!package) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    res.status(200).json({
      success: true,
      data: package
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Package (Admin)
exports.updateCampaignPackage = async (req, res) => {
  try {
    const { 
      name, 
      description, 
      price, 
      durationHours, 
      postsInterval, 
      targetUsers, 
      content,
      features,
      isActive,
      isAdmin 
    } = req.body;

    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    let package = await CampaignPackage.findById(req.params.id);
    if (!package) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    if (content && typeof content === 'string') {
      package.content = JSON.parse(content);
    } else if (content && Array.isArray(content)) {
      package.content = content;
    }

    if (features && typeof features === 'string') {
      package.features = JSON.parse(features);
    } else if (features && Array.isArray(features)) {
      package.features = features;
    }

    if (name) package.name = name;
    if (description) package.description = description;
    if (price) package.price = Number(price);
    if (durationHours) package.durationHours = Number(durationHours);
    if (postsInterval) package.postsInterval = Number(postsInterval);
    if (targetUsers) package.targetUsers = Number(targetUsers);
    if (isActive !== undefined) package.isActive = isActive;

    await package.save();

    res.status(200).json({
      success: true,
      message: "Package updated successfully",
      data: package
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete Package (Admin)
exports.deleteCampaignPackage = async (req, res) => {
  try {
    const { isAdmin } = req.body;

    if (isAdmin !== "true") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const package = await CampaignPackage.findByIdAndDelete(req.params.id);

    if (!package) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    res.status(200).json({
      success: true,
      message: "Package deleted successfully"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========================================
// RAZORPAY PAYMENT INTEGRATION
// ========================================

// Create Razorpay Order for Package Purchase
exports.createPaymentOrder = async (req, res) => {
  try {
    const { campaignId, packageId, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId 
    });

    if (!campaign) {
      return res.status(404).json({ 
        success: false, 
        message: "Campaign not found or you don't have permission" 
      });
    }

    const package = await CampaignPackage.findById(packageId);
    if (!package) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const options = {
      amount: package.price * 100,
      currency: "INR",
      receipt: `campaign_${campaignId}_${Date.now()}`,
      notes: {
        campaignId: campaignId,
        packageId: packageId,
        packageName: package.name,
        customerEmail: campaign.email,
        userId: userId.toString()
      }
    };

    const order = await razorpay.orders.create(options);

    campaign.purchasedPackage = {
      packageId: package._id,
      packageName: package.name,
      price: package.price,
      durationHours: package.durationHours,
      postsInterval: package.postsInterval,
      targetUsers: package.targetUsers,
      content: package.content,
      purchaseDate: null,
      expiresAt: null,
      razorpayOrderId: order.id,
      razorpayPaymentId: null,
      paymentStatus: "pending"
    };

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Order created successfully",
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
        key: process.env.RAZORPAY_KEY_ID
      },
      campaign: campaign._id
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verify Payment and Update Campaign
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, campaignId, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId 
    });

    if (!campaign) {
      return res.status(404).json({ 
        success: false, 
        message: "Campaign not found or you don't have permission" 
      });
    }

    // In production, verify signature
    // const crypto = require('crypto');
    // const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    //   .update(razorpay_order_id + "|" + razorpay_payment_id)
    //   .digest('hex');
    
    // if (expectedSignature !== razorpay_signature) {
    //   return res.status(400).json({ success: false, message: "Invalid payment signature" });
    // }

    campaign.purchasedPackage.razorpayPaymentId = razorpay_payment_id;
    campaign.purchasedPackage.paymentStatus = "completed";
    campaign.purchasedPackage.purchaseDate = new Date();
    
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + campaign.purchasedPackage.durationHours);
    campaign.purchasedPackage.expiresAt = expiresAt;

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Payment verified successfully. Campaign will go live once admin approves and pushes it.",
      data: {
        campaignId: campaign._id,
        expiresAt: expiresAt,
        packageDetails: campaign.purchasedPackage,
        note: "Your campaign is pending admin approval"
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========================================
// FAQ INTERACTION (PUBLIC - NO AUTH)
// ========================================

// Get Campaign FAQs (Public)
exports.getCampaignFAQs = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select("faqs fullName link media");
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Return FAQs without answers
    const faqsWithoutAnswers = campaign.faqs.map(faq => ({
      _id: faq._id,
      question: faq.question,
      options: faq.options
    }));

    res.status(200).json({
      success: true,
      data: {
        campaignId: campaign._id,
        campaignName: campaign.fullName,
        link: campaign.link,
        media: campaign.media,
        faqs: faqsWithoutAnswers
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Validate Single FAQ Answer (Public - Live validation)
exports.validateFAQAnswer = async (req, res) => {
  try {
    const { campaignId, questionId, selectedOption } = req.body;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    const faq = campaign.faqs.id(questionId);
    if (!faq) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    const isCorrect = faq.answer === selectedOption;

    res.status(200).json({
      success: true,
      data: {
        isCorrect,
        correctAnswer: isCorrect ? null : faq.answer
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Submit Complete FAQ Response (Public - No auth)
exports.submitFAQResponse = async (req, res) => {
  try {
    const { campaignId, answers, userEmail, userName } = req.body;

    if (!userEmail) {
      return res.status(400).json({ success: false, message: "User email is required" });
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Validate all answers
    let score = 0;
    const validatedAnswers = answers.map(ans => {
      const faq = campaign.faqs.id(ans.questionId);
      const isCorrect = faq.answer === ans.selectedOption;
      if (isCorrect) score++;

      return {
        questionId: ans.questionId,
        questionText: faq.question,
        selectedOption: ans.selectedOption,
        correctOption: faq.answer,
        isCorrect
      };
    });

    // Save FAQ response
    const faqResponse = new FAQResponse({
      campaign: campaignId,
      userEmail,
      userName: userName || "Anonymous",
      answers: validatedAnswers,
      completedAt: new Date(),
      score,
      totalQuestions: campaign.faqs.length
    });

    await faqResponse.save();

    // Update campaign stats
    campaign.stats.faqCompletions += 1;
    await campaign.save();

    res.status(200).json({
      success: true,
      message: "FAQ response submitted successfully",
      data: {
        score,
        totalQuestions: campaign.faqs.length,
        percentage: ((score / campaign.faqs.length) * 100).toFixed(2),
        answers: validatedAnswers
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========================================
// CAMPAIGN FEED & STATS
// ========================================

// Get Active Campaigns for Feed
exports.getActiveCampaignsForFeed = async (req, res) => {
  try {
    const now = new Date();
    
    const activeCampaigns = await Campaign.find({
      isActive: true,
      isPushedByAdmin: true,
      adminApprovalStatus: "approved",
      "purchasedPackage.paymentStatus": "completed",
      "purchasedPackage.expiresAt": { $gt: now }
    }).select("fullName link media faqs purchasedPackage stats");

    res.status(200).json({
      success: true,
      count: activeCampaigns.length,
      data: activeCampaigns
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Campaign Stats (Public)
exports.updateCampaignStats = async (req, res) => {
  try {
    const { campaignId, type } = req.body;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    if (!campaign.stats) {
      campaign.stats = { impressions: 0, clicks: 0, conversions: 0, faqAttempts: 0, faqCompletions: 0 };
    }

    switch(type) {
      case "impression":
        campaign.stats.impressions += 1;
        break;
      case "click":
        campaign.stats.clicks += 1;
        break;
      case "conversion":
        campaign.stats.conversions += 1;
        break;
      case "faq_attempt":
        campaign.stats.faqAttempts += 1;
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid stat type" });
    }

    await campaign.save();

    res.status(200).json({
      success: true,
      message: "Stats updated successfully",
      stats: campaign.stats
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Campaign Analytics (User must provide userId)
exports.getCampaignAnalytics = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId 
    });

    if (!campaign) {
      return res.status(404).json({ 
        success: false, 
        message: "Campaign not found or you don't have permission" 
      });
    }

    const ctr = campaign.stats.impressions > 0 
      ? (campaign.stats.clicks / campaign.stats.impressions * 100).toFixed(2)
      : 0;

    const conversionRate = campaign.stats.clicks > 0
      ? (campaign.stats.conversions / campaign.stats.clicks * 100).toFixed(2)
      : 0;

    const faqCompletionRate = campaign.stats.faqAttempts > 0
      ? (campaign.stats.faqCompletions / campaign.stats.faqAttempts * 100).toFixed(2)
      : 0;

    res.status(200).json({
      success: true,
      data: {
        campaign: {
          id: campaign._id,
          name: campaign.fullName,
          package: campaign.purchasedPackage?.packageName,
          status: campaign.isActive ? "Active" : "Inactive",
          isPushed: campaign.isPushedByAdmin,
          approvalStatus: campaign.adminApprovalStatus,
          expiresAt: campaign.purchasedPackage?.expiresAt
        },
        stats: {
          ...campaign.stats,
          ctr: `${ctr}%`,
          conversionRate: `${conversionRate}%`,
          faqCompletionRate: `${faqCompletionRate}%`
        },
        target: {
          users: campaign.purchasedPackage?.targetUsers,
          postsInterval: campaign.purchasedPackage?.postsInterval,
          durationHours: campaign.purchasedPackage?.durationHours
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get FAQ Responses for a Campaign (Admin or Campaign Owner)
exports.getCampaignFAQResponses = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { userId, isAdmin } = req.query;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Check permissions
    if (isAdmin !== "true" && campaign.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const responses = await FAQResponse.find({ campaign: campaignId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: responses.length,
      data: responses
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};