import debug from "../utils/debug.js";
// routes/account.js
import express from "express";
import bcrypt from "bcryptjs";
import authMiddleware from "../middleware/auth.js";
import User from "../models/User.js";

const router = express.Router();

/* ----------------------------------------
   👤 GET MY ACCOUNT INFO
-----------------------------------------*/
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "email subscriptionPlan subscriptionStatus subscriptionExpiresAt"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      email: user.email,
      subscriptionPlan: user.subscriptionPlan,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    });
  } catch (err) {
    debug.log("Account /me error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   🔐 CHANGE PASSWORD
-----------------------------------------*/
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields required" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    debug.log("Change password error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   📅 GET SUBSCRIPTION INFO (same as /me but separate if needed)
-----------------------------------------*/
router.get("/subscription", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "subscriptionPlan subscriptionStatus subscriptionExpiresAt"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      plan: user.subscriptionPlan,
      status: user.subscriptionStatus,
      expiresAt: user.subscriptionExpiresAt,
    });
  } catch (err) {
    debug.log("Subscription info error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   🚫 CANCEL SUBSCRIPTION
   (Just flips status/plan – payment provider cancel must be added later)
-----------------------------------------*/
router.post("/subscription/cancel", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.subscriptionStatus = "inactive";
    user.subscriptionPlan = "none";
    user.subscriptionActive = false;
    user.subscriptionExpiresAt = null;

    await user.save();

    res.json({ message: "Subscription canceled" });
  } catch (err) {
    debug.log("Cancel subscription error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   💳 START CARD PAYMENT (PLACEHOLDER)
   Here you integrate Stripe / other card provider
-----------------------------------------*/
router.post("/subscription/pay-card", authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    // TODO: integrate Stripe / PayPal / etc.
    // For now just fake success:
    res.json({
      ok: true,
      message: "Card payment endpoint placeholder. Connect real provider here.",
      plan,
    });
  } catch (err) {
    debug.log("Card payment error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   🇲🇳 QPay PAYMENT (PLACEHOLDER)
   Here you integrate Mongolian QPay API
-----------------------------------------*/
router.post("/subscription/pay-qpay", authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    // TODO: call QPay API, generate QR / deep link etc.
    res.json({
      ok: true,
      message: "QPay payment endpoint placeholder. Connect QPay API here.",
      plan,
    });
  } catch (err) {
    debug.log("QPay error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ GET USER DEVICES
router.get("/devices", authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select("devices activeStreamDeviceId");

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  // 🟢 current device ID from header (same as you use in movie page)
  const currentDeviceId = req.headers["x-device-id"] || null;

  return res.json({
    devices: user.devices || [],
    activeStreamDeviceId: user.activeStreamDeviceId || null,
    currentDeviceId,
  });
});

// ✅ DELETE DEVICE
router.delete("/devices/:deviceId", authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id);

  user.devices = user.devices.filter(
    d => d.deviceId !== req.params.deviceId
  );

  if (user.activeStreamDeviceId === req.params.deviceId) {
    user.activeStreamDeviceId = null;
  }

  await user.save();
  res.json({ success: true });
});

export default router;
