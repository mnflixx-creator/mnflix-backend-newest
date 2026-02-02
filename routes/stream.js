// routes/stream.js
import express from "express";
import fetch from "node-fetch"; // npm i node-fetch@2  (if you don't have it)
import Movie from "../models/Movie.js";

const router = express.Router();

/**
 * User will see ONLY:
 *   https://your-backend.com/api/movies/<movieId>/stream/1.m3u8
 *
 * Internally we read movie.player1 / player2 / player3 and call that.
 */
router.get("/movies/:id/stream/:player.m3u8", async (req, res) => {
  try {
    const { id, player } = req.params;

    // player = "1" | "2" | "3"
    const field = `player${player}`; // "player1", "player2", "player3"

    const movie = await Movie.findById(id).lean();
    if (!movie) {
      return res.status(404).send("Movie not found");
    }

    const providerUrl = movie[field];
    if (!providerUrl) {
      return res.status(400).send("No player URL for this movie/server");
    }

    // 🔒 This request happens on the server.
    // The user NEVER sees providerUrl in DevTools.
    const upstream = await fetch(providerUrl);

    if (!upstream.ok) {
      console.error("Upstream error:", upstream.status, providerUrl);
      return res.status(502).send("Stream upstream error");
    }

    // Forward important headers so player works
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ||
        "application/vnd.apple.mpegurl"
    );
    res.setHeader("Cache-Control", "no-store");

    // Pipe the m3u8 back to the client
    upstream.body.pipe(res);
  } catch (err) {
    console.error("Proxy stream error:", err);
    res.status(500).send("Stream error");
  }
});

export default router;
