import debug from "../utils/debug.js";
// routes/autoSubtitles.js
import express from "express";
import Movie from "../models/Movie.js";
import { createMnSubtitleFile } from "../services/aiSubtitleTranslator.js";

const router = express.Router();

/**
 * POST /api/subtitles/auto-mn-from-text
 *
 * Body:
 *  - movieId: Movie Mongo _id (required)
 *  - subtitleText: raw English subtitle text (.srt or .vtt) (required)
 *  - providerLang: default "en"
 *  - seasonNumber (optional)
 *  - episodeNumber (optional)
 *
 * Behaviour:
 *  - If movie-level (no season/episode) → use movie.subtitles[]
 *  - If episode-level (season+episode) → use seasons[].episodes[].subtitles[]
 */
router.post("/auto-mn-from-text", async (req, res) => {
  try {
    const {
      movieId,
      subtitleText,
      providerLang = "en",
      seasonNumber,
      episodeNumber,
    } = req.body || {};

    if (!movieId || !subtitleText) {
      return res
        .status(400)
        .json({ message: "movieId and subtitleText are required." });
    }

    const movie = await Movie.findById(movieId);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found." });
    }

    const isEpisode =
      seasonNumber != null && episodeNumber != null && movie.seasons?.length;

    // --------- 1) Check if Mongolian already exists (CACHE) ---------
    if (!isEpisode) {
      const existingMn = (movie.subtitles || []).find(
        (sub) =>
          (sub.lang && sub.lang.startsWith("mn")) ||
          /монгол|mongolian/i.test(sub.label || "") ||
          /монгол|mongolian/i.test(sub.name || "")
      );

      if (existingMn) {
        return res.json({
          message: "Mongolian subtitle already exists for this movie.",
          scope: "movie",
          cached: true,
          subtitle: existingMn,
        });
      }
    } else {
      const sNum = Number(seasonNumber);
      const eNum = Number(episodeNumber);

      const seasonDoc = movie.seasons.find(
        (s) => s.seasonNumber === sNum
      );
      if (!seasonDoc) {
        return res
          .status(404)
          .json({ message: "Season not found on this movie." });
      }

      const epDoc = seasonDoc.episodes.find(
        (ep) => ep.episodeNumber === eNum
      );
      if (!epDoc) {
        return res
          .status(404)
          .json({ message: "Episode not found on this season." });
      }

      const existingMn = (epDoc.subtitles || []).find(
        (sub) =>
          (sub.lang && sub.lang.startsWith("mn")) ||
          /монгол|mongolian/i.test(sub.label || "") ||
          /монгол|mongolian/i.test(sub.name || "")
      );

      if (existingMn) {
        return res.json({
          message: "Mongolian subtitle already exists for this episode.",
          scope: "episode",
          seasonNumber: sNum,
          episodeNumber: eNum,
          cached: true,
          subtitle: existingMn,
        });
      }
    }

    // --------- 2) Translate + save .vtt ---------
    const { publicUrl } = await createMnSubtitleFile({
      movieId,
      seasonNumber: isEpisode ? Number(seasonNumber) : 0,
      episodeNumber: isEpisode ? Number(episodeNumber) : 0,
      providerSubtitleText: subtitleText, // <-- raw EN text from frontend
    });

    // --------- 3) Push into Movie model ---------
    let createdSubtitle;

    if (!isEpisode) {
        const newSub = {
            lang: "mn",
            label: "Монгол",
            url: publicUrl,
            isDefault: true,
        };
        movie.subtitles = movie.subtitles || [];
        movie.subtitles.push(newSub);

        createdSubtitle = newSub;
            } else {
      const sNum = Number(seasonNumber);
      const eNum = Number(episodeNumber);

      const seasonDoc = movie.seasons.find(
        (s) => s.seasonNumber === sNum
      );
      const epDoc = seasonDoc.episodes.find(
        (ep) => ep.episodeNumber === eNum
      );

      epDoc.subtitles = epDoc.subtitles || [];

      const newSub = {
        lang: "mn",
        label: "Монгол",
        url: publicUrl,
        isDefault: true,
      };
      epDoc.subtitles.push(newSub);

      createdSubtitle = newSub;
    }

    await movie.save();

    debug.log("🟢 /auto-mn-from-text DONE", {
      movieId,
      scope: isEpisode ? "episode" : "movie",
      url: createdSubtitle?.url,
    });

    return res.json({
      message: "Mongolian subtitle created (from text).",
      scope: isEpisode ? "episode" : "movie",
      seasonNumber: isEpisode ? Number(seasonNumber) : undefined,
      episodeNumber: isEpisode ? Number(episodeNumber) : undefined,
      subtitle: createdSubtitle,
    });
  } catch (err) {
    console.error("auto-mn-from-text error:", err);
    return res.status(500).json({
      message: "Subtitle auto-translation failed.",
      error: err.message,
    });
  }
});

export default router;
