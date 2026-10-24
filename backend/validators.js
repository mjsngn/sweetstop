/**
 * Small, dependency-free helpers for cleaning and validating user input.
 * Keeping these separate from server.js makes them easy to test.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

// Returns an error message, or null when the password is fine.
// (bcrypt only uses the first 72 characters, so we cap it there.)
function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (password.length > 72) {
    return "Password must be 72 characters or fewer.";
  }
  return null;
}

// Delivery date must be a real YYYY-MM-DD date, tomorrow or later
// (everything is baked to order), and within the next 60 days.
// Returns an error message, or null when the date is fine.
function validateDeliveryDate(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return "Please choose a delivery date.";
  }
  const [y, m, d] = value.split("-").map(Number);
  const chosen = new Date(y, m - 1, d);
  const isRealDate =
    chosen.getFullYear() === y && chosen.getMonth() === m - 1 && chosen.getDate() === d;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const latest = new Date(today);
  latest.setDate(latest.getDate() + 60);

  if (!isRealDate || chosen <= today) {
    return "Delivery date must be tomorrow or later.";
  }
  if (chosen > latest) {
    return "Delivery date must be within the next 60 days.";
  }
  return null;
}

module.exports = {
  cleanText,
  cleanEmail,
  isValidEmail,
  validatePassword,
  validateDeliveryDate,
};
