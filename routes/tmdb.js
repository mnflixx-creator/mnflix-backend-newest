import express from "express";
import Movie from "../models/Movie.js";
import HomeSettings from "../models/HomeSettings.js";

const router = express.Router();

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdb(path) {
  if (!TMDB_KEY) throw new Error("TMDB_API_KEY not set");

  const url = `${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB_KEY}&language=en-US`;
  const res = await fetch(url);

  // ✅ handle TMDB rate limit
  if (res.status === 429) {
    const err = new Error("TMDB rate limited");
    err.status = 429;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`TMDB error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

router.get("/ping", (req, res) => {
  res.json({ ok: true, msg: "tmdb router updated" });
});

router.get("/welcome-slider", async (req, res) => {
  try {
    let settings = await HomeSettings.findOne();
    if (!settings) {
      settings = await HomeSettings.create({});
    }

    const ids = settings.welcomeSliderTmdbIds || [];
    if (!ids.length) return res.json([]);

    // For each id: try movie first, if that fails, try TV
    const items = await Promise.all(
      ids.map(async (id) => {
        try {
          // 🎬 try as movie
          const m = await tmdb(`/movie/${id}`);
          return { ...m, media_type: m.media_type || "movie" };
        } catch (errMovie) {
          try {
            // 📺 fallback: try as TV show
            const tv = await tmdb(`/tv/${id}`);
            return { ...tv, media_type: tv.media_type || "tv" };
          } catch (errTv) {
            console.error("welcome-slider fetch failed for id", id, errTv.message);
            return null;
          }
        }
      })
    );

    res.json(items.filter(Boolean));
  } catch (e) {
    console.error("welcome-slider error:", e);
    res.status(500).json({ message: e.message });
  }
});

// Trending (movies + TV, like TMDB "All")
router.get("/trending", async (req, res) => {
  try {
    const data = await tmdb(`/trending/all/week`);

    // keep only movie + tv (skip people)
    const results = (data.results || []).filter(
      (item) => item.media_type === "movie" || item.media_type === "tv"
    );

    res.json(results);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// New releases (movies + TV currently airing)
router.get("/new", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);

    const [movieData, tvData] = await Promise.all([
      tmdb(`/movie/now_playing?page=${page}`),
      tmdb(`/tv/on_the_air?page=${page}`),
    ]);

    const movieResults = Array.isArray(movieData.results) ? movieData.results : [];
    const tvResults = Array.isArray(tvData.results) ? tvData.results : [];

    // mix + sort by date (release_date / first_air_date)
    const combined = [...movieResults, ...tvResults].sort((a, b) => {
      const dateA = new Date(a.release_date || a.first_air_date || 0);
      const dateB = new Date(b.release_date || b.first_air_date || 0);
      return dateB - dateA; // newest first
    });

    res.json(combined);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Popular (movies + TV)
router.get("/popular", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);

    const [movieData, tvData] = await Promise.all([
      tmdb(`/movie/popular?page=${page}`),
      tmdb(`/tv/popular?page=${page}`),
    ]);

    const movieResults = Array.isArray(movieData.results) ? movieData.results : [];
    const tvResults = Array.isArray(tvData.results) ? tvData.results : [];

    const combined = [...movieResults, ...tvResults].sort(
      (a, b) => (b.popularity || 0) - (a.popularity || 0)
    );

    res.json(combined);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Top rated (movies + TV)
router.get("/top", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);

    const [movieData, tvData] = await Promise.all([
      tmdb(`/movie/top_rated?page=${page}`),
      tmdb(`/tv/top_rated?page=${page}`),
    ]);

    const movieResults = Array.isArray(movieData.results) ? movieData.results : [];
    const tvResults = Array.isArray(tvData.results) ? tvData.results : [];

    const combined = [...movieResults, ...tvResults].sort(
      (a, b) => (b.vote_average || 0) - (a.vote_average || 0)
    );

    res.json(combined);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post("/import/:tmdbId", async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    if (!tmdbId) return res.status(400).json({ message: "Invalid tmdbId" });

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return res.status(500).json({ message: "TMDB_API_KEY not set" });

    // ✅ 1) If already exists, RETURN IT IMMEDIATELY (no TMDB call)
    const existing = await Movie.findOne({ tmdbId });
    if (existing) {
      // if old bad data says "series" but it has no seasons, treat it as movie
      if (existing.type === "series" && (!existing.seasons || existing.seasons.length === 0)) {
        existing.type = "movie";
        existing.seasons = []; // keep empty
        await existing.save();
      }
      return res.json({ ok: true, movie: existing, already: true });
    }

    // ✅ 2) Fetch from TMDB (movie first, then tv)
    let m = null;
    let mediaType = "movie";

    let r = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=en-US`
    );

    // ✅ If rate limited, tell frontend to retry (don’t pretend “import failed”)
    if (r.status === 429) {
      return res.status(503).json({ message: "TMDB rate limited. Try again." });
    }

    if (!r.ok) {
      return res.status(409).json({
        message: "This TMDB id is a TV series. Use /import-tv instead.",
        mediaType: "tv",
        tmdbId,
      });
    }

    m = await r.json(); // ✅ ADD THIS LINE

    const commonTitle =
      m.title || m.name || m.original_title || m.original_name || "";

    const poster = m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : "";
    const backdrop = m.backdrop_path
      ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
      : "";

    const year = (
      mediaType === "movie" ? (m.release_date || "") : (m.first_air_date || "")
    ).slice(0, 4);

    let doc;
      try {
        doc = await Movie.create({
          tmdbId: m.id,
          type: "movie", // ✅ always movie here
          title: commonTitle,
          description: m.overview || "",
          year,
          thumbnail: poster,
          banner: backdrop,
          isTrending: true,
        });
      } catch (err) {
        // ✅ If another request already created this tmdbId, return existing
        if (err?.code === 11000) {
          const existing2 = await Movie.findOne({ tmdbId: m.id });
          if (existing2) return res.json({ ok: true, movie: existing2, already: true });
        }
        throw err;
      }

      return res.json({ ok: true, movie: doc });
  } catch (e) {
    console.error("/api/tmdb/import error:", e);
    return res.status(500).json({ message: e.message });
  }
});

