const VideoMeet = require("../models/videoMeetModel");
const { v4: uuidv4 } = require("uuid");
const { uploadImages } = require("../config/cloudinary");

// Create Meeting
exports.createVideoMeet = async (req, res) => {
   try {
    const { title, host } = req.body;

    if (!title || !host) {
      return res.status(400).json({ success: false, message: "Title and host required" });
    }

    const meetLink = uuidv4(); // generate unique UUID

    const meet = new VideoMeet({
      title,
      host,
      meetLink,
    });

    await meet.save();

    const fullMeetLink = `${process.env.MEET_DOMAIN}/meet/${meetLink}`;

    return res.status(201).json({
      success: true,
      data: {
        id: meet._id,
        title: meet.title,
        host: meet.host,
        meetingLink: fullMeetLink,
      },
    });
  } catch (error) {
    console.error("❌ Error creating meet:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
// Get Meeting by link
exports.getMeetByLink = async (req, res) => {
  try {
    let { meetLink } = req.params;

    // Clean the meetLink (in case frontend sends full URL)
    if (meetLink.includes("/")) {
      meetLink = meetLink.split("/").pop();
    }

    // Find by meetLink (UUID stored in DB)
    const meet = await VideoMeet.findOne({ meetLink: meetLink.trim() });

    if (!meet) {
      return res.status(404).json({
        success: false,
        message: `Meeting not found for link: ${meetLink}`
      });
    }

    // Return with full URL
    const fullMeetLink = `${process.env.MEET_DOMAIN}/meet/${meet.meetLink}`;

    return res.status(200).json({
      success: true,
      data: {
        id: meet._id,
        title: meet.title,
        host: meet.host,
        meetingLink: fullMeetLink,
        createdAt: meet.createdAt
      }
    });

  } catch (error) {
    console.error("❌ Error fetching meeting:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update Meeting title
exports.updateMeet = async (req, res) => {
  try {
    const meetLink = normalizeMeetLink(req.params.meetLink);

    const meet = await VideoMeet.findOneAndUpdate(
      { meetLink },
      { isActive: false, endedAt: new Date() },
      { new: true }
    );

    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    res.status(200).json({ success: true, message: "Meeting ended", data: meet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// End Meeting
exports.endMeeting = async (req, res) => {
  try {
    const { meetLink } = req.params;
    const meet = await VideoMeet.findOneAndUpdate({ meetLink }, { isActive: false, endedAt: new Date() }, { new: true });
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });
    res.status(200).json({ success: true, message: "Meeting ended", data: meet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Add participant
exports.addParticipant = async (req, res) => {
  try {
    const meetLink = normalizeMeetLink(req.params.meetLink);
    const { userId } = req.body;

    const meet = await VideoMeet.findOne({ meetLink });
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    const exists = meet.participants.find((p) => p.user.toString() === userId);
    if (!exists) meet.participants.push({ user: userId });

    await meet.save();
    res.status(200).json({ success: true, participants: meet.participants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Remove participant
exports.removeParticipant = async (req, res) => {
 try {
    const meetLink = normalizeMeetLink(req.params.meetLink);
    const { userId } = req.body;

    const meet = await VideoMeet.findOne({ meetLink });
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    meet.participants = meet.participants.filter((p) => p.user.toString() !== userId);

    await meet.save();
    res.status(200).json({ success: true, participants: meet.participants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// Pin / Unpin participant
exports.pinParticipant = async (req, res) => {
  try {
    const meetLink = normalizeMeetLink(req.params.meetLink);
    const { userId, pin } = req.body;

    const meet = await VideoMeet.findOne({ meetLink });
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    const participant = meet.participants.find((p) => p.user.toString() === userId);
    if (participant) participant.isPinned = pin;

    await meet.save();
    res.status(200).json({ success: true, participants: meet.participants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Add Chat message (with optional media)
exports.addChatMessage = async (req, res) => {
  try {
    const meetLink = normalizeMeetLink(req.params.meetLink);
    const { sender, message } = req.body;

    const meet = await VideoMeet.findOne({ meetLink });
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImages(file.buffer, file.originalname);
        const type = file.mimetype.startsWith("image/")
          ? "image"
          : file.mimetype.startsWith("video/")
          ? "video"
          : "file";
        mediaUrls.push({ url, type });
      }
    }

    meet.chat.push({ sender, message, media: mediaUrls });
    await meet.save();

    res.status(200).json({ success: true, chat: meet.chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// Delete chat message
exports.deleteChatMessage = async (req, res) => {
   try {
    const meetLink = normalizeMeetLink(req.params.meetLink);
    const { chatId } = req.params;

    const meet = await VideoMeet.findOne({ meetLink });
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    meet.chat = meet.chat.filter((c) => c._id.toString() !== chatId);

    await meet.save();
    res.status(200).json({ success: true, chat: meet.chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};