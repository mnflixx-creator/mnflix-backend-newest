import User from "../models/User.js";

export default async function deviceLimit(req, res, next) {
  const deviceId = req.headers["x-device-id"];
  const deviceName = req.headers["x-device-name"] || "Unknown Device";
  const ip = req.ip;

  if (!deviceId) {
    return res.status(400).json({ message: "Missing device ID" });
  }

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  // 🔍 Find existing device
  let device = user.devices.find((d) => d.deviceId === deviceId);

  // 📌 If new device → check device limit (MAX 3)
  if (!device) {
    if (user.devices.length >= 3) {
      return res.status(403).json({
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
  } else {
    // 📌 Update old device
    device.lastIP = ip;
    device.lastActive = new Date();
  }

  // ✅ ✅ ✅ ONLY ONE ACTIVE STREAM ALLOWED
  const activeStreamingDevice = user.devices.find(
    (d) => d.isStreaming && d.deviceId !== deviceId
  );

  if (activeStreamingDevice) {
    return res.status(403).json({
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
