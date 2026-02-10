import debug from "../utils/debug.js";
import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/User.js";
import Movie from "../models/Movie.js";
import Progress from "../models/Progress.js"; // remove if unused
import upload from "../middleware/upload.js";

const router = express.Router();

router.patch(
  "/movies/:id/edit",
  adminOnly,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "banner", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // ✅ 1) Get existing doc type from DB (the source of truth)
      const existing = await Movie.findById(req.params.id).select("type").lean();
      if (!existing) return res.status(404).json({ message: "Movie not found" });

      const existingType = existing.type; // "movie" | "series" | ...

      // ✅ 2) Build update WITHOUT type
      const update = {
        title: req.body.title,
        description: req.body.description,
        year: req.body.year,
        rating: Number(req.body.rating) || 0,
        genres: JSON.parse(req.body.genres || "[]"),

        kidsOnly: req.body.kidsOnly === "true",
        isTrending: req.body.isTrending === "true",
      };

      // ✅ 3) Only update movie players if the DB type is movie
      if (existingType === "movie") {
        update.player1 = req.body.player1 || "";
        update.player2 = req.body.player2 || "";
        update.player3 = req.body.player3 || "";
        update.hlsPath = req.body.hlsPath || "";
      }

      // ✅ 4) Only update seasons if DB type is NOT movie
      if (existingType !== "movie" && req.body.seasons) {
        update.seasons = JSON.parse(req.body.seasons);
      }

      // ✅ images
      if (req.files?.thumbnail?.[0]) {
        update.thumbnail = `/uploads/${req.files.thumbnail[0].filename}`;
      } else if (req.body.thumbnailUrl) {
        update.thumbnail = req.body.thumbnailUrl;
      }

      if (req.files?.banner?.[0]) {
        update.banner = `/uploads/${req.files.banner[0].filename}`;
      } else if (req.body.bannerUrl) {
        update.banner = req.body.bannerUrl;
      }

      const movie = await Movie.findByIdAndUpdate(req.params.id, update, {
        new: true,
      });

      return res.json(movie);
    } catch (err) {
      debug.log(err);
      res.status(500).json({ message: "Update failed" });
    }
  }
);

dotenv.config();

/* ----------------------------------------
   🔒 ADMIN MIDDLEWARE
-----------------------------------------*/
function adminOnly(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(403).json({ message: "No admin token" });

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }

    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
}

/* ----------------------------------------
   🔐 ADMIN LOGIN
-----------------------------------------*/
router.post("/login", (req, res) => {
  const { username, password } = req.body;

  debug.log("LOGIN TRY:", {
    inputUsername: username,
    envUsername: process.env.ADMIN_USERNAME,
    passLenInput: password?.length,
    passLenEnv: process.env.ADMIN_PASSWORD?.length,
    hasSecret: !!process.env.ADMIN_SECRET,
  });

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ role: "admin" }, process.env.ADMIN_SECRET, {
      expiresIn: "24h",
    });
    return res.json({ token });
  }

  res.status(401).json({ message: "Invalid admin credentials" });
});

