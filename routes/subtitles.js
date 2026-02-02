import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import Movie from "../models/Movie.js";
import { uploadSubtitleToStorage } from "../utils/storage.js";

const router = express.Router();

const subtitleUpload = multer({
  storage: multer.memoryStorage(),
});

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

// Upload subtitle for a MOVIE
router.post(
  "/:id/subtitles",
  adminOnly,
  subtitleUpload.single("subtitle"),
  async (req, res) => {
    try {
      const { lang, label, isDefault } = req.body;

      if (!req.file) {
        return res.status(400).json({ message: "No subtitle file uploaded" });
      }

      const movie = await Movie.findById(req.params.id);
      if (!movie) {
        return res.status(404).json({ message: "Movie not found" });
      }

      const url = await uploadSubtitleToStorage(req.file);

      if (!movie.subtitles) movie.subtitles = [];

      const makeDefault = isDefault === "true" || isDefault === true;
      if (makeDefault) {
        movie.subtitles.forEach((s) => {
          s.isDefault = false;
        });
      }

      movie.subtitles.push({
        lang,
        label,
        url,
        isDefault: makeDefault,
      });

      await movie.save();

      return res.json({
        message: "Subtitle uploaded",
        subtitles: movie.subtitles,
      });
    } catch (err) {
      console.error("Subtitle upload error:", err);
      return res.status(500).json({ message: "Failed to upload subtitle" });
    }
  }
);

// Upload subtitle for a specific EPISODE
router.post(
  "/:id/episode-subtitles",
  adminOnly,
  subtitleUpload.single("subtitle"),
  async (req, res) => {
    try {
      const { seasonNumber, episodeNumber, lang, label, isDefault } = req.body;

      if (!req.file) {
        return res.status(400).json({ message: "No subtitle file uploaded" });
      }

      const movie = await Movie.findById(req.params.id);
      if (!movie) {
        return res.status(404).json({ message: "Movie not found" });
      }

      const sNum = Number(seasonNumber);
      const eNum = Number(episodeNumber);
      if (!sNum || !eNum) {
        return res.status(400).json({ message: "Invalid season or episode number" });
      }

      const season = (movie.seasons || []).find(
        (s) => Number(s.seasonNumber) === sNum
      );
      if (!season) {
        return res.status(404).json({ message: "Season not found" });
      }

      const episode = (season.episodes || []).find(
        (ep) => Number(ep.episodeNumber) === eNum
      );
      if (!episode) {
        return res.status(404).json({ message: "Episode not found" });
      }

      if (!episode.subtitles) episode.subtitles = [];

      const url = await uploadSubtitleToStorage(req.file);
      const makeDefault = isDefault === "true" || isDefault === true;

      if (makeDefault) {
        episode.subtitles.forEach((s) => {
          s.isDefault = false;
        });
      }

      episode.subtitles.push({
        lang,
        label,
        url,
        isDefault: makeDefault,
      });

      await movie.save();

      return res.json({
        message: "Episode subtitle uploaded",
        seasonNumber: sNum,
        episodeNumber: eNum,
        subtitles: episode.subtitles,
      });
    } catch (err) {
      console.error("Episode subtitle upload error:", err);
      return res.status(500).json({ message: "Failed to upload episode subtitle" });
    }
  }
);

// Delete movie-level subtitle by index
router.delete("/:id/subtitles/:index", adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    if (!Array.isArray(movie.subtitles)) {
      return res.status(400).json({ message: "No subtitles on this movie" });
    }

    const idx = parseInt(req.params.index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= movie.subtitles.length) {
      return res.status(400).json({ message: "Invalid subtitle index" });
    }

    movie.subtitles.splice(idx, 1);
    await movie.save();

    return res.json({
      message: "Subtitle deleted",
      subtitles: movie.subtitles,
    });
  } catch (err) {
    console.error("Delete subtitle error:", err);
    return res.status(500).json({ message: "Failed to delete subtitle" });
  }
});

// Delete episode subtitle by index
router.delete("/:id/episode-subtitles", adminOnly, async (req, res) => {
  try {
    const { seasonNumber, episodeNumber, subIndex } = req.body;

    const sNum = Number(seasonNumber);
    const eNum = Number(episodeNumber);
    const idx = Number(subIndex);

    if (!sNum || !eNum || Number.isNaN(idx)) {
      return res.status(400).json({ message: "Invalid season/episode/index" });
    }

    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const season = (movie.seasons || []).find(
      (s) => Number(s.seasonNumber) === sNum
    );
    if (!season) {
      return res.status(404).json({ message: "Season not found" });
    }

    const episode = (season.episodes || []).find(
      (ep) => Number(ep.episodeNumber) === eNum
    );
    if (!episode) {
      return res.status(404).json({ message: "Episode not found" });
    }

    if (!Array.isArray(episode.subtitles)) {
      return res.status(400).json({ message: "No subtitles on this episode" });
    }

    if (idx < 0 || idx >= episode.subtitles.length) {
      return res.status(400).json({ message: "Invalid subtitle index" });
    }

    episode.subtitles.splice(idx, 1);
    await movie.save();

    return res.json({
      message: "Episode subtitle deleted",
      seasonNumber: sNum,
      episodeNumber: eNum,
      subtitles: episode.subtitles,
    });
  } catch (err) {
    console.error("Delete episode subtitle error:", err);
    return res.status(500).json({ message: "Failed to delete episode subtitle" });
  }
});

// Get subtitles (movie or specific episode)
router.get("/:id/subtitles", async (req, res) => {
  try {
    const { season, episode } = req.query;
    const movie = await Movie.findById(req.params.id).lean();

    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const R2_PUBLIC = process.env.R2_PUBLIC_BASE_URL
      ? process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")
      : null;

    const baseBackend = `${req.protocol}://${req.get("host")}`;

    const mapUrls = (subs = []) =>
      (subs || []).map((s) => {
        if (!s || !s.url) return s;

        if (s.url.startsWith("http://") || s.url.startsWith("https://")) {
          return s;
        }

        if (R2_PUBLIC && s.url.startsWith("/uploads/subtitles/")) {
          return {
            ...s,
            url: `${R2_PUBLIC}${s.url}`,
          };
        }

        return {
          ...s,
          url: `${baseBackend}${s.url}`,
        };
      });

    if (season && episode && Array.isArray(movie.seasons)) {
      const sNum = Number(season);
      const eNum = Number(episode);

      const seasonDoc = movie.seasons.find(
        (s) => Number(s.seasonNumber) === sNum
      );
      const episodeDoc = seasonDoc?.episodes?.find(
        (ep) => Number(ep.episodeNumber) === eNum
      );

      if (episodeDoc?.subtitles?.length) {
        return res.json(mapUrls(episodeDoc.subtitles));
      }
    }

    return res.json(mapUrls(movie.subtitles || []));
  } catch (err) {
    console.error("Subtitles fetch error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
