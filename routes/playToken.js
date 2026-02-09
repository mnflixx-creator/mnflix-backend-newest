import express from "express";
import crypto from "crypto";

const router = express.Router();

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

router.get("/play-token", (req, res) => {
  const secret = process.env.PLAYBACK_SECRET;
  if (!secret) return res.status(500).json({ error: "PLAYBACK_SECRET not set" });

  // The exact path that your Worker will receive, e.g. "/test.txt" or "/hls/123/master.m3u8"
  let p = req.query.p;
  if (!p || typeof p !== "string") return res.status(400).json({ error: "Missing p" });

  // Must start with "/" and should NOT include domain
  if (!p.startsWith("/")) p = "/" + p;

  // Expires in 5 minutes
  const exp = Math.floor(Date.now() / 1000) + 300;

  const payloadB64 = base64url(JSON.stringify({ p, exp }));
  const sigB64 = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const token = `${payloadB64}.${sigB64}`;
  res.json({ token, exp, p });
});

export default router;
