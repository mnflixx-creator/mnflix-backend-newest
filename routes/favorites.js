import debug from "../utils/debug.js";
import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

router.post("/add", authMiddleware, async (req, res) => {
  const { movieId } = req.body;

  await User.findByIdAndUpdate(req.user.id, {
    $addToSet: { favorites: movieId }
  });

  res.json({ message: "Added to favorites" });
});

router.post("/remove", authMiddleware, async (req, res) => {
  try {
    const { movieId } = req.body;

    debug.log("REMOVE REQUEST RECEIVED");
    debug.log("User ID:", req.user.id);
    debug.log("Movie ID:", movieId);

    const userBefore = await User.findById(req.user.id);
    debug.log("BEFORE REMOVE:", userBefore.favorites);

    const result = await User.updateOne(
      { _id: req.user.id },
      { $pull: { favorites: new mongoose.Types.ObjectId(movieId) } }
    );

    debug.log("UPDATE RESULT:", result);

    const userAfter = await User.findById(req.user.id);
    debug.log("AFTER REMOVE:", userAfter.favorites);

    res.json({ success: true });
  } catch (err) {
    console.error("Favorite remove error:", err);
    res.status(500).json({ message: "Remove failed" });
  }
});

router.get("/list", authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).populate("favorites");
  res.json(user.favorites);
});

export default router;
