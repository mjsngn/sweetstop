const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

/**
 * Sweet Stop — Backend Server
 * Node.js + Express REST API, with data stored in MongoDB.
 *
 * Features: product menu, guest or logged-in checkout, customer accounts
 * (order history + saved addresses), and an admin login (bcrypt-hashed
 * password + signed tokens).
 */

const crypto = require("crypto");
const https = require("https");

require("dotenv").config(); // loads backend/.env if it exists (must run first)

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const {
  User, Product, Order, nextOrderNumber,
  publicUser, publicOrder, trackingOrder,
} = require("./models");
const {
  wrap, signToken, authOptional, requireAuth, requireAdmin,
  tooManyAttempts, recordFailure, clearFailures, usingDefaultSecret,
} = require("./auth");
const v = require("./validators");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sweetstop";

const PAYMENT_METHODS = ["Cash on Delivery", "GCash", "Bank Transfer"];
const ORDER_STATUSES = ["Pending", "Confirmed", "Baking", "Out for Delivery", "Completed", "Cancelled"];
const MAX_SAVED_ADDRESSES = 10;

app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Used so we can compare passwords in constant-ish time even for unknown emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

// ---------- Brevo email helper ----------
function sendBrevoEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL || "no-reply@sweetstop.local", name: "Sweet Stop" },
      to: [to],
      subject,
      htmlContent: html,
    });
    const req = https.request({
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// =====================================================================
// Products
// =====================================================================

// GET /api/products (optional ?category=Cakes)
app.get("/api/products", wrap(async (req, res) => {
  let products = await Product.find().sort({ id: 1 }).select("-_id -__v").lean();
  const { category } = req.query;
  if (category) {
    products = products.filter((p) => p.category.toLowerCase() === String(category).toLowerCase());
  }
  res.json(products);
}));

app.get("/api/products/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const product = Number.isInteger(id)
    ? await Product.findOne({ id }).select("-_id -__v").lean()
    : null;
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
}));

// =====================================================================
// Accounts: register, login, profile
// =====================================================================

