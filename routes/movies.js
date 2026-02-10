
import debug from "../utils/debug.js";
import express from "express";
import Movie from "../models/Movie.js";
import User from "../models/User.js"; // <-- missing in your file
import Progress from "../models/Progress.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import upload from "../middleware/upload.js";
import authMiddleware from "../middleware/auth.js";
import subscriptionCheck from "../middleware/subscription.js";
import deviceLimit from "../middleware/deviceLimit.js";
import multer from "multer"; // ✅ NEW
import axios from "axios";
import Report from "../models/Report.js";
import mongoose from "mongoose";
import { getCache, setCache } from "../utils/tmdbCache.js";

dotenv.config();

const router = express.Router();

// 🔹 Simple in-memory cache for TMDB search
const tmdbSearchCache = new Map();
const TMDB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getTmdbCache(key) {
  const entry = tmdbSearchCache.get(key);
  if (!entry) return null;
  // expired?
  if (Date.now() - entry.time > TMDB_CACHE_TTL_MS) {
    tmdbSearchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setTmdbCache(key, data) {
  tmdbSearchCache.set(key, { time: Date.now(), data });
}

// ✅ Separate multer for subtitles (accept any file type like .vtt, .srt)
const subtitleStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, "uploads/"); // or "uploads/subtitles" if you prefer
  },
  filename(req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, Date.now() + "-" + safeName);
  },
});

// 🔐 Admin-only
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

