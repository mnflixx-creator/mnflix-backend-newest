import User from "../models/User.js";

export default async function checkSubscription(req, res, next) {
  try {
    // authMiddleware should already put user id on req.user.id
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const now = new Date();

    const isActive =
      user.subscriptionActive &&
      user.subscriptionStatus === "active" &&
      user.subscriptionExpiresAt &&
      user.subscriptionExpiresAt > now;

    if (!isActive) {
      return res.status(403).json({
        message: "Таны гишүүнчлэл идэвхгүй байна. Эхлээд MNFlix-ээ сунгана уу.",
      });
    }

    // ✅ Subscription OK → continue
    next();
  } catch (err) {
    console.error("checkSubscription error:", err);
    res.status(500).json({ message: "Server error" });
  }
}
