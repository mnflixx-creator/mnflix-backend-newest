import express from "express";

const router = express.Router();

router.get("/movie/:tmdbId", async (req, res) => {
  try {
    const { tmdbId } = req.params;

    const r = await fetch(
      `${process.env.PROVIDER_API}/movie/${tmdbId}`
    );

    if (!r.ok) {
      return res.status(500).json({ message: "Provider error" });
    }

    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
