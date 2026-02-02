import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import authMiddleware from "../middleware/auth.js";
import { findGolomtDepositByCode } from "../utils/golomtImap.js";
import BankSettings from "../models/BankSettings.js";

const router = express.Router();

function makeCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function getOrCreateSettings() {
  let s = await BankSettings.findOne();
  if (!s) {
    s = await BankSettings.create({
      bankName: "Golomt Bank",
      accountNumber: "330*****90",
      accountName: "YOUR NAME",
      prices: [
        { months: 1, amount: 11900 },
        { months: 2, amount: 21400 },
        { months: 3, amount: 28500 },
        { months: 6, amount: 46400 },
        { months: 12, amount: 71400 },
      ],
    });
  }
  return s;
}

// ✅ GET intent (code + bank details + prices)
router.get("/intent", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.bankPayCode) {
      user.bankPayCode = makeCode();
      user.bankPayCodeCreatedAt = new Date();
      await user.save();
    }

    const settings = await getOrCreateSettings();

    res.json({
      bankName: settings.bankName,
      accountNumber: settings.accountNumber,
      accountName: settings.accountName,
      code: user.bankPayCode,
      prices: settings.prices,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/confirm", authMiddleware, async (req, res) => {
  try {
    const { months } = req.body;

    const m = Number(months);
    if (!m) return res.status(400).json({ message: "Invalid months" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Ensure code exists (don’t generate new every refresh)
    if (!user.bankPayCode) {
      user.bankPayCode = makeCode();
      user.bankPayCodeCreatedAt = new Date();
      await user.save();
    }

    const settings = await getOrCreateSettings();
    const tier = (settings.prices || []).find((p) => Number(p.months) === m);

    if (!tier) {
      return res.status(400).json({ message: "Invalid months option" });
    }

    const minAmount = Number(tier.amount);

    const result = await findGolomtDepositByCode({
      code: user.bankPayCode,
      minAmount,
    });

    if (!result.found) {
      return res.json({ found: false });
    }

    const now = new Date();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + m);

    user.subscriptionActive = true;
    user.subscriptionStatus = "active";
    user.subscriptionPlan = "basic";
    user.subscriptionExpiresAt = expiry;
    user.autoRenew = false;

    if (!user.subscriptionHistory) user.subscriptionHistory = [];
    user.subscriptionHistory.push({
      plan: "bank",
      paidBy: "golomt-email",
      amount: result.amount,
      startAt: now,
      endAt: expiry,
      status: "success",

      // ✅ SAVE THE EXACT CODE THAT WAS USED
      transferCode: user.bankPayCode,

      // (optional keep note too)
      note: `code=${user.bankPayCode} uid=${result.uid}`,
    });

    // ✅ clear code only after success
    user.bankPayCode = null;

    await user.save();

    return res.json({
      found: true,
      subscribed: true,
      expiresAt: expiry,
      payment: result,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message || "Server error" });
  }
});

export default router;
