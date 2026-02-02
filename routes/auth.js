import debug from "../utils/debug.js";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authMiddleware from "../middleware/auth.js";
import { Resend } from "resend";

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

// helper to generate 4-digit code
function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// -----------------------------
// REGISTER
// -----------------------------
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Имэйл болон нууц үгээ оруулаарай" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({
        message: "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна",
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hashed,
      isPhoneVerified: true,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({
      message: "Бүртгэл амжилттай",
      token,
      user: {
        id: user._id,
        email: user.email,
        subscriptionActive: user.subscriptionActive,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// LOGIN
// -----------------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Имэйл болон нууц үгээ оруулна уу" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Хэрэглэгч бүртгэлгүй байна" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({ message: "Нууц үг буруу байна" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({
      message: "Login success",
      token,
      user: {
        id: user._id,
        email: user.email,
        subscriptionActive: user.subscriptionActive,
        profiles: user.profiles || [],
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/password/send-otp", async (req, res) => {
  const startedAt = Date.now();

  try {
    const { email } = req.body;

    debug.log("🔵 [send-otp] start", { email, at: new Date().toISOString() });

    if (!email) {
      return res.status(400).json({ message: "Имэйл оруулна уу" });
    }

    // ✅ Resend ENV check
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ message: "Missing RESEND_API_KEY in Railway." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Хэрэглэгч олдсонгүй" });
    }

    // rate limit
    if (user.resetOTPExpire && user.resetOTPExpire > Date.now()) {
      const secondsLeft = Math.ceil((user.resetOTPExpire - Date.now()) / 1000);
      return res.status(429).json({
        message: `Дахин код авахын тулд ${secondsLeft} секунд хүлээнэ үү`,
      });
    }

    const otp = generateOtp();

    const fromEmail = process.env.EMAIL_FROM || "MNFLIX <onboarding@resend.dev>";

    // ✅ Send email with Resend
    const result = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "MNFLIX – Нууц үг сэргээх код",
      html: `
        <h2>Нууц үг сэргээх</h2>
        <p>Таны код: <b>${otp}</b></p>
        <p>Энэ код 5 минут хүчинтэй.</p>
      `,
    });

    debug.log("🟢 [send-otp] resend result:", result);

    // ✅ Save OTP after send
    user.resetOTP = otp;
    user.resetOTPExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    debug.log("✅ [send-otp] done", { ms: Date.now() - startedAt });
    return res.json({ message: "Код амжилттай илгээгдлээ" });

  } catch (err) {
    debug.log("🔴 [send-otp] error", {
      message: err?.message,
      name: err?.name,
      ms: Date.now() - startedAt,
    });

    return res.status(500).json({ message: "Имэйл илгээхэд алдаа гарлаа." });
  }
});

router.post("/password/verify-otp", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    debug.log("✅ EMAIL FROM FRONTEND:", email);
    debug.log("✅ OTP FROM FRONTEND:", otp);

    const user = await User.findOne({ email });

    if (!user) {
      debug.log("❌ USER NOT FOUND");
      return res.status(404).json({ message: "User not found" });
    }

    debug.log("✅ OTP IN DATABASE:", user.resetOTP);
    debug.log("✅ OTP EXPIRES AT:", user.resetOTPExpire);
    debug.log("✅ CURRENT TIME:", Date.now());

    if (
      String(user.resetOTP) !== String(otp) ||
      user.resetOTPExpire < Date.now()
    ) {
      debug.log("❌ OTP MISMATCH OR EXPIRED");
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    user.resetOTP = null;
    user.resetOTPExpire = null;

    await user.save();

    debug.log("✅ PASSWORD RESET SUCCESS");

    return res.json({
      success: true,
      message: "Password reset successful",
    });

  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ❌ DISABLED: DUPLICATE BROKEN ROUTE (DO NOT USE)
// (Keeping it empty prevents accidental calls)
router.post("/forgot-password", async (req, res) => {
  return res.status(410).json({ message: "This endpoint is disabled" });
});

// -----------------------------
// PROFILES (unchanged)
// -----------------------------
router.post("/profile/create", authMiddleware, async (req, res) => {
  try {
    const { name, avatar, kids } = req.body;

    if (!name || !avatar) {
      return res.status(400).json({ message: "Нэр болон зураг шаардлагатай" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const exists = user.profiles.some(
      (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
    );

    if (exists) {
      return res
        .status(400)
        .json({ message: "Энэ нэртэй профайл аль хэдийн нэмэгдсэн байна" });
    }

    user.profiles.push({ name, avatar, kids: kids || false });
    user.currentProfile = { name, avatar };
    await user.save();

    return res.json({
      message: "Профайл амжилттай үүслээ",
      profiles: user.profiles,
      currentProfile: user.currentProfile,
    });
  } catch (err) {
    console.error("Create profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/delete", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profiles = user.profiles.filter((p) => p.name !== name);
    await user.save();

    res.json({ message: "Profile deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================================================
   🔐 CHANGE PASSWORD (FROM ACCOUNT PAGE)
========================================================= */
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
      return res.status(400).json({ message: "Current password incorrect" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    debug.log("Password change error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================================================
   🚫 CANCEL SUBSCRIPTION
========================================================= */
router.post("/subscription/cancel", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    user.subscriptionStatus = "inactive";
    user.subscriptionPlan = "none";
    user.subscriptionExpiresAt = null;

    await user.save();

    res.json({ message: "Subscription canceled" });
  } catch (err) {
    debug.log("Cancel sub error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================================================
   💳 CARD PAYMENT PLACEHOLDER
========================================================= */
router.post("/subscription/pay-card", authMiddleware, async (req, res) => {
  const { plan } = req.body;

  res.json({
    message: "Card payment placeholder (Stripe will be connected later)",
    plan,
  });
});

/* =========================================================
   🇲🇳 QPAY PLACEHOLDER
========================================================= */
router.post("/subscription/pay-qpay", authMiddleware, async (req, res) => {
  const { plan } = req.body;

  res.json({
    message: "QPay placeholder (Real QPay API will be connected later)",
    plan,
  });
});

// -----------------------------
// ✅ GET CURRENT USER (ACCOUNT PAGE)
// -----------------------------
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "-password -resetOTP -resetOTPExpire"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ user });
  } catch (err) {
    console.error("Auth /me error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// ✅ WATCH HISTORY (FIXED)
// -----------------------------
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const Progress = (await import("../models/Progress.js")).default;

    const history = await Progress.find({ userId: req.user.id })
      .populate({
        path: "movieId",
        select: "title thumbnail"
      })
      .sort({ updatedAt: -1 })
      .limit(30);

    // ✅ MAP TO FRONTEND FORMAT
    const cleanHistory = history.map((item) => ({
      movie: item.movieId,
      progress: item.progress || 0,
      duration: item.duration || 0,
    }));

    res.json({ history: cleanHistory });
  } catch (err) {
    console.error("Auth history error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ UPDATE AVATAR (current profile avatar)
router.post("/avatar", authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar) {
      return res.status(400).json({ message: "Avatar is required" });
    }

    // ✅ Load user
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ If you store avatar directly on user:
    // user.avatar = avatar;

    // ✅ If you store avatar inside currentProfile (common in profile systems):
    // (This works if currentProfile is embedded in user)
    if (user.currentProfile) {
      user.currentProfile.avatar = avatar;
    } else {
      // fallback (if your user has avatar field)
      user.avatar = avatar;
    }

    await user.save();

    return res.json({
      success: true,
      avatar,
      message: "Avatar updated",
    });
  } catch (err) {
    console.error("avatar update error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
