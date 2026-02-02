import express from "express";
import User from "../models/User.js";
import authMiddleware from "../middleware/auth.js";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import axios from "axios";

const router = express.Router();

// ✅ STRIPE INIT (optional, only used if STRIPE_SECRET_KEY exists)
const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

/* ============================
✅ 1) GET QPAY ACCESS TOKEN
============================ */
async function getQPayToken() {
  const res = await axios.post(
    "https://merchant.qpay.mn/v2/auth/token",
    {
      client_id: process.env.QPAY_CLIENT_ID,
      client_secret: process.env.QPAY_CLIENT_SECRET,
    }
  );

  return res.data.access_token;
}

/* ============================
✅ 2) CREATE QPAY INVOICE (REAL)
============================ */
router.post("/qpay/create-invoice", authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const token = await getQPayToken();

    const price = plan === "premium" ? 25000 : 15000;

    const invoiceRes = await axios.post(
      "https://merchant.qpay.mn/v2/invoice",
      {
        invoice_code: process.env.QPAY_INVOICE_CODE,
        sender_invoice_no: `MNFLIX_${user._id}_${Date.now()}`,
        invoice_receiver_code: user.email,
        invoice_description: `MNFLIX ${plan.toUpperCase()} SUBSCRIPTION`,
        amount: price,
        callback_url: process.env.QPAY_CALLBACK_URL,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    res.json({
      success: true,
      invoiceId: invoiceRes.data.invoice_id,
      qrImage: invoiceRes.data.qr_image,
      paymentUrl: invoiceRes.data.urls?.web || invoiceRes.data.urls?.deeplink,
    });
  } catch (err) {
    console.error("QPAY CREATE ERROR:", err.response?.data || err.message);
    res.status(500).json({ message: "QPay create failed" });
  }
});

/* ============================
✅ 3) QPAY PAYMENT CALLBACK (AUTO SUBSCRIBE)
============================ */
router.post("/qpay/callback", async (req, res) => {
  try {
    const { payment_status, sender_invoice_no } = req.body;

    if (payment_status !== "PAID") return res.status(200).end();

    // ✅ Extract user ID from invoice code
    const userId = sender_invoice_no.split("_")[1];

    const user = await User.findById(userId);
    if (!user) return res.status(404).end();

    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1);

    user.subscriptionActive = true;
    user.subscriptionStatus = "active";
    user.subscriptionPlan = "basic"; // or detect from invoice
    user.subscriptionExpiresAt = expiry;
    user.autoRenew = false;

    user.subscriptionHistory.push({
      plan: user.subscriptionPlan,
      paidBy: "qpay",
      amount: 15000,
      startAt: now,
      endAt: expiry,
      status: "success",
    });

    await user.save();

    res.status(200).end();
  } catch (err) {
    console.error("QPAY CALLBACK ERROR:", err.message);
    res.status(500).end();
  }
});

// ✅ Simple admin check using ADMIN_SECRET
function adminOnly(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(403).json({ message: "No admin token" });

  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid admin token" });
  }
}

// =======================
// 1) SIMPLE MANUAL BUTTONS (your current UI)
// =======================