/* ----------------------------------------
   📊 ADMIN DASHBOARD STATS
-----------------------------------------*/
router.get("/stats", adminOnly, async (req, res) => {
  try {
    const users = await User.countDocuments();
    const subscribed = await User.countDocuments({ subscriptionStatus: "active" });
    const movies = await Movie.countDocuments();

    // -------------------------
    // 🎬 TOP MOVIES: ALL TIME (existing)
    // -------------------------
    const allTimeAgg = await Progress.aggregate([
      { $group: { _id: "$movieId", views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 10 }
    ]);

    const allIds = allTimeAgg.map(p => p._id);
    const allDocs = await Movie.find({ _id: { $in: allIds } });

    const topMovies = allTimeAgg.map((p) => {
      const movie = allDocs.find(m => m._id.toString() === p._id.toString());
      const percent = allTimeAgg[0] ? Math.round((p.views / allTimeAgg[0].views) * 100) : 0;
      return {
        _id: p._id,
        title: movie?.title,
        thumbnail: movie?.thumbnail,
        views: p.views,
        percent
      };
    });

    // -------------------------
    // ✅ DATE HELPERS
    // -------------------------
    const startOfDay = (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };

    const now = new Date();

    // enough data so frontend can slice 7d/30d/all
    const since365 = startOfDay(new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000));
    const since30 = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    const since7 = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));

    // monthly (12 months)
    const since12m = startOfDay(new Date(now));
    since12m.setMonth(since12m.getMonth() - 11);
    since12m.setDate(1);

    // -------------------------
    // ✅ DAILY REGISTRATIONS (last 365 days)
    // -------------------------
    const registrationsDaily = await User.aggregate([
      { $match: { createdAt: { $gte: since365 } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ✅ MONTHLY REGISTRATIONS (last 12 months)
    const registrationsMonthly = await User.aggregate([
      { $match: { createdAt: { $gte: since12m } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // -------------------------
    // ✅ DAILY SUBSCRIPTIONS + REVENUE BY PLAN (last 365 days)
    // IMPORTANT: uses subscriptionHistory.plan ("basic" / "premium" / "admin")
    // -------------------------
    const subscriptionsDaily = await User.aggregate([
      { $unwind: "$subscriptionHistory" },
      {
        $match: {
          "subscriptionHistory.status": "success",
          "subscriptionHistory.startAt": { $gte: since365 }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$subscriptionHistory.startAt" }
          },
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$subscriptionHistory.amount", 0] } },

          // ✅ plan revenue split
          basicRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$subscriptionHistory.plan", "basic"] },
                { $ifNull: ["$subscriptionHistory.amount", 0] },
                0
              ]
            }
          },
          premiumRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$subscriptionHistory.plan", "premium"] },
                { $ifNull: ["$subscriptionHistory.amount", 0] },
                0
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ✅ MONTHLY SUBSCRIPTIONS (last 12 months)
    const subscriptionsMonthly = await User.aggregate([
      { $unwind: "$subscriptionHistory" },
      {
        $match: {
          "subscriptionHistory.status": "success",
          "subscriptionHistory.startAt": { $gte: since12m }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$subscriptionHistory.startAt" }
          },
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$subscriptionHistory.amount", 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // -------------------------
    // ✅ MOVIES: WEEKLY + MONTHLY TOP 10 (100% correct)
    // uses Progress.createdAt
    // -------------------------
    const buildTopMovies = async (sinceDate) => {
      const agg = await Progress.aggregate([
        { $match: { createdAt: { $gte: sinceDate } } },
        { $group: { _id: "$movieId", views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 10 }
      ]);

      const ids = agg.map(x => x._id);
      const docs = await Movie.find({ _id: { $in: ids } });

      return agg.map((p) => {
        const movie = docs.find(m => m._id.toString() === p._id.toString());
        const percent = agg[0] ? Math.round((p.views / agg[0].views) * 100) : 0;
        return {
          _id: p._id,
          title: movie?.title,
          thumbnail: movie?.thumbnail,
          views: p.views,
          percent
        };
      });
    };

    const topMoviesWeekly = await buildTopMovies(since7);
    const topMoviesMonthly = await buildTopMovies(since30);

    // -------------------------
    // ✅ OPTIONAL: breakdowns (your existing)
    // -------------------------
    const activePlanBreakdown = await User.aggregate([
      { $match: { subscriptionStatus: "active" } },
      { $group: { _id: "$subscriptionPlan", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const paidByBreakdown = await User.aggregate([
      { $unwind: "$subscriptionHistory" },
      { $match: { "subscriptionHistory.status": "success" } },
      { $group: { _id: "$subscriptionHistory.paidBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      users,
      subscribed,
      movies,

      topMovies,          // all time
      topMoviesWeekly,    // ✅ added
      topMoviesMonthly,   // ✅ added

      registrationsDaily,     // ✅ now 365d
      registrationsMonthly,

      subscriptionsDaily,     // ✅ now 365d + basicRevenue/premiumRevenue
      subscriptionsMonthly,

      activePlanBreakdown,
      paidByBreakdown
    });
  } catch (err) {
    debug.log("Admin stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   👥 USERS LIST
-----------------------------------------*/
router.get("/users", adminOnly, async (req, res) => {
  try {
    const users = await User.find()
      .select("-bankPayCode -bankPayCodeCreatedAt")
      .populate("profiles");

    const out = users.map((u) => {
      const obj = u.toObject();

      const history = Array.isArray(obj.subscriptionHistory)
        ? obj.subscriptionHistory
        : [];

      // ✅ last record (any type)
      const lastAny = history.length ? history[history.length - 1] : null;

      // ✅ most recent SUCCESSFUL subscription (bank, card, qpay)
      const lastSuccess = [...history].reverse().find(
        (h) => h?.status === "success"
      );

      // ✅ ONLY use saved transferCode (REAL USED CODE)
      const transferCode = lastSuccess?.transferCode
        ? String(lastSuccess.transferCode).toUpperCase()
        : null;

      return {
        ...obj,

        // ✅ for your table columns:
        registeredAt: obj.createdAt || null,

        subscribedAt: lastSuccess?.startAt || obj.subscriptionStartedAt || lastAny?.startAt || null,

        endsAt: obj.subscriptionExpiresAt || lastSuccess?.endAt || lastAny?.endAt || null,

        // ✅ code used in transfer (shown in admin table)
        transferCode: transferCode || null,
      };
    });

    res.json(out);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   ⭐ TOGGLE TRENDING MOVIE
-----------------------------------------*/
router.patch("/movies/:id/trending", adminOnly, async (req, res) => {
  try {
    const { isTrending } = req.body;

    const movie = await Movie.findByIdAndUpdate(
      req.params.id,
      { isTrending },
      { new: true }
    );

    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    res.json({ message: "Updated", movie });

  } catch (err) {
    debug.log("Trending toggle error", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   🔁 ADMIN TOGGLE USER SUBSCRIPTION
-----------------------------------------*/
router.post("/users/:id/toggle-subscription", adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const now = new Date();

    if (user.subscriptionStatus === "active") {
      // 🔴 DEACTIVATE
      user.subscriptionStatus = "inactive";
      user.subscriptionActive = false;
      user.subscriptionExpiresAt = null;
    } else {
      // 🟢 ACTIVATE (30 days default)
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);

      user.subscriptionStatus = "active";
      user.subscriptionActive = true;
      user.subscriptionPlan = "basic";
      user.subscriptionExpiresAt = expiry;

      // optional: record admin action
      user.subscriptionHistory.push({
        plan: "admin",
        paidBy: "admin",
        amount: 0,
        startAt: now,
        endAt: expiry,
        status: "success",
        transferCode: "ADMIN",
        note: "Activated by admin",
      });
    }

    await user.save();

    res.json({
      success: true,
      status: user.subscriptionStatus,
      expiresAt: user.subscriptionExpiresAt,
    });
  } catch (err) {
    debug.log("Admin toggle error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🗑 DELETE USER (admin)
router.delete("/users/:id", adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;

    // Optional: also delete their progress/history to keep DB clean
    await Progress.deleteMany({ userId });

    const deleted = await User.findByIdAndDelete(userId);
    if (!deleted) return res.status(404).json({ message: "User not found" });

    return res.json({ ok: true });
  } catch (err) {
    debug.log("Delete user error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------
   🎬 ADMIN MOVIES LIST (ONLY MANUAL UPLOADS)
-----------------------------------------*/
router.get("/movies", adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const perPage = parseInt(req.query.perPage || "20", 10);

    // ⭐ Only show your own uploads in this table
    const filter = { source: "manual" };

    const [movies, total] = await Promise.all([
      Movie.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      Movie.countDocuments(filter),
    ]);

    res.json({
      movies,
      total,
      page,
      perPage,
    });
  } catch (err) {
    debug.log("Admin movies list error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
