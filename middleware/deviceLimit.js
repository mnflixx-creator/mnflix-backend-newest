import User from "../models/User.js";

export default async function deviceLimit(req, res, next) {
  const deviceId = req.headers["x-device-id"];
  const deviceName = req.headers["x-device-name"] || "Unknown Device";
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip;

  // ✅ STREAM TTL (important) — if no heartbeat within this time, treat as NOT watching
  const STREAM_TTL_MS = 90 * 1000; // 90 seconds
  const now = Date.now();

  if (!deviceId) {
    return res.status(400).json({ message: "Missing device ID" });
  }

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  // 🔍 Find existing device
  let device = user.devices.find((d) => d.deviceId === deviceId);

  // 📌 If new device → check device register limit (MAX 3)
  if (!device) {
    if (user.devices.length >= 3) {
      return res.status(403).json({
        code: "DEVICE_REGISTER_LIMIT",
        message:
          "Таны аккаунтад 3 төхөөрөмж бүртгэгдсэн байна. Дахин нэмэх боломжгүй.",
      });
    }

    user.devices.push({
      deviceId,
      deviceName,
      lastIP: ip,
      lastActive: new Date(),
      isStreaming: false,
    });

    device = user.devices.find((d) => d.deviceId === deviceId);
  } else {
    // 📌 Update old device
    device.lastIP = ip;
    device.lastActive = new Date();
  }

  // ✅ NEW: clear stale streaming flags (ghost sessions)
  let clearedStale = false;
  user.devices.forEach((d) => {
    if (d.isStreaming) {
      const last = new Date(d.lastActive).getTime();
      if (!Number.isNaN(last) && now - last > STREAM_TTL_MS) {
        d.isStreaming = false;
        clearedStale = true;
      }
    }
  });

  // ✅ ONLY ONE ACTIVE STREAM ALLOWED
  const activeStreamingDevice = user.devices.find(
    (d) => d.isStreaming && d.deviceId !== deviceId
  );

  if (activeStreamingDevice) {
    // Optional: save stale clearing even when blocked (keeps DB clean)
    if (clearedStale) await user.save();

    return res.status(403).json({
      code: "DEVICE_LIMIT",
      message:
        "Өөр төхөөрөмж дээр кино тоглож байна. MNFlix нь нэг аккаунтаар зэрэг хоёр төхөөрөмж дээр үзэхийг зөвшөөрдөггүй.",
    });
  }

  // ✅ Mark THIS device as streaming
  user.devices.forEach((d) => {
    d.isStreaming = d.deviceId === deviceId;
  });

  user.activeStreamDeviceId = deviceId;

  await user.save();
  next();
}
