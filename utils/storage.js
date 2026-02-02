// backend/utils/storage.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// file = req.file from multer (memoryStorage)
export async function uploadSubtitleToStorage(file) {
  if (!file) {
    throw new Error("No file provided");
  }

  const safeName = file.originalname.replace(/\s+/g, "_");
  const key = `subtitles/${Date.now()}-${safeName}`;

  // prefer real mimetype, fallback to text/vtt
  const ext = path.extname(file.originalname || "").toLowerCase();
  let contentType = file.mimetype || "application/octet-stream";
  if (contentType === "application/octet-stream" && ext === ".vtt") {
    contentType = "text/vtt";
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: file.buffer,          // because we use memoryStorage
      ContentType: contentType,
    })
  );

  const base = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/${key}`;
}
