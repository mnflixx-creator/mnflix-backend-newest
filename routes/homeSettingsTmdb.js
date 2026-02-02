import express from "express";
import HomeSettings from "../models/HomeSettings.js";
import adminAuth from "../middleware/adminAuth.js"; // use your admin middleware

const router = express.Router();

async function getSettingsDoc() {
  let doc = await HomeSettings.findOne();
  if (!doc) doc = await HomeSettings.create({});
  return doc;
}

// ✅ get selected TMDB ids (admin page needs this)
router.get("/welcome-slider-ids", adminAuth, async (req, res) => {
  const doc = await getSettingsDoc();
  res.json(doc.welcomeSliderTmdbIds || []);
});

// ✅ toggle TMDB id in slider list
router.post("/welcome-slider/toggle", adminAuth, async (req, res) => {
  try {
    const tmdbId = Number(req.body.tmdbId);

    if (!tmdbId) {
      return res.status(400).json({ message: "tmdbId required" });
    }

    const doc = await getSettingsDoc();
    const arr = Array.isArray(doc.welcomeSliderTmdbIds)
      ? doc.welcomeSliderTmdbIds
      : [];

    const exists = arr.includes(tmdbId);

    doc.welcomeSliderTmdbIds = exists
      ? arr.filter((x) => x !== tmdbId)
      : [...arr, tmdbId];

    await doc.save();

    return res.json({
      ok: true,
      selected: !exists,
      ids: doc.welcomeSliderTmdbIds,
    });
  } catch (err) {
    console.error("welcome-slider toggle error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

router.get("/debug", adminAuth, async (req, res) => {
  const doc = await getSettingsDoc();
  res.json({
    welcomeSliderTmdbIds: doc.welcomeSliderTmdbIds || [],
  });
});

export default router;
