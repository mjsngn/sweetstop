/**
 * Database models (MongoDB via Mongoose).
 * Collections: users, products, orders, counters
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;

// ---------- users ----------
const addressSchema = new Schema({
  label: { type: String, required: true, trim: true, maxlength: 40 },
  address: { type: String, required: true, trim: true, maxlength: 300 },
});

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }, // bcrypt hash — never the real password
    role: { type: String, enum: ["customer", "admin"], default: "customer" },
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    addresses: [addressSchema],
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
  },
  { timestamps: true }
);

// ---------- products ----------
const productSchema = new Schema({
  id: { type: Number, required: true, unique: true }, // simple numeric id used by the frontend
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  unit: { type: String, default: "" },
  emoji: { type: String, default: "" },
  description: { type: String, default: "" },
});

// ---------- orders ----------
const orderSchema = new Schema(
  {
    orderNumber: { type: Number, required: true, unique: true }, // shown to customers as the order #
    user: { type: Schema.Types.ObjectId, ref: "User", default: null }, // null = guest checkout
    customerName: { type: String, required: true },
    contactNumber: { type: String, required: true },
    address: { type: String, required: true },
    deliveryDate: { type: String, required: true }, // YYYY-MM-DD
    notes: { type: String, default: "" },
    paymentMethod: { type: String, default: "Cash on Delivery" },
    items: [
      {
        _id: false,
        productId: Number,
        name: String,
        unit: String,
        price: Number,
        quantity: Number,
        lineTotal: Number,
      },
    ],
    total: { type: Number, required: true },
    status: { type: String, default: "Pending" },
  },
  { timestamps: true }
);

// ---------- counters (for sequential order numbers) ----------
const counterSchema = new Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const User = mongoose.model("User", userSchema);
const Product = mongoose.model("Product", productSchema);
const Order = mongoose.model("Order", orderSchema);
const Counter = mongoose.model("Counter", counterSchema);

// First order is #1001, then 1002, 1003, ...
async function nextOrderNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: "orders" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return 1000 + counter.seq;
}

// ---------- shapes sent to the browser ----------
function publicUser(u) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    addresses: (u.addresses || []).map((a) => ({
      id: String(a._id),
      label: a.label,
      address: a.address,
    })),
  };
}

function publicOrder(o) {
  return {
    id: o.orderNumber,
    customerName: o.customerName,
    contactNumber: o.contactNumber,
    address: o.address,
    deliveryDate: o.deliveryDate,
    notes: o.notes || "",
    paymentMethod: o.paymentMethod,
    items: (o.items || []).map((i) => ({
      productId: i.productId,
      name: i.name,
      unit: i.unit,
      price: i.price,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    total: o.total,
    status: o.status,
    createdAt: o.createdAt,
  };
}

// What anyone with just an order number can see (no phone or address).
function trackingOrder(o) {
  const full = publicOrder(o);
  delete full.contactNumber;
  delete full.address;
  return full;
}

module.exports = {
  User,
  Product,
  Order,
  Counter,
  nextOrderNumber,
  publicUser,
  publicOrder,
  trackingOrder,
};
