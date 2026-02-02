import express from "express";
import BankSettings from "../models/BankSettings.js";
import adminAuth from "../middleware/adminAuth.js";

const router = express.Router();

// Get or create singleton settings doc
async function getOrCreateSettings() {
  let settings = await BankSettings.findOne();
  if (!settings) {
    settings = await BankSettings.create({
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
  return settings;
}

// ✅ GET: load settings
router.get("/", adminAuth, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(settings);
  } catch (e) {
    res.status(500).json({ message: e.message || "Server error" });
  }
});

// ✅ POST: save settings
router.post("/", adminAuth, async (req, res) => {
  try {
    const { bankName, accountNumber, accountName, prices } = req.body;

    if (!Array.isArray(prices) || prices.length === 0) {
      return res.status(400).json({ message: "Prices array is required" });
    }

    // sanitize + sort
    const cleaned = prices
      .map((p) => ({
        months: Number(p.months),
        amount: Number(p.amount),
      }))
      .filter(
        (p) =>
          Number.isFinite(p.months) &&
          Number.isFinite(p.amount) &&
          p.months > 0 &&
          p.amount > 0
      )
      .sort((a, b) => a.months - b.months);

    if (cleaned.length === 0) {
      return res.status(400).json({ message: "No valid price rows" });
    }

    let settings = await getOrCreateSettings();
    settings.bankName = bankName ?? settings.bankName;
    settings.accountNumber = accountNumber ?? settings.accountNumber;
    settings.accountName = accountName ?? settings.accountName;
    settings.prices = cleaned;

    await settings.save();

    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ message: e.message || "Server error" });
  }
});

export default router;