// 💳 Manual "card" payment – 1 month subscription (no real gateway)
router.post("/pay-card", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { plan } = req.body; // "basic" | "premium"
    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1); // +1 month

    user.subscriptionActive = true;
    user.subscriptionStatus = "active";
    user.subscriptionPlan = plan || "basic";
    user.subscriptionExpiresAt = expiry;
    user.autoRenew = false; // manual

    if (!user.subscriptionHistory) user.subscriptionHistory = [];
    user.subscriptionHistory.push({
      plan: user.subscriptionPlan,
      paidBy: "card",         // 👈 matches your schema
      amount: 15000,          // change to real price if you want
      startAt: now,
      endAt: expiry,
      status: "success",
    });

    await user.save();

    res.json({
      success: true,
      message: "✅ Card payment saved. Subscription active for 1 month.",
      expiresAt: expiry,
    });
  } catch (err) {
    console.error("pay-card error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🇲🇳 Manual QPay style – also 1 month (still manual, no API yet)
router.post("/pay-qpay", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { plan } = req.body;
    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1);

    user.subscriptionActive = true;
    user.subscriptionStatus = "active";
    user.subscriptionPlan = plan || "basic";
    user.subscriptionExpiresAt = expiry;
    user.autoRenew = false;

    if (!user.subscriptionHistory) user.subscriptionHistory = [];
    user.subscriptionHistory.push({
      plan: user.subscriptionPlan,
      paidBy: "qpay-manual",
      amount: 15000, // or other price
      startAt: now,
      endAt: expiry,
      status: "success",
    });

    await user.save();

    res.json({
      success: true,
      message: "✅ QPay (manual) payment saved. Subscription active for 1 month.",
      expiresAt: expiry,
    });
  } catch (err) {
    console.error("pay-qpay error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// 2) REAL STRIPE SUBSCRIPTION (AUTO-RENEW CARD)
// =======================

// 👉 Frontend will call this to open Stripe Checkout
router.post("/stripe/create-session", authMiddleware, async (req, res) => {
  try {
    if (!stripe) {
      return res
        .status(400)
        .json({ message: "Stripe is not configured (no STRIPE_SECRET_KEY)." });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { priceId } = req.body; // Stripe price_XXXX from dashboard
    if (!priceId) {
      return res.status(400).json({ message: "Missing Stripe priceId" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user.email,
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/account`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe create-session error:", err);
    res.status(500).json({ message: "Stripe error" });
  }
});

// 👉 After success page, frontend sends session_id here
router.post("/stripe/confirm", authMiddleware, async (req, res) => {
  try {
    if (!stripe) {
      return res
        .status(400)
        .json({ message: "Stripe is not configured (no STRIPE_SECRET_KEY)." });
    }

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "Missing sessionId" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res
        .status(400)
        .json({ message: "Payment not completed in Stripe" });
    }

    const subscription = await stripe.subscriptions.retrieve(
      session.subscription
    );

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();
    const expiry = new Date(subscription.current_period_end * 1000);

    user.subscriptionActive = true;
    user.subscriptionStatus = "active";
    user.subscriptionPlan = "basic"; // or map by priceId
    user.subscriptionExpiresAt = expiry;
    user.autoRenew = true; // 🔁 Stripe auto-charges monthly

    if (!user.subscriptionHistory) user.subscriptionHistory = [];
    user.subscriptionHistory.push({
      plan: user.subscriptionPlan,
      paidBy: "card-stripe",
      amount: 15000, // or read from Stripe price
      startAt: now,
      endAt: expiry,
      status: "success",
    });

    await user.save();

    res.json({
      success: true,
      message: "✅ Stripe subscription active (auto-renew)",
      expiresAt: expiry,
    });
  } catch (err) {
    console.error("Stripe confirm error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// 4) CANCEL SUBSCRIPTION (user)
// =======================
router.post("/cancel", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    user.subscriptionActive = false;
    user.subscriptionStatus = "inactive";
    user.subscriptionPlan = "none";
    user.subscriptionExpiresAt = null;
    user.autoRenew = false;

    await user.save();

    res.json({ message: "Subscription canceled" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// 5) ADMIN: MANUAL CONTROL
// =======================

// List users + subscription info (for admin table)
router.get("/admin/users", adminOnly, async (req, res) => {
  const users = await User.find({})
    .select(
      [
        "email",
        "profiles",
        "createdAt",
        "subscriptionActive",
        "subscriptionStatus",
        "subscriptionPlan",
        "subscriptionExpiresAt",
        "autoRenew",
        "subscriptionHistory", // 👈 needed for transferCode + dates
        "bankPayCode",         // 👈 optional, current unused code
      ].join(" ")
    )
    .sort({ createdAt: -1 });

  res.json(users);
});

// Admin set subscription for a user
router.post("/admin/set-subscription", adminOnly, async (req, res) => {
  try {
    // admin sends: userId, plan, active (true/false), months, amount (optional)
    const { userId, plan, active, months, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();

    if (active) {
      const m = Number(months) || 1; // 👈 how many months to add

      // 👇 base date: if already active, extend from old expiry
      let baseDate = now;
      if (
        user.subscriptionActive &&
        user.subscriptionExpiresAt &&
        user.subscriptionExpiresAt > now
      ) {
        baseDate = new Date(user.subscriptionExpiresAt);
      }

      const expiry = new Date(baseDate);
      expiry.setMonth(expiry.getMonth() + m); // 👈 add m months

      user.subscriptionActive = true;
      user.subscriptionStatus = "active";
      user.subscriptionPlan = plan || "basic";
      user.subscriptionExpiresAt = expiry;
      user.autoRenew = false;

      if (!Array.isArray(user.subscriptionHistory)) {
        user.subscriptionHistory = [];
      }

      user.subscriptionHistory.push({
        plan: user.subscriptionPlan,
        paidBy: "admin-manual",
        amount: Number(amount) || 0,
        startAt: now,
        endAt: expiry,
        status: "success",
        note: `Admin manual subscription, +${m} month(s)`,
      });
    } else {
      // deactivate subscription
      user.subscriptionActive = false;
      user.subscriptionStatus = "inactive";
      user.subscriptionPlan = "none";
      user.subscriptionExpiresAt = null;
      user.autoRenew = false;
    }

    await user.save();

    res.json({ success: true, user });
  } catch (err) {
    console.error("admin set-subscription error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin: expire all users whose expiry date is in the past
router.post("/admin/expire-past", adminOnly, async (req, res) => {
  try {
    const now = new Date();

    const result = await User.updateMany(
      {
        subscriptionActive: true,
        subscriptionExpiresAt: { $lt: now },
      },
      {
        $set: {
          subscriptionActive: false,
          subscriptionStatus: "expired",
        },
      }
    );

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("admin expire-past error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 📊 ADMIN ANALYTICS
router.get("/admin/analytics", adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeUsers = await User.countDocuments({
      subscriptionActive: true
    });

    const revenue = await User.aggregate([
      { $unwind: "$subscriptionHistory" },
      {
        $match: {
          "subscriptionHistory.startAt": { $gte: startOfMonth },
          "subscriptionHistory.status": "success"
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$subscriptionHistory.amount" }
        }
      }
    ]);

    res.json({
      activeUsers,
      monthlyRevenue: revenue[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ message: "Analytics error" });
  }
});

router.post("/stop-stream", authMiddleware, async (req, res) => {
  const deviceId = req.headers["x-device-id"];
  const user = await User.findById(req.user.id);

  if (user.activeStreamDeviceId === deviceId) {
    user.activeStreamDeviceId = null;
    user.devices.forEach(d => (d.isStreaming = false));
    await user.save();
  }

  res.json({ success: true });
});

// ✅ ADMIN VIEW ALL ACTIVE STREAMS
router.get("/admin/devices", adminOnly, async (req, res) => {
  const users = await User.find({ "devices.isStreaming": true })
    .select("email devices activeStreamDeviceId");

  res.json(users);
});

// ✅ ADMIN FORCE LOGOUT DEVICE
router.post("/admin/kick-device", adminOnly, async (req, res) => {
  const { userId, deviceId } = req.body;

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  user.devices = user.devices.filter((d) => d.deviceId !== deviceId);

  if (user.activeStreamDeviceId === deviceId) {
    user.activeStreamDeviceId = null;
  }

  await user.save();

  // 🔴 notify that user in real-time
  const io = req.app.get("io");
  if (io) {
    io.to(user._id.toString()).emit("force-logout", { deviceId });
  }

  res.json({ success: true });
});

export default router;
