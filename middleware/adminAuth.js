import jwt from "jsonwebtoken";

// Admin auth middleware (uses the same token you store as "adminToken" in frontend)
export default function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "No admin authorization" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SECRET);

    // optional: enforce role if you include it in token
    if (decoded?.role && decoded.role !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }

    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid admin token" });
  }
}
