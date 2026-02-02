import express from "express";
import HomeSettings from "../models/HomeSettings.js";

const router = express.Router();

// GET SETTINGS
router.get("/", async (req, res) => {
  let settings = await HomeSettings.findOne();

  if (!settings) {
    settings = await HomeSettings.create({
      featured: [],
      newReleases: [],
      trending: [],
      movies: [],
      series: [],
      anime: [],
    });
  }

  res.json(settings);
});

// SAVE SETTINGS
router.post("/", async (req, res) => {
  let settings = await HomeSettings.findOne();
  if (!settings) settings = new HomeSettings();

  const fields = [
    "featured",
    "newReleases",
    "trending",
    "movies",
    "series",
    "anime"
  ];

  fields.forEach(f => {
    settings[f] = req.body[f] || [];
  });

  await settings.save();

  res.json({ success: true, settings });
});

export default router;