router.get("/discover/newest", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);

    const url =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${process.env.TMDB_API_KEY}` +
      `&language=en-US` +
      `&sort_by=primary_release_date.desc` +
      `&include_adult=false` +
      `&include_video=false` +
      `&page=${page}`;

    const r = await fetch(url);
    if (!r.ok) return res.status(400).json({ message: "TMDB discover failed" });

    const data = await r.json();
    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get("/discover/popular", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);

    const url =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${process.env.TMDB_API_KEY}` +
      `&language=en-US` +
      `&sort_by=popularity.desc` +
      `&include_adult=false` +
      `&include_video=false` +
      `&page=${page}`;

    const r = await fetch(url);
    if (!r.ok) return res.status(400).json({ message: "TMDB discover failed" });

    const data = await r.json();
    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get("/movie/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const url =
      `https://api.themoviedb.org/3/movie/${id}` +
      `?api_key=${process.env.TMDB_API_KEY}` +
      `&language=en-US`;

    const r = await fetch(url);
    if (!r.ok) return res.status(404).json({ message: "Not found" });

    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Search by name
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const page = Number(req.query.page || 1);

    if (!q) return res.json([]);

    const data = await tmdb(
      `/search/movie?query=${encodeURIComponent(q)}&include_adult=false&page=${page}`
    );

    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// TMDB Movie Genres list
router.get("/genres", async (req, res) => {
  try {
    const data = await tmdb(`/genre/movie/list`);
    res.json(data.genres || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// TMDB TV Popular
router.get("/tv/popular", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const data = await tmdb(`/tv/popular?page=${page}`);
    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// TMDB TV Genres
router.get("/tv/genres", async (req, res) => {
  try {
    const data = await tmdb(`/genre/tv/list`);
    res.json(data.genres || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// TMDB TV detail
router.get("/tv/:id", async (req, res) => {
  try {
    const data = await tmdb(`/tv/${req.params.id}`);
    res.json(data);
  } catch (e) {
    res.status(404).json({ message: "Not found" });
  }
});

router.post("/import-tv/:tmdbId", async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    if (!tmdbId) return res.status(400).json({ message: "Invalid tmdbId" });

    // ✅ return existing immediately
    const existing = await Movie.findOne({ tmdbId, type: "series" });
    if (existing) return res.json({ ok: true, series: existing, already: true });

    // ✅ fetch TV details safely (handle 429)
    const apiKey = process.env.TMDB_API_KEY;
    const r = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&language=en-US`
    );

    if (r.status === 429) {
      return res.status(503).json({ message: "TMDB rate limited. Try again." });
    }
    if (!r.ok) {
      return res.status(400).json({ message: `TMDB fetch failed (${r.status})` });
    }

    const m = await r.json();

    const commonTitle =
      m.name || m.title || m.original_name || m.original_title || "";

    let doc;
      try {
        doc = await Movie.create({
          tmdbId: m.id,
          type: "series",
          title: commonTitle,
          description: m.overview || "",
          year: (m.first_air_date || "").slice(0, 4),
          thumbnail: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : "",
          banner: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : "",
        });
      } catch (err) {
        // ✅ If another request already created this tmdbId, return existing
        if (err?.code === 11000) {
          const existing2 = await Movie.findOne({ tmdbId: m.id, type: "series" });
          if (existing2) return res.json({ ok: true, series: existing2, already: true });
        }
        throw err;
      }

      return res.json({ ok: true, series: doc });
  } catch (e) {
    console.error("/api/tmdb/import-tv error:", e);
    return res.status(500).json({ message: e.message });
  }
});

// TMDB TV Discover Popular (same style as your movie discover/popular)
router.get("/tv/discover/popular", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const data = await tmdb(`/discover/tv?sort_by=popularity.desc&page=${page}`);
    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// TMDB TV Discover Newest (by first_air_date)
router.get("/tv/discover/newest", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const data = await tmdb(`/discover/tv?sort_by=first_air_date.desc&page=${page}`);
    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// TMDB TV Search
router.get("/tv/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const page = Number(req.query.page || 1);
    if (!q) return res.json([]);

    const data = await tmdb(
      `/search/tv?query=${encodeURIComponent(q)}&include_adult=false&page=${page}`
    );

    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
