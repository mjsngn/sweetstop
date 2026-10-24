/**
 * Authentication helpers.
 * - Passwords are hashed with bcrypt (see server.js) and never stored as plain text.
 * - After logging in, the browser receives a signed token (JWT) and sends it
 *   back in the "Authorization: Bearer <token>" header on later requests.
 */

const jwt = require("jsonwebtoken");
const { User } = require("./models");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";

// Express 4 doesn't catch errors from async handlers by itself — this does.
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

// Returns the logged-in user for this request, or null.
async function loadUser(req) {
  const [scheme, token] = (req.header("authorization") || "").split(" ");
  if (scheme !== "Bearer" || !token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null; // bad or expired token
  }
  return User.findById(payload.sub);
}

// Attaches req.user if logged in, but lets guests through (used for checkout).
const authOptional = wrap(async (req, res, next) => {
  req.user = await loadUser(req);
  next();
});

const requireAuth = wrap(async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) return res.status(401).json({ error: "Please log in." });
  next();
});

const requireAdmin = wrap(async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) return res.status(401).json({ error: "Please log in." });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access only." });
  }
  next();
});

// ---------- very small login rate limiter (in memory) ----------
// Blocks guessing: 10 failed logins per email+IP every 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map();

function tooManyAttempts(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}
function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}
function clearFailures(key) {
  failures.delete(key);
}

module.exports = {
  wrap,
  signToken,
  authOptional,
  requireAuth,
  requireAdmin,
  tooManyAttempts,
  recordFailure,
  clearFailures,
  usingDefaultSecret: !process.env.JWT_SECRET,
};
