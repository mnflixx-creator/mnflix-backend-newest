import debug from "../utils/debug.js";
import express from "express";
import authMiddleware from "../middleware/auth.js";
import Progress from "../models/Progress.js";

const router = express.Router();

/* ✅ SAVE / UPDATE PROGRESS (MOVIE + SERIES) */
router.post("/save", authMiddleware, async (req, res) => {
  try {
    const { movieId, season, episode, currentTime, duration } = req.body;

    let progress = await Progress.findOne({
      userId: req.user.id,
      movieId,
      season: season ?? null,
      episode: episode ?? null
    });

    if (!progress) {
      progress = new Progress({
        userId: req.user.id,
        movieId,
        season: season ?? null,
        episode: episode ?? null
      });
    }

    progress.currentTime = currentTime;
    progress.duration = duration;

    if (duration > 0 && currentTime / duration > 0.9) {
      progress.completed = true;
    }

    await progress.save();
    res.json({ success: true });
  } catch (err) {
    debug.log("Save progress error:", err);
    res.status(500).json({ message: "Progress save failed" });
  }
});

/* ✅ CONTINUE WATCHING (MOVIES + SERIES) */
router.get("/continue", authMiddleware, async (req, res) => {
  try {
    const list = await Progress.find({
      userId: req.user.id,
      completed: false
    })
      .populate("movieId")
      .sort({ updatedAt: -1 })
      .limit(20);

    res.json(list);
  } catch (err) {
    debug.log("Continue fetch error:", err);
    res.status(500).json({ message: "Continue fetch failed" });
  }
});

// ✅ SAVE CONTINUE WATCHING (SIMPLE – NO TIME)
router.post("/save-open", authMiddleware, async (req, res) => {
  try {
    const { movieId } = req.body;

    // ✅ DELETE OLD DUPLICATES FIRST
    await Progress.deleteMany({
      userId: req.user.id,
      movieId
    });

    // ✅ INSERT ONE CLEAN RECORD
    await Progress.create({
      userId: req.user.id,
      movieId,
      completed: false,
      updatedAt: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    debug.log("Save-open error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

import mongoose from "mongoose";

router.delete("/delete/:movieId", authMiddleware, async (req, res) => {
  try {
    const { movieId } = req.params;

    debug.log("🧨 DELETE CONTINUE WATCHING");
    debug.log("User:", req.user.id);
    debug.log("Movie:", movieId);

    const result = await Progress.deleteMany({
      userId: req.user.id,
      movieId: new mongoose.Types.ObjectId(movieId),
    });

    debug.log("✅ DELETE RESULT:", result);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE CONTINUE ERROR:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

export default router;
