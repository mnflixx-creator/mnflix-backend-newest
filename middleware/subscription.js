import User from "../models/User.js";
import Movie from "../models/Movie.js"; // ✅ ADD THIS
import { isFreePreview } from "../utils/isFreePreview.js";

export default async function checkSubscription(req, res, next) {
  try {
    // ✅ Try to load movie ONLY if route has :id (like /api/movies/:id/stream)
    // If not found, it still falls back to old behavior safely.
    let movie = null;
    const movieId = req.params?.id || req.body?.movieId || req.query?.movieId;

    if (movieId) {
      movie = await Movie.findById(movieId).select("type seasons").lean();
    }

    // ✅ Allow free preview without subscription
    if (isFreePreview(req, movie)) {
      return next();
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();

    // auto-expire subscription
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
