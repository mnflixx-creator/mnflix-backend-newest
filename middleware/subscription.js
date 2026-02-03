import User from "../models/User.js";
import Movie from "../models/Movie.js";
import { isFreePreview } from "../utils/isFreePreview.js";

const ALLOW_FREE_PREVIEW = process.env.ALLOW_FREE_PREVIEW === "true";

export default async function checkSubscription(req, res, next) {
  try {
    let movie = null;
    const movieId = req.params?.id || req.body?.movieId || req.query?.movieId;

    if (movieId) {
      movie = await Movie.findById(movieId).select("type seasons").lean();
    }

    // ✅ Allow free preview without subscription (ONLY if toggle is ON)
    if (ALLOW_FREE_PREVIEW && isFreePreview(req, movie)) {
      return next();
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();

    if (user.subscriptionExpiresAt && now > user.subscriptionExpiresAt) {
      user.subscriptionStatus = "expired";
      user.subscriptionActive = false;
      await user.save();
    }

    if (!user.subscriptionActive) {
      return res.status(403).json({
        message: "Subscription required",
        status: user.subscriptionStatus || "inactive",
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
}
