// routes/reports.js
import express from "express";
import jwt from "jsonwebtoken";
import Report from "../models/Report.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// 🔐 Simple admin check (same logic style as in movies.js)
function adminOnly(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(403).json({ message: "No admin token" });

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
}

// 👤 USER: list own reports (for notifications)
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const reports = await Report.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate("movie", "title tmdbId")
      .lean();

    return res.json(reports);
  } catch (err) {
    console.error("My reports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/reports?status=new|seen|fixed|unfixable|all
router.get("/", adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .populate("movie", "title tmdbId")      // ✅ title + tmdbId
      .populate("user", "email name")         // user info
      .lean();                                // optional, but nice for frontend

    return res.json(reports);
  } catch (err) {
    console.error("Reports list error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/reports/:id   { status }
router.patch("/:id", adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["new", "seen", "fixed", "unfixable"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    return res.json(report);
  } catch (err) {
    console.error("Report update error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/reports/:id/reply  { reply: "text..." }
router.patch("/:id/reply", adminOnly, async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim()) {
      return res.status(400).json({ message: "Reply is required" });
    }

    const report = await Report.findById(req.params.id)
      .populate("movie", "title tmdbId")   // 👈 add tmdbId
      .populate("user", "_id email");

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    report.adminReply = reply.trim();
    report.repliedAt = new Date();
    report.userSeenReply = false;       // user hasn’t read it yet

    // optional: auto mark as "seen" if still new
    if (report.status === "new") {
      report.status = "seen";
    }

    await report.save();

    // 🔔 send realtime notification via Socket.IO
    const io = req.app.get("io");
    if (io && report.user?._id) {
      io.to(report.user._id.toString()).emit("report-replied", {
        reportId: report._id.toString(),
        movieTitle: report.movie?.title || "",
        reply: report.adminReply,
        repliedAt: report.repliedAt,
      });
    }

    return res.json(report);
  } catch (err) {
    console.error("Report reply error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// 👀 USER: mark admin reply as seen
router.patch("/:id/seen-reply", authMiddleware, async (req, res) => {
  try {
    const report = await Report.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    report.userSeenReply = true;
    await report.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("Seen reply error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/reports/:id
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Report delete error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