// POST /api/auth/register  { name, email, password, phone? }
app.post("/api/auth/register", wrap(async (req, res) => {
  const name = v.cleanText(req.body.name, 80);
  const email = v.cleanEmail(req.body.email);
  const phone = v.cleanText(req.body.phone, 30);
  const password = req.body.password;

  if (!name) return res.status(400).json({ error: "Please enter your name." });
  if (!v.isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  const pwError = v.validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

  if (await User.findOne({ email })) {
    return res.status(409).json({ error: "An account with that email already exists. Try logging in." });
  }

  const user = await User.create({
    name, email, phone,
    passwordHash: await bcrypt.hash(password, 10),
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// POST /api/auth/login  { email, password }  — used by customers AND the admin
app.post("/api/auth/login", wrap(async (req, res) => {
  const email = v.cleanEmail(req.body.email);
  const password = String(req.body.password || "");
  const key = `${req.ip}|${email}`;

  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: "Too many failed attempts. Please wait a few minutes and try again." });
  }

  const user = await User.findOne({ email });
  const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !passwordOk) {
    recordFailure(key);
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  clearFailures(key);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// GET /api/me — who am I? (also used to check a saved token is still valid)
app.get("/api/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// PUT /api/me  { name, phone }
app.put("/api/me", requireAuth, wrap(async (req, res) => {
  const name = v.cleanText(req.body.name, 80);
  if (!name) return res.status(400).json({ error: "Name can't be empty." });
  req.user.name = name;
  req.user.phone = v.cleanText(req.body.phone, 30);
  await req.user.save();
  res.json(publicUser(req.user));
}));

// PUT /api/me/password  { currentPassword, newPassword }
app.put("/api/me/password", requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const ok = await bcrypt.compare(String(currentPassword || ""), req.user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Your current password is incorrect." });
  const pwError = v.validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  await req.user.save();
  res.json({ ok: true });
}));

// POST /api/me/addresses  { label, address }
app.post("/api/me/addresses", requireAuth, wrap(async (req, res) => {
  const label = v.cleanText(req.body.label, 40) || "Home";
  const address = v.cleanText(req.body.address, 300);
  if (!address) return res.status(400).json({ error: "Please enter the address." });
  if (req.user.addresses.length >= MAX_SAVED_ADDRESSES) {
    return res.status(400).json({ error: `You can save up to ${MAX_SAVED_ADDRESSES} addresses.` });
  }
  req.user.addresses.push({ label, address });
  await req.user.save();
  res.status(201).json(publicUser(req.user));
}));

// DELETE /api/me/addresses/:addressId
app.delete("/api/me/addresses/:addressId", requireAuth, wrap(async (req, res) => {
  const before = req.user.addresses.length;
  req.user.addresses = req.user.addresses.filter((a) => String(a._id) !== req.params.addressId);
  if (req.user.addresses.length === before) {
    return res.status(404).json({ error: "Address not found." });
  }
  await req.user.save();
  res.json(publicUser(req.user));
}));

// GET /api/me/orders — this customer's order history, newest first
app.get("/api/me/orders", requireAuth, wrap(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ orderNumber: -1 }).lean();
  res.json(orders.map(publicOrder));
}));

// =====================================================================
// Orders
// =====================================================================

// POST /api/orders — works for guests and logged-in customers
// body: { customerName, contactNumber, address, deliveryDate, notes, paymentMethod,
//         items: [{ productId, quantity }], saveAddress?, addressLabel? }
app.post("/api/orders", authOptional, wrap(async (req, res) => {
  const customerName = v.cleanText(req.body.customerName, 80);
  const contactNumber = v.cleanText(req.body.contactNumber, 30);
  const address = v.cleanText(req.body.address, 300);
  const notes = v.cleanText(req.body.notes, 300);
  const paymentMethod = PAYMENT_METHODS.includes(req.body.paymentMethod)
    ? req.body.paymentMethod
    : "Cash on Delivery";
  const { items, deliveryDate } = req.body;

  if (!customerName || !contactNumber || !address) {
    return res.status(400).json({ error: "Name, contact number and delivery address are required." });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({ error: "Your basket is empty." });
  }
  const dateError = v.validateDeliveryDate(deliveryDate);
  if (dateError) return res.status(400).json({ error: dateError });

  // Prices always come from the database, never from the browser.
  const ids = items.map((i) => Number(i.productId));
  if (ids.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: "One of the items in your basket is invalid." });
  }
  const products = await Product.find({ id: { $in: ids } }).lean();

  let total = 0;
  const orderItems = [];
  for (const item of items) {
    const product = products.find((p) => p.id === Number(item.productId));
    if (!product) {
      return res.status(400).json({ error: `Product with id ${item.productId} does not exist.` });
    }
    const quantity = Math.min(50, Math.max(1, Math.floor(Number(item.quantity)) || 1));
    const lineTotal = product.price * quantity;
    total += lineTotal;
    orderItems.push({
      productId: product.id, name: product.name, unit: product.unit,
      price: product.price, quantity, lineTotal,
    });
  }

  const order = await Order.create({
    orderNumber: await nextOrderNumber(),
    user: req.user ? req.user._id : null,
    customerName, contactNumber, address, deliveryDate, notes,
    paymentMethod, items: orderItems, total,
  });

  // Logged-in customers can keep this address for next time.
  if (req.user && req.body.saveAddress === true) {
    const alreadySaved = req.user.addresses.some(
      (a) => a.address.toLowerCase() === address.toLowerCase()
    );
    if (!alreadySaved && req.user.addresses.length < MAX_SAVED_ADDRESSES) {
      req.user.addresses.push({
        label: v.cleanText(req.body.addressLabel, 40) || "Home",
        address,
      });
      await req.user.save();
    }
  }

  res.status(201).json(publicOrder(order));
}));

// GET /api/orders/:id — public order tracking (no phone number or address shown)
app.get("/api/orders/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const order = Number.isInteger(id) ? await Order.findOne({ orderNumber: id }) : null;
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(trackingOrder(order));
}));

