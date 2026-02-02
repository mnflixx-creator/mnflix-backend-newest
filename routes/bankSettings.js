import express from "express";
import jwt from "jsonwebtoken";
import BankSettings from "../models/BankSettings.js";

const router = express.Router();

function adminOnly(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(403).json({ message: "No admin token" });

  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ message: "Not allowed" });
    next();
  } catch {
    return res.status(403).json({ message: "Invalid admin token" });
  }
}

// GET current bank settings
router.get("/", adminOnly, async (req, res) => {
  let s = await BankSettings.findOne();
  if (!s) s = await BankSettings.create({});
  res.json(s);
});

// UPDATE bank settings
router.put("/", adminOnly, async (req, res) => {
  const { bankName, accountNumber, accountName } = req.body;

  let s = await BankSettings.findOne();
  if (!s) s = await BankSettings.create({});

  if (typeof bankName === "string") s.bankName = bankName;
  if (typeof accountNumber === "string") s.accountNumber = accountNumber;
  if (typeof accountName === "string") s.accountName = accountName;

  await s.save();
  res.json({ success: true, settings: s });
});

export default router;
