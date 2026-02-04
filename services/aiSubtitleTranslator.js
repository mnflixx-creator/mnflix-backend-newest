// services/aiSubtitleTranslator.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Uses Google Translate v2 API key (no service account)
import { uploadSubtitleToStorage } from "../utils/storage.js";

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Where we will store generated .vtt subtitles
const SUBTITLES_DIR = path.join(__dirname, "..", "uploads", "subtitles");

// Make sure directory exists
if (!fs.existsSync(SUBTITLES_DIR)) {
  fs.mkdirSync(SUBTITLES_DIR, { recursive: true });
}

const TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;

if (!TRANSLATE_API_KEY) {
  console.warn(
    "[aiSubtitleTranslator] WARNING: GOOGLE_TRANSLATE_API_KEY is not set"
  );
}

/**
 * Normalize line endings, trim, etc.
 */
function normalizeSubtitleText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Some providers include BOM or stray characters
  text = text.replace(/^\uFEFF/, "");

  return text;
}

/**
 * Very simple detection: does it look like WEBVTT?
 */
function isVtt(text) {
  return /^WEBVTT/i.test(text.trim());
}

/**
 * Convert SRT timestamps to VTT-compatible format (already almost same).
 * Here we mostly just replace comma with dot: 00:01:23,456 -> 00:01:23.456
 */
function srtTimeToVtt(timeLine) {
  return timeLine.replace(/,/g, ".");
}

/**
 * Parse SRT or VTT into cues:
 * {
 *   indexLine: "12" (optional)
 *   timeLine: "00:01:23.000 --> 00:01:25.000"
 *   textLines: ["Hello there", "How are you?"]
 * }
 *
 * We will keep ALL cues and timestamps to avoid losing the first hour.
 */
function parseToCues(raw) {
  const text = normalizeSubtitleText(raw);

  // Remove global "WEBVTT" header if present
  const withoutHeader = text.replace(/^WEBVTT[^\n]*\n?/, "").trim();

  const blocks = withoutHeader.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter(Boolean);
    if (lines.length < 2) continue;

    let indexLine = null;
    let timeLine = null;
    let textStartIndex = 1;

    // Case 1: first line is an index (digits only), second line is time
    if (/^\d+$/.test(lines[0]) && lines[1].includes("-->")) {
      indexLine = lines[0];
      timeLine = lines[1];
      textStartIndex = 2;
    }
    // Case 2: first line is time
    else if (lines[0].includes("-->")) {
      timeLine = lines[0];
      textStartIndex = 1;
    } else {
      // Not a valid cue
      continue;
    }

    // Normalize time format (SRT -> VTT style)
    timeLine = srtTimeToVtt(timeLine);

    const textLines = lines.slice(textStartIndex);

    cues.push({
      indexLine,
      timeLine,
      textLines,
    });
  }

  return cues;
}

/**
 * Clean text lines: remove [MUSIC], [LAUGHING], [APPLAUSE] etc,
 * but DON'T TOUCH the timestamps. We only operate on caption text.
 */
function cleanCaptionTextLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return [];

  const cleaned = [];

  for (let line of lines) {
    let trimmed = line.trim();

    // entire line like [MUSIC] or (LAUGHS) -> skip
    if (/^\[.*\]$/.test(trimmed) || /^\(.*\)$/.test(trimmed)) {
      continue;
    }

    // remove inline [ ... ] tags but keep rest
    trimmed = trimmed.replace(/\[[^\]]+\]/g, "").trim();
    trimmed = trimmed.replace(/\([^)]*\)/g, "").trim();

    if (trimmed.length === 0) continue;

    cleaned.push(trimmed);
  }

  return cleaned;
}

async function translateCaptionsToMn(texts) {
  const BATCH_SIZE = 40;
  const target = "mn";

  if (!TRANSLATE_API_KEY) {
    throw new Error("Missing GOOGLE_TRANSLATE_API_KEY");
  }

  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // keep length same
    if (!batch.some((t) => t && t.trim().length)) {
      results.push(...Array(batch.length).fill(""));
      continue;
    }

    try {
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${TRANSLATE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: batch,        // array of strings
            target,
            format: "text",
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();

      const translatedArr = data?.data?.translations?.map((t) => t.translatedText) || [];

      // ensure same length
      while (translatedArr.length < batch.length) translatedArr.push("");
      if (translatedArr.length > batch.length) translatedArr.length = batch.length;

      results.push(...translatedArr);
    } catch (err) {
      console.error("[aiSubtitleTranslator] Google translate v2 error:", err);
      throw new Error("Google Translate failed: " + (err.message || String(err)));
    }
  }

  return results;
}

/**
 * Build a WEBVTT file from cues and translated Mongolian texts.
 */
function buildVttFromCues(cues, mnTexts) {
  const out = [];
  out.push("WEBVTT", ""); // header + blank line

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const mnText = (mnTexts[i] || "").trim();

    // We still keep the cue even if mnText is empty → this preserves timings.
    if (cue.indexLine) {
      out.push(cue.indexLine);
    }

    out.push(cue.timeLine);

    if (mnText.length > 0) {
      out.push(mnText);
    }

    out.push(""); // blank line between cues
  }

  return out.join("\n");
}

/**
 * Main function used by routes:
 * createMnSubtitleFile({
 *   movieId,
 *   seasonNumber,
 *   episodeNumber,
 *   providerSubtitleText
 * })
 *
 * Returns: { publicUrl, fullPath, filename }
 */
export async function createMnSubtitleFile({
  movieId,
  seasonNumber = 0,
  episodeNumber = 0,
  providerSubtitleText,
}) {
  if (!movieId) {
    throw new Error("movieId is required for createMnSubtitleFile");
  }
  if (!providerSubtitleText) {
    throw new Error("providerSubtitleText is empty");
  }

  // 1) Parse provider subtitle into cues
  const cues = parseToCues(providerSubtitleText);
  if (!cues.length) {
    throw new Error("No valid subtitle cues found in provider text.");
  }

  // 2) Prepare text for translation (one string per cue)
  const captionTexts = cues.map((cue) => {
    const cleanedLines = cleanCaptionTextLines(cue.textLines || []);
    if (!cleanedLines.length) return "";
    return cleanedLines.join(" ");
  });

  // 3) Translate to Mongolian (same length array as cues)
  const mnTexts = await translateCaptionsToMn(captionTexts);

  // Safety: ensure mnTexts array has same length
  while (mnTexts.length < cues.length) mnTexts.push("");
  if (mnTexts.length > cues.length) mnTexts.length = cues.length;

  // 4) Build final WEBVTT
  const vttText = buildVttFromCues(cues, mnTexts);

    // 5) Decide filename
  let filename = "";
  if (seasonNumber && episodeNumber) {
    filename = `${movieId}_s${seasonNumber}e${episodeNumber}_mn.vtt`;
  } else {
    filename = `${movieId}_mn.vtt`;
  }

  // 6) Upload directly to R2 using the same helper as admin upload
  const fakeFile = {
    originalname: filename,
    mimetype: "text/vtt",
    buffer: Buffer.from(vttText, "utf8"),
  };

  const publicUrl = await uploadSubtitleToStorage(fakeFile);

  console.log("[aiSubtitleTranslator] Uploaded AI subtitle to", publicUrl);

  // keep fullPath in return so existing code doesn't break
  const fullPath = publicUrl;

  return {
    publicUrl,
    fullPath,
    filename,
  };
}

