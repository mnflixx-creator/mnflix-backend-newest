import debug from "../utils/debug.js";
// backend/routes/zentlify.js
import express from "express";
import axios from "axios";
import StreamCache from "../models/StreamCache.js"; // ✅ NEW

const router = express.Router();

const ZENTLIFY_API_KEY = process.env.ZENTLIFY_API_KEY;
const ZENTLIFY_BASE = "https://zentlify.qzz.io/api/streams";

// ✅ MAIN + 2 FALLBACK gateways (same API shape)
const ZENTLIFY_BASES = [
  "https://zentlify.qzz.io/api/streams",
  "https://anya-gw-1.mnflix-mirror.workers.dev/api/streams",
  "https://anya-gw-2.mnflix-mirror2.workers.dev/api/streams",
];

// ✅ retry only on rate-limit / server errors / timeouts
function isRetryableAxiosError(err) {
  const status = err?.response?.status;

  // timeout / network error (no response)
  if (!err?.response) return true;

  // rate limited or server errors
  if (status === 429) return true;
  if (status >= 500) return true;

  return false;
}

function shuffledBases(bases) {
  const arr = [...bases];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function axiosGetWithFallback(fullUrl, config) {
  let lastErr;

  // Randomize base order per request to distribute load, while keeping
  // retry-on-error behavior across remaining bases.
  for (const base of shuffledBases(ZENTLIFY_BASES)) {
    // swap base while keeping the same path
    const url = fullUrl.replace("https://zentlify.qzz.io/api/streams", base);

    try {
      const res = await axios.get(url, config);
      return { res, usedBase: base };
    } catch (err) {
      lastErr = err;

      // ✅ only retry if it’s retryable
      if (isRetryableAxiosError(err)) {
        debug.warn(
          "⚠️ Zentlify gateway failed, trying next:",
          base,
          err?.response?.status || err.message
        );
        continue;
      }

      // ❌ non-retryable (401/403/404 etc) → stop immediately
      throw err;
    }
  }

  throw lastErr;
}

// ✅ how long cache is considered "fresh" (3 hours)
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

// helper: sort providers (lush first, then others)
function sortStreams(streams = []) {
  const order = ["lush", "flow", "sonata", "breeze", "nova", "zen", "neko"];
  return [...streams].sort((a, b) => {
    const pa = (a.provider || a.name || "").toLowerCase();
    const pb = (b.provider || b.name || "").toLowerCase();

    const ia = order.indexOf(pa);
    const ib = order.indexOf(pb);

    const sa = ia === -1 ? 99 : ia;
    const sb = ib === -1 ? 99 : ib;

    return sa - sb;
  });
}

// small helper to check if cache is still fresh
function isFresh(cachedAt) {
  if (!cachedAt) return false;
  return Date.now() - new Date(cachedAt).getTime() < CACHE_TTL_MS;
}

/* ---------------- MOVIE ---------------- */
router.get("/movie/:tmdbId", async (req, res) => {
  try {
    if (!ZENTLIFY_API_KEY) {
      return res
        .status(500)
        .json({ message: "Missing ZENTLIFY_API_KEY in .env" });
    }

        // 🚫 Disable HTTP caching for this endpoint
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const { tmdbId } = req.params;
    const { title = "" } = req.query; // ⭐ NEW
    const numericTmdbId = Number(tmdbId) || 0;

    // ✅ 1) TRY CACHE FIRST
    const cacheKey = {
      tmdbId: numericTmdbId,
      type: "movie",
      season: null,
      episode: null,
    };

    let existingCache = await StreamCache.findOne(cacheKey).lean();

    // ❗ Only use cache when NO title is passed
    if (!title && existingCache && isFresh(existingCache.cachedAt)) {
    debug.log(
        "🎬 Zentlify movie: returning FRESH cached streams:",
        existingCache.streams.length
    );
    return res.json({
        tmdbId: existingCache.tmdbId || tmdbId,
        count: (existingCache.streams || []).length,
        streams: existingCache.streams || [],
        cached: true,
        fresh: true,
    });
    }

    // ✅ 2) CALL ZENTLIFY (MAIN providers - NO title)
    const upstreamUrl = `${ZENTLIFY_BASE}/movie/${tmdbId}`;
    debug.log("🎬 Zentlify movie upstream:", upstreamUrl);

    // ⬇️ NEW: don't throw if this fails, just log it
    let data = {};
    let mainStreams = [];

    try {
      const { res: upstream, usedBase } = await axiosGetWithFallback(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${ZENTLIFY_API_KEY}`,
        },
        timeout: 15000,
      });

      debug.log("✅ Zentlify movie gateway used:", usedBase);

      data = upstream.data || {};
      mainStreams = Array.isArray(data.streams) ? data.streams : [];
    } catch (mainErr) {
      debug.warn(
        "⚠️ Zentlify movie main stream error:",
        mainErr?.response?.status,
        mainErr.message
      );
    }

    let combinedStreams = [...mainStreams];

    // ⭐ Also try Flow for MOVIE if we have a title (multi-quality MP4)
    if (title) {
      const cleanTitle = String(title || "").trim();
      const normalized = cleanTitle.replace(/\s+/g, " ");
      const tryTitles = [cleanTitle, normalized, normalized.toLowerCase()];

      let flowStreams = [];

      for (const t of tryTitles) {
        if (!t) continue;

        const flowQuery = new URLSearchParams({ title: t }).toString();
        const flowUrl = `${ZENTLIFY_BASE}/flow/movie/${tmdbId}?${flowQuery}`;
        debug.log("🎥 Flow movie upstream:", flowUrl);

        try {
          const { res: flowRes, usedBase } = await axiosGetWithFallback(flowUrl, {
            headers: { Authorization: `Bearer ${ZENTLIFY_API_KEY}` },
            timeout: 15000,
          });

          debug.log("✅ Flow movie gateway used:", usedBase);

          const flowData = flowRes.data || {};
          flowStreams = Array.isArray(flowData.streams) ? flowData.streams : [];

          debug.log("🧪 FLOW FULL RESPONSE:", {
            triedTitle: t,
            status: flowRes.status,
            data: flowRes.data,
          });

          if (flowStreams.length) break;
        } catch (flowErr) {
          debug.warn(
            "⚠️ Flow movie error:",
            flowErr?.response?.status,
            flowErr.message
          );
        }
      }

      if (flowStreams.length) {
        debug.log("🎥 Flow movie streams:", flowStreams.length);
        combinedStreams = combinedStreams.concat(flowStreams);
      }
    }

    // 🔁 If upstream has no Flow now but cache has Flow, reuse cached Flow
    if (existingCache && Array.isArray(existingCache.streams)) {
      const hasFlowNow = combinedStreams.some((s) => {
        const p = (s.provider || s.name || "").toLowerCase();
        return p.includes("flow");
      });

      if (!hasFlowNow) {
        const cachedFlow = existingCache.streams.filter((s) => {
          const p = (s.provider || s.name || "").toLowerCase();
          return p.includes("flow");
        });

        if (cachedFlow.length) {
          debug.log(
            "♻️ Reusing cached Flow movie streams from DB:",
            cachedFlow.length
          );
          combinedStreams = combinedStreams.concat(cachedFlow);
        }
      }
    }

    const sorted = sortStreams(combinedStreams);

    debug.log(
      "🎬 Zentlify movie streams:",
      sorted.map((s) => ({
        title: s.title,
        provider: s.provider,
      }))
    );

    // ✅ 3) IF ZENTLIFY GIVES STREAMS → SAVE + RETURN
    if (sorted.length > 0) {
      await StreamCache.findOneAndUpdate(
        cacheKey,
        {
          ...cacheKey,
          streams: sorted,
          cachedAt: new Date(),
        },
        { upsert: true }
      );

      return res.json({
        tmdbId: data.tmdbId || tmdbId,
        count: sorted.length,
        streams: sorted,
        cached: false,
        fresh: true,
      });
    }

    // ✅ 4) ZENTLIFY RETURNED [] BUT WE HAVE OLD CACHE → FALLBACK
    if (existingCache && (existingCache.streams || []).length > 0) {
      debug.log(
        "🎬 Zentlify movie: upstream empty, using STALE cache:",
        existingCache.streams.length
      );
      return res.json({
        tmdbId: existingCache.tmdbId || tmdbId,
        count: (existingCache.streams || []).length,
        streams: existingCache.streams || [],
        cached: true,
        fresh: false, // stale fallback
      });
    }

    // ❌ 5) no streams, no cache
    return res.json({
      tmdbId: data.tmdbId || tmdbId,
      count: 0,
      streams: [],
    });
  } catch (err) {
    console.error(
      "❌ Zentlify movie error:",
      err?.response?.status,
      err.message
    );

    // 🔁 if Zentlify failed BUT we have cache, use it
    const { tmdbId } = req.params;
    const numericTmdbId = Number(tmdbId) || 0;
    const cacheKey = {
      tmdbId: numericTmdbId,
      type: "movie",
      season: null,
      episode: null,
    };

    const fallback = await StreamCache.findOne(cacheKey).lean();
    if (fallback && (fallback.streams || []).length > 0) {
      debug.log("🎬 Zentlify movie: ERROR but using cached fallback");
      return res.json({
        tmdbId: fallback.tmdbId || tmdbId,
        count: (fallback.streams || []).length,
        streams: fallback.streams || [],
        cached: true,
        fresh: false,
        errorFromUpstream: true,
      });
    }

    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(502).json({ message: "Zentlify upstream error" });
  }
});

router.get("/series/:tmdbId", async (req, res) => {
  try {
    if (!ZENTLIFY_API_KEY) {
      return res
        .status(500)
        .json({ message: "Missing ZENTLIFY_API_KEY in .env" });
    }

    // 🚫 Disable HTTP caching for this endpoint
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const { tmdbId } = req.params;
    const { season = 1, episode = 1, title = "" } = req.query; // ⭐ NEW

    const numericTmdbId = Number(tmdbId) || 0;
    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    // ✅ 1) TRY CACHE FIRST
    const cacheKey = {
      tmdbId: numericTmdbId,
      type: "series",
      season: s,
      episode: e,
    };

    let existingCache = await StreamCache.findOne(cacheKey).lean();

    // ❗ Only use cache when NO title is passed
    if (!title && existingCache && isFresh(existingCache.cachedAt)) {
    debug.log(
        "📺 Zentlify series: returning FRESH cached streams:",
        existingCache.streams.length
    );
    return res.json({
        tmdbId: existingCache.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: (existingCache.streams || []).length,
        streams: existingCache.streams || [],
        cached: true,
        fresh: true,
    });
    }

    // ✅ 2) CALL ZENTLIFY (MAIN providers - NO title)
    const qs = new URLSearchParams({ season: String(s), episode: String(e) });
    const upstreamUrl = `${ZENTLIFY_BASE}/series/${tmdbId}?${qs.toString()}`;
    debug.log("📺 Zentlify series upstream:", upstreamUrl);

    const { res: upstream, usedBase } = await axiosGetWithFallback(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${ZENTLIFY_API_KEY}`,
      },
      timeout: 15000,
    });

    debug.log("✅ Zentlify series gateway used:", usedBase);

    const data = upstream.data || {};
    const mainStreams = Array.isArray(data.streams) ? data.streams : [];
    let combinedStreams = [...mainStreams];

    // ⭐ Also try Flow for series if we have a title
    if (title) {
    const flowQuery = new URLSearchParams({
        title,
        season: String(s),
        episode: String(e),
    }).toString();

    const flowUrl = `${ZENTLIFY_BASE}/flow/series/${tmdbId}?${flowQuery}`;
    debug.log("🎥 Flow series upstream:", flowUrl);

    try {
        const { res: flowRes, usedBase } = await axiosGetWithFallback(flowUrl, {
          headers: {
            Authorization: `Bearer ${ZENTLIFY_API_KEY}`,
          },
          timeout: 15000,
        });

        debug.log("✅ Flow series gateway used:", usedBase);

        const flowData = flowRes.data || {};
        const flowStreams = Array.isArray(flowData.streams)
        ? flowData.streams
        : [];

        if (flowStreams.length) {
        debug.log("🎥 Flow series streams:", flowStreams.length);
        combinedStreams = combinedStreams.concat(flowStreams);
        }
    } catch (flowErr) {
        debug.warn(
        "⚠️ Flow series error:",
        flowErr?.response?.status,
        flowErr.message
        );
    }
    }

    const sorted = sortStreams(combinedStreams);

    // ✅ 3) IF ZENTLIFY GIVES STREAMS → SAVE + RETURN
    if (sorted.length > 0) {
      await StreamCache.findOneAndUpdate(
        cacheKey,
        {
          ...cacheKey,
          streams: sorted,
          cachedAt: new Date(),
        },
        { upsert: true }
      );

      return res.json({
        tmdbId: data.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: sorted.length,
        streams: sorted,
        cached: false,
        fresh: true,
      });
    }

    // ✅ 4) ZENTLIFY RETURNED [] BUT WE HAVE OLD CACHE → FALLBACK
    if (existingCache && (existingCache.streams || []).length > 0) {
      debug.log(
        "📺 Zentlify series: upstream empty, using STALE cache:",
        existingCache.streams.length
      );
      return res.json({
        tmdbId: existingCache.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: (existingCache.streams || []).length,
        streams: existingCache.streams || [],
        cached: true,
        fresh: false,
      });
    }

    // ❌ 5) no streams, no cache
    return res.json({
      tmdbId: data.tmdbId || tmdbId,
      season: String(s),
      episode: String(e),
      count: 0,
      streams: [],
    });
  } catch (err) {
    console.error(
      "❌ Zentlify series error:",
      err?.response?.status,
      err.message
    );

    // 🔁 if Zentlify failed BUT we have cache, use it
    const { tmdbId } = req.params;
    const { season = 1, episode = 1 } = req.query;

    const numericTmdbId = Number(tmdbId) || 0;
    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    const cacheKey = {
      tmdbId: numericTmdbId,
      type: "series",
      season: s,
      episode: e,
    };

    const fallback = await StreamCache.findOne(cacheKey).lean();
    if (fallback && (fallback.streams || []).length > 0) {
      debug.log("📺 Zentlify series: ERROR but using cached fallback");
      return res.json({
        tmdbId: fallback.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: (fallback.streams || []).length,
        streams: fallback.streams || [],
        cached: true,
        fresh: false,
        errorFromUpstream: true,
      });
    }

    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(502).json({ message: "Zentlify upstream error" });
  }
});

