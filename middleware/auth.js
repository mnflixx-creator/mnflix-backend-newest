import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  // 1) Try Authorization header first
  const header = req.headers.authorization;
  let token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;

  // 2) If no header, try cookie
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) return res.status(401).json({ message: "No authorization" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