// Escape special regex characters to prevent ReDoS and injection
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ===============================
router.get("/search/:q", async (req, res) => {
  try {
    const q = req.params.q.trim();
    if (!q) {
      return res.json({ local: [], tmdb: [] });
    }

    const safeQuery = escapeRegex(q);

    const localMovies = await Movie.find(
      { title: { $regex: safeQuery, $options: "i" } },
      "title thumbnail banner tmdbId type year rating"
    )
      .limit(12)
      .lean();

        // 2) TMDB search (movies + tv) — with simple cache
        let tmdbResults = [];
        try {
          const key = process.env.TMDB_API_KEY;
          if (key && q && q.trim()) {
            // 🔒 Always request English titles from TMDB
            const tmdbLang = "en-US";

            // 🔹 cache key: language + query
            const cacheKey = `${tmdbLang}:${q.toLowerCase()}`;

            const cached = getTmdbCache(cacheKey);

            if (cached) {
              // ✅ use cached TMDB results
              tmdbResults = cached;
            } else {
              const tmdbRes = await axios.get(
                "https://api.themoviedb.org/3/search/multi",
                {
                  params: {
                    api_key: key,
                    query: q,
                    include_adult: false,
                    language: tmdbLang,
                  },
                }
              );

              const raw = Array.isArray(tmdbRes.data?.results)
                ? tmdbRes.data.results
                : [];

              tmdbResults = raw
                .filter(
                  (r) =>
                    (r.media_type === "movie" || r.media_type === "tv") &&
                    (r.poster_path || r.backdrop_path)
                )
                .map((r) => ({
                  ...r,
                  // 🟢 Force English title
                  forcedTitle:
                    r.title ||
                    r.name ||
                    r.original_title ||
                    r.original_name ||
                    "",

                  // 🟢 Keep year consistent too
                  forcedYear:
                    (r.release_date || r.first_air_date || "").slice(0, 4),
                }))
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
                .slice(0, 20);

              // 💾 store in cache
              setTmdbCache(cacheKey, tmdbResults);
            }
          }
        } catch (e) {
          console.error("TMDB search failed:", e.message);
          // don't crash search if TMDB is down
        }

    res.json({
      local: localMovies,
      tmdb: tmdbResults,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/genres/all", async (req, res) => {
  try {
    const genres = await Movie.distinct("genres");
    res.json(genres.filter(g => g && g.trim() !== "")); // remove empty
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET chosen slider movies for landing page
router.get("/trending", async (req, res) => {
  try {
    const list = await Movie.find({ isTrending: true })
      .select(
        "title description thumbnail banner year genres kidsOnly isTrending tmdbId type rating createdAt"
      )
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(10)
      .lean();

    res.json(list);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post(
  "/add",
  adminOnly,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "banner", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const thumbFile = req.files?.thumbnail?.[0];
      const bannerFile = req.files?.banner?.[0];

      // ✅ Always convert genres to array
      let genres = [];
      if (req.body.genres) {
        try {
          genres = JSON.parse(req.body.genres);
        } catch (err) {
          genres = [req.body.genres];
        }
      }

      // ✅ tmdbId support
      const tmdbId = req.body.tmdbId ? Number(req.body.tmdbId) : null;

      // ⭐ Decide source automatically
      // if has tmdbId => "tmdb", else => "manual"
      const source = tmdbId ? "tmdb" : "manual";

      // ✅ Seasons logic
      let seasons = [];

      // 1) If admin sent seasons manually -> use that
      if (req.body.seasons) {
        try {
          seasons = JSON.parse(req.body.seasons);
        } catch (err) {
          seasons = [];
        }
      }
      // 2) If it's a series/anime, has tmdbId and NO seasons sent -> auto-build from TMDB
      else if (req.body.type !== "movie" && tmdbId) {
        try {
          const tvData = await fetchTmdbTvStructure(tmdbId);
          seasons = tvData.seasons || [];
        } catch (err) {
          debug.log("auto TMDB seasons failed:", err.message);
          seasons = [];
        }
      }

      // ✅ Subtitles from formData (JSON string)
      let subtitles = [];
      if (req.body.subtitles) {
        try {
          const parsed = JSON.parse(req.body.subtitles);
          if (Array.isArray(parsed)) {
            subtitles = parsed
              .filter((s) => s && s.url && String(s.url).trim() !== "")
              .map((s) => ({
                lang: s.lang || "",
                label: s.label || "",
                url: s.url,
                isDefault: !!s.isDefault,
              }));
          }
        } catch (err) {
          subtitles = [];
        }
      }


      const movie = new Movie({
        source, // ⭐ "tmdb" or "manual"
        title: req.body.title,
        description: req.body.description,
        year: req.body.year,

        tmdbId: tmdbId,
        rating: Number(req.body.rating) || 0,
        genres,

        kidsOnly: req.body.kidsOnly === "true" || req.body.kidsOnly === true,
        isTrending: req.body.isTrending === "true" || req.body.isTrending === true,

        player1: req.body.player1,
        player2: req.body.player2,
        player3: req.body.player3,

        hlsPath: (req.body.hlsPath || "").trim(), // ✅ ADD THIS

        type: req.body.type,
        seasons,

        // ✅ add this line:
        subtitles,   // <<<<<<<<<<<<<<<<<<<<<<

        thumbnail: thumbFile
          ? `/uploads/${thumbFile.filename}`
          : req.body.thumbnailUrl || null,

        banner: bannerFile
          ? `/uploads/${bannerFile.filename}`
          : req.body.bannerUrl || null,
      });

      await movie.save();
      res.json({ message: "Movie created", movie });
    } catch (err) {
      debug.log(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ===============================
// ✏️ UPDATE MOVIE (Edit movie + upload thumbnail/banner)
// ===============================
router.patch(
  "/:id",
  adminOnly,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "banner", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const updates = {
        title: req.body.title,
        description: req.body.description,
        isEdited: true,
        year: req.body.year,
        genres: JSON.parse(req.body.genres || "[]"),
        player1: req.body.player1,
        player2: req.body.player2,
        player3: req.body.player3,
        hlsPath: (req.body.hlsPath || "").trim(), // ✅ ADD THIS
        kidsOnly: req.body.kidsOnly === "true",
        isTrending: req.body.isTrending === "true",
      };

      // ✅ Subtitles from edit form
      if (req.body.subtitles) {
        try {
          const parsedSubs = JSON.parse(req.body.subtitles);
          if (Array.isArray(parsedSubs)) {
            updates.subtitles = parsedSubs
              .filter((s) => s && s.url && String(s.url).trim() !== "")
              .map((s) => ({
                lang: s.lang || "",
                label: s.label || "",
                url: s.url,
                isDefault: !!s.isDefault,
              }));
          }
        } catch (err) {
          // ignore if invalid
        }
      }

      if (req.body.seasons) {
        updates.seasons = JSON.parse(req.body.seasons);
      }

      // ✅ THUMBNAIL: prefer uploaded file, else use URL if provided
      if (req.files?.thumbnail?.[0]) {
        updates.thumbnail = `/uploads/${req.files.thumbnail[0].filename}`;
      } else if (req.body.thumbnailUrl) {
        updates.thumbnail = req.body.thumbnailUrl;
      }

      // ✅ BANNER: prefer uploaded file, else use URL if provided
      if (req.files?.banner?.[0]) {
        updates.banner = `/uploads/${req.files.banner[0].filename}`;
      } else if (req.body.bannerUrl) {
        updates.banner = req.body.bannerUrl;
      }

      const movie = await Movie.findByIdAndUpdate(
        req.params.id,
        updates,
        { new: true }
      );

      res.json({ message: "Movie updated", movie });
    } catch (err) {
      debug.log(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ===============================
// ⭐ TOGGLE TRENDING
// ===============================
router.put("/trending/:id", adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);

    if (!movie) return res.status(404).json({ message: "Movie not found" });

    movie.isTrending = !movie.isTrending;
    await movie.save();

    res.json({
      message: "Trending status updated",
      isTrending: movie.isTrending
    });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


// ===============================
// 🗑 DELETE MOVIE
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findByIdAndDelete(req.params.id);
    if (!movie) return res.status(404).json({ message: "Movie not found" });

    res.json({ message: "Movie deleted" });
  } catch (err) {
    console.error("Delete movie error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ return movies for lists / admin page
router.get("/", async (req, res) => {
  try {
    const limitRaw = req.query.limit;
    let limit = parseInt(limitRaw, 10);
    const hasLimit = Number.isFinite(limit) && limit > 0;

    let query = Movie.find({}).sort({ createdAt: -1 });

    // If limit is used (like ?limit=80 on movie page),
    // make it LIGHT: only send fields needed for cards
    if (hasLimit) {
      query = query
        .select(
          "title thumbnail banner year genres kidsOnly isTrending tmdbId type rating createdAt source"
        )
        .limit(Math.min(limit, 200));
    }

    const movies = await query.lean();
    res.json(movies);
  } catch (err) {
    console.error("GET /api/movies error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET MOVIES BY TYPE (with allowed list)
router.get("/type/:type", async (req, res) => {
  try {
    const allowed = ["movie", "series", "anime", "kdrama", "cdrama"];
    const type = req.params.type;

    if (!allowed.includes(type)) {
      return res.status(400).json({ message: "Invalid type" });
    }

    const filter = { type };

    if (req.query.source === "manual") {
      // only explicitly manual
      filter.source = "manual";
    } else if (req.query.source === "tmdb") {
      // treat missing source + tmdbId as TMDB too
      filter.$or = [
        { source: "tmdb" },
        {
          source: { $exists: false },
          tmdbId: { $ne: null },
        },
      ];
    }

    // 🔹 NEW: limit support (default + hard cap)
    const limitRaw = req.query.limit;
    let limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = 60;                   // sensible default for grids/sliders
    }
    limit = Math.min(limit, 200);    // safety cap

    const movies = await Movie.find(filter)
      .select(
        "title thumbnail banner year genres kidsOnly isTrending tmdbId type rating createdAt source"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(movies);
  } catch (err) {
    console.error("GET /type/:type error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/by-tmdb/:tmdbId", async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    if (!tmdbId) return res.status(400).json({ message: "Invalid tmdbId" });

    const raw = String(req.query.type || "movie").toLowerCase();
    const allowed = ["movie", "series", "anime", "kdrama", "cdrama"];
    const requestedType = allowed.includes(raw) ? raw : "movie";

    // ✅ 1) If anything exists with this tmdbId, RETURN IT (ignore type mismatch)
    const any = await Movie.findOne({ tmdbId });
    if (any) return res.json(any);

    // ✅ 2) Not in DB → fetch from TMDB and create
    const media = requestedType === "movie" ? "movie" : "tv";
    const data = await fetchTmdbAnyStructure(tmdbId, media);

    if (!data?.title) {
      return res.status(502).json({ message: "TMDB мэдээлэл буцаасангүй" });
    }

    const created = await Movie.create({
      tmdbId,
      source: "tmdb",
      type: requestedType,
      isEdited: false,
      title: data.title,
      description: data.description || "",
      year: data.year || "",
      rating: data.rating || 0,
      genres: data.genres || [],
      thumbnail: data.thumbnail,
      banner: data.banner,
      seasons: data.seasons || [],
    });

    return res.json(created);
  } catch (e) {
    console.error("by-tmdb error:", e);

    // ✅ handle duplicate key race safely
    if (e?.code === 11000) {
      const tmdbId = Number(req.params.tmdbId);
      const existing = await Movie.findOne({ tmdbId });
      if (existing) return res.json(existing);
    }

    return res.status(500).json({ message: e.message || "Server error" });
  }
});

// ✅ Get many movies/series by TMDB IDs (for homepage override)
router.get("/by-tmdb-many", async (req, res) => {
  try {
    const idsRaw = String(req.query.ids || "").trim();
    if (!idsRaw) return res.json([]);

    const ids = idsRaw
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n));

    const docs = await Movie.find({ tmdbId: { $in: ids } })
      .select("tmdbId title description thumbnail banner isEdited type");

    res.json(docs);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ===============================
// 🛠 ADMIN: SYNC A TV SHOW BY TMDB ID
// ===============================
router.get("/admin/tmdb-tv-sync/:tmdbId", async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.tmdbId, 10);
    if (!tmdbId) {
      return res.status(400).json({ message: "Invalid tmdbId" });
    }

    const tvData = await fetchTmdbTvStructure(tmdbId);

    // find existing series by tmdbId OR create new one
    let movie = await Movie.findOne({ tmdbId, type: "series" });

    if (!movie) {
      movie = new Movie({
        tmdbId,
        type: "series",
        title: tvData.title,
      });
    }

    movie.tmdbId = tmdbId;
    movie.type = "series";
    movie.title = tvData.title;
    movie.description = tvData.description;
    movie.year = tvData.year;
    movie.rating = tvData.rating;
    movie.genres = tvData.genres;
    if (tvData.thumbnail) movie.thumbnail = tvData.thumbnail;
    if (tvData.banner) movie.banner = tvData.banner;

    movie.seasons = tvData.seasons;
    movie.isEdited = false;

    await movie.save();

    res.json({
      ok: true,
      movieId: movie._id,
      tmdbId,
      seasonsCount: movie.seasons.length,
    });
  } catch (err) {
    console.error("tmdb-tv-sync error", err);
    res.status(500).json({
      message: err.message || "TMDB TV sync failed",
    });
  }
});

// ===============================
// GET /api/movies/tmdb/kdrama  (Korean TV only)
// ===============================
router.get("/tmdb/kdrama", async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const key = process.env.TMDB_API_KEY;
    if (!key) {
      return res.status(500).json({ message: "TMDB_API_KEY missing" });
    }

    // UI language from query (?lang=mn or ?lang=en)
    const uiLang = (req.query.lang || "en").toLowerCase();
    const tmdbLang = uiLang === "mn" ? "mn-MN" : "en-US";

    const tmdbRes = await axios.get(
      "https://api.themoviedb.org/3/discover/tv",
      {
        params: {
          api_key: key,
          sort_by: "popularity.desc",
          with_original_language: "ko", // ✅ only Korean shows
          include_adult: false,
          page,
          language: "en-US",
        },
      }
    );

    const raw = Array.isArray(tmdbRes.data?.results)
      ? tmdbRes.data.results
      : [];

    const results = raw
      .filter((r) => r.poster_path || r.backdrop_path)
      .map((r) => ({
        tmdbId: r.id,
        title: r.name || r.original_name || r.title || r.original_title,
        description: r.overview || "",
        year: (r.first_air_date || "").slice(0, 4),
        rating: r.vote_average || 0,
        genres: ["K-Drama"],
        thumbnail: r.poster_path
          ? `https://image.tmdb.org/t/p/w600_and_h900_face${r.poster_path}`
          : null,
        banner: r.backdrop_path
          ? `https://image.tmdb.org/t/p/original${r.backdrop_path}`
          : null,
      }));

    return res.json({ page, results });
  } catch (err) {
    console.error("TMDB KDRAMA error:", err.message);
    return res.status(500).json({ message: "Failed to load TMDB KDRAMA" });
  }
});

// ===============================
// GET /api/movies/tmdb/anime
router.get("/tmdb/anime", async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const key = process.env.TMDB_API_KEY;
    if (!key) {
      return res.status(500).json({ message: "TMDB_API_KEY missing" });
    }

    const tmdbRes = await axios.get(
      "https://api.themoviedb.org/3/discover/tv",
      {
        params: {
          api_key: key,
          with_genres: "16",           // 16 = Animation
          sort_by: "popularity.desc",
          page,
          language: "en-US",           // 🔴 force ENGLISH titles/overview
        },
      }
    );

    const raw = Array.isArray(tmdbRes.data?.results)
      ? tmdbRes.data.results
      : [];

    const results = raw.map((r) => ({
      tmdbId: r.id,
      // 🟢 prefer localized English name/title, THEN fallback
      title: r.name || r.title || r.original_name || r.original_title,
      description: r.overview || "",
      rating: r.vote_average || 0,
      thumbnail: r.poster_path
        ? `https://image.tmdb.org/t/p/w600_and_h900_face${r.poster_path}`
        : null,
      banner: r.backdrop_path
        ? `https://image.tmdb.org/t/p/original${r.backdrop_path}`
        : null,
      genres: ["Anime"],
    }));

    return res.json({ page, results });
  } catch (err) {
    console.error("TMDB anime error:", err.message);
    return res.status(500).json({ message: "Failed to load TMDB anime" });
  }
});

router.get("/recommended", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1) last watched (your Progress uses userId ✅)
    const last = await Progress.findOne({ userId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate("movieId")
      .lean();

    const base = last?.movieId;

    // 2) build "seen" list = watched + favorites + base
    const watched = await Progress.find({ userId }).select("movieId").lean();
    const watchedIds = watched.map((p) => String(p.movieId)).filter(Boolean);

    const user = await User.findById(userId).select("favorites").lean();
    const favIds = (user?.favorites || []).map((id) => String(id));

    const seenIds = [...new Set([...(base?._id ? [String(base._id)] : []), ...watchedIds, ...favIds])];

    // 3) if no history → safe fallback
    if (!base?._id) {
      const fallback = await Movie.find({
        _id: { $nin: seenIds },
        type: { $in: ["movie", "series", "anime", "cdrama", "kdrama"] },
      })
        .select("title thumbnail banner year tmdbId type rating genres")
        .sort({ isTrending: -1, createdAt: -1 })
        .limit(24)
        .lean();

      return res.json(fallback);
    }

    // 4) recommend same type + same genres (if genres exist)
    const genres = Array.isArray(base.genres) ? base.genres.filter(Boolean) : [];

    let rec = await Movie.find({
      _id: { $nin: seenIds },
      type: base.type,
      ...(genres.length ? { genres: { $in: genres } } : {}),
    })
      .select("title thumbnail banner year tmdbId type rating genres")
      .sort({ rating: -1, isTrending: -1, createdAt: -1 })
      .limit(40)
      .lean();

    // 5) if genres empty OR no results → fallback to same type newest
    if (!rec.length) {
      rec = await Movie.find({
        _id: { $nin: seenIds },
        type: base.type,
      })
        .select("title thumbnail banner year tmdbId type rating genres")
        .sort({ isTrending: -1, createdAt: -1 })
        .limit(40)
        .lean();
    }

    return res.json(rec);
  } catch (err) {
    console.error("Recommended error:", err);
    return res.json([]);
  }
});

// 🔍 ADMIN: search local Mongo movies (for admin adult picker)
router.get("/admin/search-local", adminOnly, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);

    const safe = escapeRegex(q);

    const results = await Movie.find(
      { title: { $regex: safe, $options: "i" } },
      "title thumbnail banner year type rating tmdbId isAdult popularity createdAt"
    )
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json(results);
  } catch (e) {
    return res.status(500).json({ message: "Server error" });
  }
});

// 🔞 ADMIN: mark/unmark as 18+
// - if popularity not provided -> auto fetch from TMDB using tmdbId
router.patch("/admin/adult/:id", adminOnly, async (req, res) => {
  try {
    const id = req.params.id;

    const isAdult = req.body.isAdult === true || req.body.isAdult === "true";

    // Find movie first (we need tmdbId + type)
    const doc = await Movie.findById(id).select("tmdbId type").lean();
    if (!doc) return res.status(404).json({ message: "Movie not found" });

    // If admin manually sends popularity -> use it
    const popularityRaw = req.body.popularity;
    let popularity =
      popularityRaw === undefined || popularityRaw === null
        ? undefined
        : Number(popularityRaw);

    // If NOT provided -> fetch from TMDB
    if (!Number.isFinite(popularity)) {
      const key = process.env.TMDB_API_KEY;
      if (!key) {
        return res.status(500).json({ message: "TMDB_API_KEY missing" });
      }
      if (!doc.tmdbId) {
        // no tmdbId => can't auto fetch popularity
        popularity = 0;
      } else {
        // movie -> /movie, everything else -> /tv
        const tmdbType = doc.type === "movie" ? "movie" : "tv";

        const tmdbRes = await axios.get(
          `https://api.themoviedb.org/3/${tmdbType}/${doc.tmdbId}`,
          { params: { api_key: key, language: "en-US" } }
        );

        popularity = Number(tmdbRes.data?.popularity || 0);
        if (!Number.isFinite(popularity)) popularity = 0;
      }
    }

    const updates = { isAdult, popularity };

    const movie = await Movie.findByIdAndUpdate(id, updates, { new: true })
      .select("title isAdult popularity tmdbId type")
      .lean();

    return res.json({ ok: true, movie });
  } catch (e) {
    console.error("adult toggle error:", e?.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// 🔞 PUBLIC: adult list (sorted by popularity desc)
router.get("/adult", async (req, res) => {
  try {
    const limitRaw = req.query.limit;
    let limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 60;
    limit = Math.min(limit, 200);

    const list = await Movie.find({ isAdult: true })
      .select("title thumbnail banner year type rating tmdbId popularity createdAt")
      .sort({ popularity: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json(list);
  } catch (e) {
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id)
      .select(
        "title description year rating genres kidsOnly isTrending thumbnail banner type tmdbId seasons subtitles player1 player2 player3 hlsPath createdAt source"
      )
      .lean();

    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    // ✅ ALWAYS use your own streams (like before)
    const streams = [];
    if (movie.player1) {
      streams.push({
        id: 1,
        label: "Server 1",
        url: `${baseUrl}/api/movies/${movie._id}/stream/1.m3u8`,
      });
    }
    if (movie.player2) {
      streams.push({
        id: 2,
        label: "Server 2",
        url: `${baseUrl}/api/movies/${movie._id}/stream/2.m3u8`,
      });
    }
    if (movie.player3) {
      streams.push({
        id: 3,
        label: "Server 3",
        url: `${baseUrl}/api/movies/${movie._id}/stream/3.m3u8`,
      });
    }

    delete movie.player1;
    delete movie.player2;
    delete movie.player3;

    movie.streams = streams;

    return res.json(movie);
  } catch (err) {
    console.error("Get movie error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ STREAM CHECK (start player)
router.get("/:id/stream",
  authMiddleware,
  subscriptionCheck,
  deviceLimit,
  (req, res) => {
    // If we arrive here, subscription is OK and device is allowed
    return res.json({ ok: true });
  }
);

// ✅ STOP STREAM (when leaving movie page)
router.post("/:id/stream/stop",
  authMiddleware,
  async (req, res) => {
    try {
      const deviceId = req.headers["x-device-id"];

      if (!deviceId) {
        return res.status(400).json({ message: "Missing device ID" });
      }

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Turn off streaming for this device
      user.devices.forEach((d) => {
        if (d.deviceId === deviceId) {
          d.isStreaming = false;
          d.lastActive = new Date();
        }
      });

      if (user.activeStreamDeviceId === deviceId) {
        user.activeStreamDeviceId = null;
      }

      await user.save();
      return res.json({ ok: true });
    } catch (err) {
      console.error("Error in /stream/stop:", err);
      return res.status(500).json({ message: "Internal error" });
    }
  }
);

// ✅ CHECK STREAM STATUS (used for forced logout on other devices)
router.get("/:id/stream/status",
  authMiddleware,
  async (req, res) => {
    try {
      const deviceId = req.headers["x-device-id"];
      if (!deviceId) {
        return res.status(400).json({
          message: "Device ID is required.",
          code: "NO_DEVICE_ID",
        });
      }

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // ✅ always make sure we have an array
      if (!Array.isArray(user.devices)) {
        user.devices = [];
      }

      let thisDevice = user.devices.find((d) => d.deviceId === deviceId);

      // ✅ CASE 1: user has *no* devices saved yet
      // → first time login / old account: just register this device
      if (!thisDevice && user.devices.length === 0) {
        user.devices.push({
          deviceId,
          isStreaming: false,
          userAgent: req.headers["user-agent"] || "",
          createdAt: new Date(),
          lastActive: new Date(),   // ✅ add
        });
        await user.save();
        thisDevice = user.devices[0];
      }

      // ✅ CASE 2: devices exist but this device is not in list
      // → it really was removed from /account/devices
      if (!thisDevice) {
        return res.status(403).json({
          code: "DEVICE_REMOVED",
          message:
            "Таны энэ төхөөрөмжийг идэвхтэй төхөөрөмжийн жагсаалтаас устгасан тул дахин нэвтэрч үзнэ үү.",
        });
      }

      // ✅ Heartbeat: this device is alive (prevents TTL from expiring it)
      thisDevice.lastActive = new Date();
      thisDevice.lastIP = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip;

      // ✅ TTL: treat old streaming device as NOT really watching
      const STREAM_TTL_MS = 90 * 1000;
      const now = Date.now();

      // 🔎 find the device that is considered 'active'
      let activeDevice = null;
      if (user.activeStreamDeviceId) {
        activeDevice = user.devices.find(
          (d) => d.deviceId === user.activeStreamDeviceId
        ) || null;
      }

      // ✅ CASE 3: if there is a real active streaming device
      // and it's NOT this one → kick with DEVICE_LIMIT
      const activeLast = activeDevice?.lastActive ? new Date(activeDevice.lastActive).getTime() : 0;
      const activeIsFresh = activeLast && (now - activeLast) <= STREAM_TTL_MS;

      if (
        activeDevice &&
        activeDevice.deviceId !== deviceId &&
        activeDevice.isStreaming &&
        activeIsFresh
      ) {
        return res.status(403).json({
          code: "DEVICE_LIMIT",
          message:
            "Өөр төхөөрөмж дээр кино тоглож байна. MNFlix нь нэг аккаунтаар зэрэг хоёр төхөөрөмж дээр үзэхийг зөвшөөрдөггүй.",
        });
      }

      // ✅ CASE 4: no real active streaming device
      // (maybe activeStreamDeviceId is stale)
      // → clean up and allow
      const activeLast2 = activeDevice?.lastActive ? new Date(activeDevice.lastActive).getTime() : 0;
      const activeIsFresh2 = activeLast2 && (now - activeLast2) <= STREAM_TTL_MS;

      if (!activeDevice || !activeDevice.isStreaming || !activeIsFresh2) {
        user.activeStreamDeviceId = null;

        // clear all streaming flags if "active" is stale/dead
        user.devices.forEach((d) => {
          d.isStreaming = false;
        });

        await user.save();
      } else {
        // still save heartbeat updates
        await user.save();
      }

      // ✅ finally, all good
      return res.json({ ok: true });
    } catch (err) {
      console.error("stream status error:", err);
      return res.status(500).json({ message: "Internal error" });
    }
  }
);

async function fetchTmdbTvStructure(tmdbId) {
  const cacheKey = `tv-${tmdbId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error("TMDB_API_KEY not set in .env");
  }

  const tvRes = await axios.get(
    `https://api.themoviedb.org/3/tv/${tmdbId}`,
    {
      params: {
        api_key: key,
        language: "en-US",
      },
    }
  );

  const tv = tvRes.data;
  if (!tv || !Array.isArray(tv.seasons)) {
    throw new Error("TMDB did not return seasons for this TV show");
  }

  const seasons = tv.seasons
    .filter((s) => s.season_number > 0 && s.episode_count > 0)
    .map((s) => {
      const episodes = [];
      for (let epNum = 1; epNum <= s.episode_count; epNum++) {
        episodes.push({
          episodeNumber: epNum,
          title: `Episode ${epNum}`,
          player: "cinepro",
        });
      }
      return {
        seasonNumber: s.season_number,
        episodes,
      };
    });

  const result = {
    title: tv.name,
    description: tv.overview,
    year: (tv.first_air_date || "").slice(0, 4),
    rating: tv.vote_average || 0,
    genres: Array.isArray(tv.genres) ? tv.genres.map((g) => g.name) : [],
    thumbnail: tv.poster_path
      ? `https://image.tmdb.org/t/p/w600_and_h900_face${tv.poster_path}`
      : undefined,
    banner: tv.backdrop_path
      ? `https://image.tmdb.org/t/p/original${tv.backdrop_path}`
      : undefined,
    seasons,
  };

  setCache(cacheKey, result);

  return result;
}

async function fetchTmdbAnyStructure(tmdbId, media) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY not set");

  const type = media === "movie" ? "movie" : "tv";

  const r = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}`, {
    params: { api_key: key, language: "en-US" },
  });

  const d = r.data;

  // 🎬 MOVIE
  if (media === "movie") {
    return {
      title: d.title || d.original_title,
      description: d.overview || "",
      year: (d.release_date || "").slice(0, 4),
      rating: d.vote_average || 0,
      genres: Array.isArray(d.genres) ? d.genres.map((g) => g.name) : [],
      thumbnail: d.poster_path
        ? `https://image.tmdb.org/t/p/w600_and_h900_face${d.poster_path}`
        : undefined,
      banner: d.backdrop_path
        ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
        : undefined,
      seasons: [], // movie has no seasons
    };
  }

  // 📺 TV / SERIES / ANIME / KDRAMA / CDRAMA
  return fetchTmdbTvStructure(tmdbId);
}

// ===============================
// ⚠ REPORT PROBLEM WITH MOVIE
// POST /api/movies/:id/report
// body: { message }
// ===============================
router.post("/:id/report", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    const movieId = req.params.id;
    const userId = req.user.id;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const movie = await Movie.findById(movieId).select("_id title");
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const report = await Report.create({
      movie: movie._id,
      user: userId,
      userId: userId,
      message: message.trim(),
    });

    return res.json({
      message: "Report created",
      reportId: report._id,
    });
  } catch (err) {
    console.error("Create report error:", err);
    return res.status(500).json({ message: "Failed to create report" });
  }
});

export default router;