import debug from "../utils/debug.js";
// routes/streambuddy.js
import express from "express";
import axios from "axios";

const router = express.Router();

// Upstream HuggingFace app
const UPSTREAM_BASE = "https://abhishek1996-streambuddy.hf.space/api";

/**
 * GET /api/streambuddy/extract
 * → proxies to HF /api/extract
 */
router.get("/extract", async (req, res) => {
  try {
    // keep all query params (tmdbId, type, season, episode, etc.)
    const upstreamUrl = `${UPSTREAM_BASE}/extract`;

    const upstreamRes = await axios.get(upstreamUrl, {
      params: req.query,
      timeout: 15000,
    });

    return res.json(upstreamRes.data);
  } catch (err) {
    console.error("StreamBuddy /extract error:", err?.response?.status, err.message);

    return res
      .status(err?.response?.status || 502)
      .json({ message: "StreamBuddy upstream error" });
  }
});

/**
 * GET /api/streambuddy/stream?url=...
 * → proxies to HF /api/stream (HLS)
 */
router.get("/stream", async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ message: "Missing url query param" });
    }

    const upstreamUrl = `${UPSTREAM_BASE}/stream?url=${encodeURIComponent(
      targetUrl
    )}`;

    // forward Range header for seeking
    const range = req.headers.range;

    // 🔍 log what we’re trying to stream
    debug.log("🎬 StreamBuddy /stream request", {
      targetUrl,
      upstreamUrl,
      range,
    });

    const upstreamRes = await axios.get(upstreamUrl, {
      responseType: "stream",
      headers: {
        ...(range ? { Range: range } : {}),
        // some providers are picky about UA
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      validateStatus: () => true, // let us see non-2xx
      decompress: false,
      timeout: 20000,
    });

    debug.log(
      "🎬 StreamBuddy /stream upstream status",
      upstreamRes.status,
      upstreamRes.headers["content-type"]
    );

    // if upstream failed, don’t pretend it worked
    if (upstreamRes.status < 200 || upstreamRes.status >= 300) {
      return res
        .status(upstreamRes.status)
        .end("Upstream error: " + upstreamRes.status);
    }

    // copy status + headers except transfer-encoding
    res.status(upstreamRes.status);
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      res.setHeader(key, value);
    }

    upstreamRes.data.pipe(res);

  } catch (err) {
    console.error(
      "StreamBuddy /stream error:",
      err?.response?.status,
      err.message
    );

    if (err.response) {
      res.status(err.response.status);
      return err.response.data.pipe
        ? err.response.data.pipe(res)
        : res.end();
    }

    return res.status(502).end("Upstream stream error");
  }
});

export default router;
