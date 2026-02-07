// backend/utils/storage.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";

function mustEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ✅ validate env early (this prevents SSL "EPROTO" when endpoint is broken)
const R2_ACCOUNT_ID = mustEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = mustEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = mustEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = mustEnv("R2_BUCKET");
const R2_PUBLIC_BASE_URL = mustEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

// ✅ prevent common mistake: account id accidentally includes https://
const CLEAN_ACCOUNT_ID = R2_ACCOUNT_ID.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${CLEAN_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// file = req.file from multer (memoryStorage)
export async function uploadSubtitleToStorage(file) {
  if (!file?.buffer) throw new Error("No file buffer (multer memoryStorage issue?)");

  const safeName = (file.originalname || "subtitle.vtt").replace(/\s+/g, "_");
  const key = `subtitles/${Date.now()}-${safeName}`;

  const ext = path.extname(file.originalname || "").toLowerCase();
  let contentType = file.mimetype || "application/octet-stream";
  if (contentType === "application/octet-stream" && ext === ".vtt") contentType = "text/vtt";
  if (contentType === "application/octet-stream" && ext === ".srt") contentType = "application/x-subrip";

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: contentType,
    })
  );

  return `${R2_PUBLIC_BASE_URL}/${key}`;
}
