// backend/routes/animeMeta.js
import express from "express";
import axios from "axios";
import Movie from "../models/Movie.js";

const router = express.Router();

const JIKAN_BASE = "https://api.jikan.moe/v4";

/**
 * GET /api/anime/mal/search?q=...
 *
 * For admin search modal:
 *   - q = text user typed (Naruto, One Piece, etc.)
 */
router.get("/mal/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const page = Number(req.query.page || 1);

    if (!q) {
      return res.status(400).json({ message: "Missing q query parameter" });
    }

    const upstream = await axios.get(`${JIKAN_BASE}/anime`, {
      params: {
        q,
        page,
        order_by: "members", // popular first
        sort: "desc",
        sfw: false,
      },
      timeout: 15000,
    });

    const list = (upstream.data?.data || []).map((item) => ({
      malId: item.mal_id,
      title:
        item.title_english ||
        item.title ||
        item.title_japanese ||
        (item.titles && item.titles[0]?.title) ||
        "Untitled",
      originalTitle: item.title_japanese || "",
      year:
        item.year ??
        item.aired?.prop?.from?.year ??
        null,
      type: item.type || "TV",
      episodes: item.episodes || 0,
      status: item.status || "",
      score: item.score || null,
      image: item.images?.jpg?.image_url || null,
    }));

    return res.json({
      count: list.length,
      results: list,
    });
  } catch (e) {
    console.error("❌ Jikan search error:", e.message);
    return res.status(502).json({ message: "Jikan search error" });
  }
});

/**
 * POST /api/anime/mal/import/:malId
 *
 * Creates/updates a Movie doc using MAL data
 */
router.post("/mal/import/:malId", async (req, res) => {
  try {
    const malId = Number(req.params.malId);
    if (!malId) {
      return res.status(400).json({ message: "Invalid malId" });
    }

    // full details for this anime
    const upstream = await axios.get(`${JIKAN_BASE}/anime/${malId}/full`, {
      timeout: 15000,
    });

    const data = upstream.data?.data;
    if (!data) {
      return res.status(404).json({ message: "Anime not found on Jikan/MAL" });
    }

    const title =
      data.title_english ||
      data.title ||
      data.title_japanese ||
      (data.titles && data.titles[0]?.title) ||
      "Untitled";

    const originalTitle = data.title_japanese || "";
    const description = data.synopsis || "";
    const year =
      data.year ??
      data.aired?.prop?.from?.year ??
      null;
    const genres = (data.genres || []).map((g) => g.name);
    const episodes = data.episodes || 0;
    const status = data.status || "";
    const thumb = data.images?.jpg?.image_url || "";
    const banner = data.images?.jpg?.large_image_url || thumb;
    const score = data.score ?? 0;

    // If already imported before, update it
    let movie = await Movie.findOne({ malId });

    if (!movie) {
      movie = new Movie({
        malId,
        source: "mal",          // 👈 uses your schema enum: ["tmdb","manual","mal"]
        type: "anime",          // 👈 important so it shows on your /anime page
        title,
        originalTitle,
        description,
        year: year ? String(year) : "",
        genres,
        episodes,
        status,
        thumbnail: thumb,
        banner,
        rating: score,
      });
    } else {
      movie.malId = malId;
      movie.source = "mal";
      movie.type = "anime";
      movie.title = title;
      movie.originalTitle = originalTitle;
      movie.description = description;
      movie.year = year ? String(year) : movie.year;
      movie.genres = genres;
      movie.episodes = episodes;
      movie.status = status;

      if (!movie.thumbnail && thumb) movie.thumbnail = thumb;
      if (!movie.banner && banner) movie.banner = banner;
      if (!movie.rating && score) movie.rating = score;
    }

    await movie.save();

    return res.json({
      success: true,
      movie,
    });
  } catch (e) {
    console.error(
      "❌ Jikan import error:",
      e.response?.status,
      e.message
    );

    if (e.response) {
      return res
        .status(e.response.status)
        .json({ message: "Upstream error from Jikan" });
    }
    return res.status(502).json({ message: "Jikan import failed" });
  }
});

export default router;
