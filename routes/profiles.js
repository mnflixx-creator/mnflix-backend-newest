import debug from "../utils/debug.js";

import express from "express";
import authMiddleware from "../middleware/auth.js";
import User from "../models/User.js";

const router = express.Router();

// Create profile
router.post("/create", authMiddleware, async (req, res) => {
  try {
    const { name, avatar, kids } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profiles.push({ name, avatar, kids });
    await user.save();

    res.json({ message: "Profile created", profiles: user.profiles });
  } catch (err) {
    debug.log("Profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Set active profile
router.post("/switch", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const profile = user.profiles.find((p) => p.name === name);
    if (!profile) return res.status(400).json({ message: "Profile not found" });

    user.currentProfile = {
      name: profile.name,
      avatar: profile.avatar,
    };

    await user.save();

    res.json({ message: "Switched", currentProfile: user.currentProfile });
  } catch (err) {
    debug.log("Switch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all profiles
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ profiles: user.profiles });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get current profile
router.get("/current", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ currentProfile: user.currentProfile });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/delete", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const user = await User.findById(req.user.id);

    user.profiles = user.profiles.filter(p => p.name !== name);

    // If deleting active profile → clear current
    if (user.currentProfile?.name === name) {
      user.currentProfile = null;
    }

    await user.save();

    res.json({ message: "Profile deleted", profiles: user.profiles });
  } catch (err) {
    debug.log("Delete error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/edit", authMiddleware, async (req, res) => {
  try {
    const { oldName, newName, avatar } = req.body;

    const user = await User.findById(req.user.id);

    const profile = user.profiles.find(p => p.name === oldName);
    if (!profile) return res.status(400).json({ message: "Profile not found" });

    profile.name = newName || profile.name;
    profile.avatar = avatar || profile.avatar;

    await user.save();

    res.json({ message: "Profile updated", profiles: user.profiles });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