/* ---------------- ANIME (NEKO) ---------------- */
router.get("/anime/:tmdbId", async (req, res) => {
  try {
    if (!ZENTLIFY_API_KEY) {
      return res
        .status(500)
        .json({ message: "Missing ZENTLIFY_API_KEY in .env" });
    }

    // 🚫 Disable HTTP caching for this endpoint
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const { tmdbId } = req.params;
    const { season = 1, episode = 1, title = "" } = req.query;

    const numericTmdbId = Number(tmdbId) || 0;
    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    // ✅ 1) TRY CACHE FIRST (type = anime)
    const cacheKey = {
      tmdbId: numericTmdbId,
      type: "anime",
      season: s,
      episode: e,
    };

    let existingCache = await StreamCache.findOne(cacheKey).lean();
    if (existingCache && isFresh(existingCache.cachedAt)) {
      debug.log(
        "🟣 Zentlify anime: returning FRESH cached streams:",
        existingCache.streams.length
      );
      return res.json({
        success: true,
        provider: "neko",
        tmdbId: existingCache.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: (existingCache.streams || []).length,
        streams: existingCache.streams || [],
        cached: true,
        fresh: true,
      });
    }

    // ✅ 2) CALL ZENTLIFY
    const upstreamUrl = `${ZENTLIFY_BASE}/neko/series/${tmdbId}?season=${s}&episode=${e}&title=${encodeURIComponent(
      title
    )}`;
    debug.log("🟣 Zentlify anime upstream:", upstreamUrl);

    const { res: upstream, usedBase } = await axiosGetWithFallback(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${ZENTLIFY_API_KEY}`,
      },
      timeout: 15000,
    });

    debug.log("✅ Zentlify anime gateway used:", usedBase);

    const data = upstream.data || {};
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const sorted = sortStreams(streams);

    // ✅ 3) IF ZENTLIFY GIVES STREAMS → SAVE + RETURN
    if (sorted.length > 0) {
      await StreamCache.findOneAndUpdate(
        cacheKey,
        {
          ...cacheKey,
          streams: sorted,
          cachedAt: new Date(),
        },
        { upsert: true }
      );

      return res.json({
        success: true,
        provider: data.provider || "neko",
        tmdbId: data.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: sorted.length,
        streams: sorted,
        cached: false,
        fresh: true,
      });
    }

    // ✅ 4) ZENTLIFY RETURNED [] BUT WE HAVE OLD CACHE → FALLBACK
    if (existingCache && (existingCache.streams || []).length > 0) {
      debug.log(
        "🟣 Zentlify anime: upstream empty, using STALE cache:",
        existingCache.streams.length
      );
      return res.json({
        success: true,
        provider: "neko",
        tmdbId: existingCache.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: (existingCache.streams || []).length,
        streams: existingCache.streams || [],
        cached: true,
        fresh: false,
      });
    }

    // ❌ 5) no streams, no cache
    return res.json({
      success: true,
      provider: data.provider || "neko",
      tmdbId: data.tmdbId || tmdbId,
      season: String(s),
      episode: String(e),
      count: 0,
      streams: [],
    });
  } catch (err) {
    console.error(
      "❌ Zentlify anime error:",
      err?.response?.status,
      err.message
    );

    // 🔁 if Zentlify failed BUT we have cache, use it
    const { tmdbId } = req.params;
    const { season = 1, episode = 1 } = req.query;

    const numericTmdbId = Number(tmdbId) || 0;
    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    const cacheKey = {
      tmdbId: numericTmdbId,
      type: "anime",
      season: s,
      episode: e,
    };

    const fallback = await StreamCache.findOne(cacheKey).lean();
    if (fallback && (fallback.streams || []).length > 0) {
      debug.log("🟣 Zentlify anime: ERROR but using cached fallback");
      return res.json({
        success: true,
        provider: "neko",
        tmdbId: fallback.tmdbId || tmdbId,
        season: String(s),
        episode: String(e),
        count: (fallback.streams || []).length,
        streams: fallback.streams || [],
        cached: true,
        fresh: false,
        errorFromUpstream: true,
      });
    }

    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(502).json({ message: "Zentlify upstream error" });
  }
});

export default router;