// =====================================================================
// Admin (requires an account with role "admin")
// =====================================================================

app.get("/api/admin/orders", requireAdmin, wrap(async (req, res) => {
  const orders = await Order.find().sort({ orderNumber: 1 });
  res.json(orders.map(publicOrder));
}));

app.patch("/api/admin/orders/:id", requireAdmin, wrap(async (req, res) => {
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(", ")}` });
  }
  const id = Number(req.params.id);
  const order = Number.isInteger(id) ? await Order.findOne({ orderNumber: id }) : null;
  if (!order) return res.status(404).json({ error: "Order not found" });
  order.status = status;
  await order.save();
  res.json(publicOrder(order));
}));

// POST /api/auth/forgot-password  { email }
app.post("/api/auth/forgot-password", wrap(async (req, res) => {
  const email = v.cleanEmail(req.body.email);
  // Always respond OK so we don't reveal whether an email is registered.
  res.json({ ok: true });

  const user = await User.findOne({ email });
  if (!user) return;

  const token = crypto.randomBytes(32).toString("hex");
  user.resetToken = token;
  user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save();

  const resetUrl = `https://sweetstop-9krl.onrender.com?reset=${token}`;
  await sendBrevoEmail({
    to: { email: user.email, name: user.name },
    subject: "Reset your Sweet Stop password",
    html: `<p>Hi ${user.name},</p>
           <p>Click the link below to reset your password. It expires in 1 hour.</p>
           <p><a href="${resetUrl}">${resetUrl}</a></p>
           <p>If you didn't request this, you can ignore this email.</p>`,
  });
}));

// POST /api/auth/reset-password  { token, newPassword }
app.post("/api/auth/reset-password", wrap(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token) return res.status(400).json({ error: "Invalid or expired reset link." });

  const user = await User.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: new Date() },
  });
  if (!user) return res.status(400).json({ error: "This reset link has expired or already been used." });

  const pwError = v.validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetToken = null;
  user.resetTokenExpiry = null;
  await user.save();
  res.json({ ok: true });
}));

// =====================================================================
// Fallbacks
// =====================================================================

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ error: "That email is already registered." });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

// =====================================================================
// Startup: connect to MongoDB, add starter data, then listen
// =====================================================================

async function seedProducts() {
  if ((await Product.countDocuments()) > 0) return;
  const file = path.join(__dirname, "data", "products.json");
  await Product.insertMany(JSON.parse(fs.readFileSync(file, "utf-8")));
  console.log("Added the starter menu from data/products.json");
}

async function seedAdmin() {
  if (await User.exists({ role: "admin" })) return;
  const email = v.cleanEmail(process.env.ADMIN_EMAIL || "admin@sweetstop.local");
  const usingDefaultPassword = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  await User.create({
    name: "Shop Admin",
    email,
    role: "admin",
    passwordHash: await bcrypt.hash(password, 10),
  });
  console.log(`Admin account created: ${email}`);
  if (usingDefaultPassword) {
    console.log("  Using the default admin password (ChangeMe123!). Log in and change it, or set ADMIN_PASSWORD in backend/.env before the first run.");
  }
}

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    console.error("\n[DB ERROR] name:", err.name);
    console.error("[DB ERROR] message:", err.message);
    if (err.message.includes("whitelist") || err.message.includes("IP")) {
      console.error("  -> Your IP is not whitelisted in MongoDB Atlas Network Access.");
    } else if (err.name === "MongoServerSelectionError") {
      console.error("  -> DNS/network issue or cluster is paused. Check Atlas dashboard.");
    } else {
      console.error("  -> Check your MONGODB_URI and Atlas credentials.");
    }
    process.exit(1);
  }
  console.log("Connected to MongoDB");

  await seedProducts();
  await seedAdmin();
  if (usingDefaultSecret) {
    console.log("Note: using a default JWT secret. Fine for local use; set JWT_SECRET in backend/.env before putting this online.");
  }

  app.listen(PORT, () => {
    console.log(`🍰 Sweet Stop server running at http://localhost:${PORT}`);
  });
}

start();
