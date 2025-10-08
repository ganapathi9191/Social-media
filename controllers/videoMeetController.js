const VideoMeet = require("../models/videoMeetModel");
const { uploadImages } = require("../config/cloudinary");
const { Auth } = require("../models/authModel"); // import your Auth model


// Create a new video meeting
exports.createVideoMeet = async (req, res) => {
  try {
    const { title, host } = req.body;
    if (!title || !host) {
      return res.status(400).json({ success: false, message: "Title and host are required" });
    }

    const videoMeet = await VideoMeet.create({ title, host });
    res.status(201).json({ success: true, data: videoMeet });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all meetings
exports.getAllVideoMeets = async (req, res) => {
  try {
    const meets = await VideoMeet.find()
      .populate("host", "firstName lastName email")
      .populate("participants.user", "firstName lastName email")
      .populate("chat.sender", "firstName lastName email")
      .populate("sharedMedia.addedBy", "firstName lastName email");
     res.status(200).json({ success: true, data: meets });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get meeting by ID
exports.getVideoMeetById = async (req, res) => {
  try {
    const { meetid } = req.params; // meetid from URL
    const meet = await VideoMeet.findById(meetid) // use meetid here
      .populate("host", "firstName lastName email")
      .populate("participants.user", "firstName lastName email")
      .populate("chat.sender", "firstName lastName email")
      .populate("sharedMedia.addedBy", "firstName lastName email");

    if (!meet) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    res.status(200).json({ success: true, data: meet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Update meeting by ID
exports.updateVideoMeetById = async (req, res) => {
  try {
    const { meetid } = req.params;
    const updates = req.body;

    const meet = await VideoMeet.findByIdAndUpdate(meetid, updates, {
      new: true, // return updated document
      runValidators: true, // validate before saving
    })
      .populate("host", "firstName lastName email")
      .populate("participants.user", "firstName lastName email")
      .populate("chat.sender", "firstName lastName email")
      .populate("sharedMedia.addedBy", "firstName lastName email");

    if (!meet) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    res.status(200).json({ success: true, message: "Meeting updated successfully", data: meet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Delete meeting by ID
exports.deleteVideoMeetById = async (req, res) => {
  try {
    const { meetid } = req.params;
    const meet = await VideoMeet.findByIdAndDelete(meetid);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });
    res.status(200).json({ success: true, message: "Meeting deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Upload media to meeting
exports.uploadMedia = async (req, res) => {
  try {
    const { meetId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const fileUrl = await uploadImages(file.buffer, file.originalname);
    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    meet.chat.push({ sender: req.body.sender, media: [{ url: fileUrl, type: file.mimetype.split("/")[0] }] });
    await meet.save();

    res.status(200).json({ success: true, message: "File uploaded", data: fileUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Add chat message
exports.addChatMessage = async (req, res) => {
  try {
    const { meetId } = req.params;
    const { sender, message } = req.body;
    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });
    meet.chat.push({ sender, message });
    await meet.save();
    res.status(200).json({ success: true, message: "Message added", data: meet.chat });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get all chat messages by Meet ID (Read)
exports.getAllMessagesByMeetId = async (req, res) => {
  try {
    const { meetId } = req.params;

    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    res.status(200).json({ success: true, data: meet.chat });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Update chat message by messageId (Update)
exports.updateChatMessage = async (req, res) => {
  try {
    const { meetId, messageId } = req.params;
    const { message } = req.body;

    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    const chatMessage = meet.chat.id(messageId);
    if (!chatMessage) return res.status(404).json({ success: false, message: "Message not found" });

    chatMessage.message = message;
    chatMessage.updatedAt = new Date();

    await meet.save();

    res.status(200).json({ success: true, message: "Message updated", data: chatMessage });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ✅ Delete chat message by messageId (Delete)
exports.deleteChatMessage = async (req, res) => {
  try {
    const { meetId, messageId } = req.params;

    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    const chatMessage = meet.chat.id(messageId);
    if (!chatMessage) return res.status(404).json({ success: false, message: "Message not found" });

    chatMessage.remove();
    await meet.save();

    res.status(200).json({ success: true, message: "Message deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Start live screen share
exports.startScreenShare = async (req, res) => {
  try {
    const { meetId } = req.params;
    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    meet.screenShareActive = true;
    await meet.save();

    // Emit event to all participants via Socket.IO
    const io = req.app.get("io");
    io.to(meet.meetLink).emit("screenShareStarted", { meetId });

    res.status(200).json({ success: true, message: "Screen share started", data: meet.screenShareActive });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Stop live screen share
exports.stopScreenShare = async (req, res) => {
  try {
    const { meetId } = req.params;
    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    meet.screenShareActive = false;
    await meet.save();

    // Emit event to all participants via Socket.IO
    const io = req.app.get("io");
    io.to(meet.meetLink).emit("screenShareStopped", { meetId });

    res.status(200).json({ success: true, message: "Screen share stopped", data: meet.screenShareActive });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Invite participants
exports.inviteParticipants = async (req, res) => {
  try {
    const { meetId } = req.params;
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) return res.status(400).json({ success: false, message: "Provide an array of user IDs" });

    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    userIds.forEach(id => {
      if (!meet.participants.find(p => p.user.toString() === id)) {
        meet.participants.push({ user: id });
      }
    });
    await meet.save();
    res.status(200).json({ success: true, message: "Participants invited", data: meet.participants });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Add shared media (watch together) via Cloudinary
exports.addSharedMedia = async (req, res) => {
  try {
    const { meetId } = req.params;
    const { addedBy } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    // Upload file to Cloudinary
    const fileUrl = await uploadImages(req.file.buffer, req.file.originalname);

    // Find meeting
    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    // Add shared media
    meet.sharedMedia.push({
      url: fileUrl,
      type: req.file.mimetype.startsWith("video") ? "video" : "pdf",
      addedBy,
      playbackPosition: 0
    });

    await meet.save();

    res.status(200).json({
      success: true,
      message: "Shared media added",
      data: meet.sharedMedia
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update playback position (no changes needed)
exports.updatePlaybackPosition = async (req, res) => {
  try {
    const { meetId, mediaId } = req.params;
    const { position } = req.body;

    const meet = await VideoMeet.findById(meetId);
    if (!meet) return res.status(404).json({ success: false, message: "Meeting not found" });

    const media = meet.sharedMedia.id(mediaId);
    if (!media) return res.status(404).json({ success: false, message: "Media not found" });

    media.playbackPosition = position;
    await meet.save();

    res.status(200).json({ success: true, message: "Playback updated", data: media });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};