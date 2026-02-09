import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  const header = req.headers.authorization || "";

  // 1) Bearer token (old way)
  const bearerToken = header.startsWith("Bearer ") ? header.split(" ")[1] : null;

  // 2) Cookie token (new way for api.mnflix.com)
  const cookieToken = req.cookies?.token;

  const token = bearerToken || cookieToken;
  if (!token) return res.status(401).json({ message: "No authorization" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
