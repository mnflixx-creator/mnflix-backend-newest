import "dotenv/config";
import axios from "axios";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import debug from "./utils/debug.js";
import authRoutes from "./routes/auth.js";
import movieRoutes from "./routes/movies.js";
import adminRoutes from "./routes/admin.js";
import progressRoutes from "./routes/progress.js";
import profileRoutes from "./routes/profiles.js";
import homepageSettingsRoute from "./routes/homepageSettings.js";
import accountRoutes from "./routes/account.js";
import subscriptionRoutes from "./routes/subscription.js";
import cron from "node-cron";
import User from "./models/User.js";
import { createServer } from "http";
import { Server } from "socket.io";
import { findGolomtDepositByCode } from "./utils/golomtImap.js";
import subscriptionBankRoutes from "./routes/subscriptionBank.js";
import bankSettingsRoutes from "./routes/bankSettings.js";
import adminBankSettingsRoutes from "./routes/adminBankSettings.js";
import path from "path";
import fs from "fs";
import tmdbRoutes from "./routes/tmdb.js";
import homeSettingsTmdbRoutes from "./routes/homeSettingsTmdb.js";
import providerRoutes from "./routes/provider.js";
import reportRoutes from "./routes/reports.js";
import favoritesRoutes from "./routes/favorites.js";
import subtitlesRoutes from "./routes/subtitles.js";
// import streamRoutes from "./routes/stream.js";
import zentlifyRoutes from "./routes/zentlify.js";
import animeMetaRoutes from "./routes/animeMeta.js";
import autoSubtitlesRoute from "./routes/autoSubtitles.js";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import authMiddleware from "./middleware/auth.js";
import subscriptionCheck from "./middleware/subscription.js";
import deviceLimit from "./middleware/deviceLimit.js";

const app = express();

// ✅ behind Railway / proxies
app.set("trust proxy", 1);

// 🔹 Request logging – appears in Railway Logs
app.use(morgan("combined"));

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "https://mnflix.com",
  "https://www.mnflix.com",
  process.env.FRONTEND_URL, // e.g. https://mnflix-frontend.vercel.app
].filter(Boolean);

// ✅ Allow domains + vercel preview domains
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || origin === "null") {
      return callback(null, true);
    }

    const isAllowed =
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app");

    if (isAllowed) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-device-id"],
};

// ✅ CORS + body parsers (with bigger limit for subtitles)
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// keep apiLimiter definition, but you can even drop skip() now
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // 60 req/min/IP
  standardHeaders: true,
  legacyHeaders: false,
});

// apply ONLY to auth + subscription
app.use("/api/auth", apiLimiter);
app.use("/api/subscription", apiLimiter);
app.use("/api/subscription/bank", apiLimiter);

// ❗TEMP: disable global /api limiter, was causing 429 for normal users
// app.use("/api", apiLimiter);

// 🔹 Stricter limiter for the streaming proxy
const streamLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 60,                  // 60 hits / 10min per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// ⬇️ keep this after body parsers
app.use("/api/subtitles", autoSubtitlesRoute);

/* 🔁 SIMPLE PROXY FOR HLS (used by Shaka) */
app.get(
  "/m3u8-proxy",
  streamLimiter,        // basic DDoS protection
  authMiddleware,       // must be logged in
  subscriptionCheck,    // must have active subscription
  deviceLimit,          // device limit (if you use it)
  async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      const upstream = await axios.get(targetUrl, {
        responseType: "stream",
        headers: {
          ...(req.headers.range ? { Range: req.headers.range } : {}),
          "User-Agent":
            req.headers["user-agent"] ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        validateStatus: () => true,
      });

      res.status(upstream.status);

      const passHeaders = [
        "content-type",
        "content-length",
        "accept-ranges",
        "content-range",
        "cache-control",
      ];
      for (const h of passHeaders) {
        const val = upstream.headers[h];
        if (val) res.setHeader(h, val);
      }

      upstream.data.pipe(res);
    } catch (err) {
      console.error("m3u8-proxy error:", err?.message);
      res.status(500).json({ error: "Proxy request failed" });
    }
  }
);

app.use("/api/zentlify", zentlifyRoutes);
app.use("/api/anime", animeMetaRoutes);

// ✅ VERY IMPORTANT: respond to preflight for ALL routes
app.options(/.*/, cors(corsOptions));

app.use("/api/tmdb", tmdbRoutes);
app.use("/api/homeSettings", homeSettingsTmdbRoutes);

app.use("/api/provider", providerRoutes);

app.get("/", (req, res) => {
  res.send("MNFLIX backend is running ✅");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ROUTES
app.use("/api/movies/favorite", favoritesRoutes);
app.use("/api/movies", subtitlesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/user", authRoutes);
app.use("/api/movies", movieRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/homepageSettings", homepageSettingsRoute);
app.use("/api/account", accountRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/subscription/bank", subscriptionBankRoutes);

// ✅ IMPORTANT: don't mount 2 routers on the same exact path
// Public (used by backend/subscription intent if you want):
app.use("/api/bank-settings", bankSettingsRoutes);

// Admin (used by your admin page fetch):
app.use("/api/admin/bank-settings", adminBankSettingsRoutes);

// 🔴 NEW – this is what your admin page calls
app.use("/api/reports", reportRoutes);

// Serve uploads folder
const uploadsPath = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadsPath, { recursive: true });

app.use("/uploads", express.static(uploadsPath));

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins, // Updated with mnflix.com
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  debug.log("🟢 Device connected:", socket.id);

  socket.on("join-user", (userId) => {
    socket.join(userId);
  });

  socket.on("disconnect", () => {
    debug.log("🔴 Device disconnected");
  });
});

app.get("/api/payments/golomt/check", authMiddleware, async (req, res) => {
  try {
    const code = (req.query.code || "").trim();
    const minAmount = Number(req.query.minAmount || 0);

    if (!code || !minAmount) {
      return res.status(400).json({ message: "code and minAmount are required" });
    }

    const result = await findGolomtDepositByCode({ code, minAmount });
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message || "Server error" });
  }
});

app.set("io", io);

// Every day at 04:00
cron.schedule("0 4 * * *", async () => {
  const now = new Date();
  await User.updateMany(
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
  debug.log("🔁 Daily subscription expire job ran");
});

// START SERVER AFTER DB CONNECTS
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    debug.log("MongoDB connected");

    const PORT = process.env.PORT || 4000;

    // ✅ USE httpServer SO SOCKET.IO WORKS TOO
    httpServer.listen(PORT, () => {
      debug.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => console.error("DB error:", err));