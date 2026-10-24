// Sweet Stop — frontend logic. Talks to the backend REST API only through
// fetch(); no framework needed for a site this size.

const API = "https://sweetstop-9krl.onrender.com/api";

const $ = (id) => document.getElementById(id);

// ---------- login session (kept in the browser so a refresh doesn't log you out) ----------
const TOKEN_KEY = "sweetstop_token";
function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function storageSet(k, val) { try { localStorage.setItem(k, val); } catch (_) { /* private mode */ } }
function storageRemove(k) { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } }

let authToken = storageGet(TOKEN_KEY);
let currentUser = null;
let resetToken = new URLSearchParams(location.search).get("reset") || null;

// Talks to the backend. Adds the login token automatically and turns
// failures into readable error messages.
async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    throw new Error("Can't reach the server. Make sure it is running (npm start in the backend folder).");
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || "Something went wrong. Please try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

function updateAccountButton() {
  $("accountBtn").textContent = currentUser ? `Hi, ${currentUser.name.split(" ")[0]}` : "Log in";
}
function setSession(token, user) {
  authToken = token;
  currentUser = user;
  storageSet(TOKEN_KEY, token);
  updateAccountButton();
}
function clearSession() {
  authToken = null;
  currentUser = null;
  storageRemove(TOKEN_KEY);
  updateAccountButton();
}
async function restoreSession() {
  if (!authToken) return;
  try {
    currentUser = await api("/me");
  } catch (err) {
    if (err.status === 401) clearSession(); // token expired or account removed
  }
  updateAccountButton();
}

let products = [];
let cart = []; // [{ productId, quantity }]

const money = (n) => `₱${Number(n).toLocaleString("en-PH")}`;

// Escape anything a customer typed before putting it into innerHTML
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// "2026-10-14" -> "Oct 14, 2026" (parsed as a local date, no timezone shift)
function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ---------- filtering (category chips + search box) ----------
let currentCategory = "all";
let searchTerm = "";

function applyFilters() {
  const term = searchTerm.trim().toLowerCase();
  products = allProductsCache.filter((p) => {
    const matchesCategory = currentCategory === "all" || p.category === currentCategory;
    const matchesSearch =
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.description.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  if (products.length === 0) {
    grid.innerHTML = `<p class="no-results">No desserts match your search. Try a different word or category.</p>`;
    return;
  }
  grid.innerHTML = products
    .map(
      (p) => `
    <article class="product-card">
      <div class="product-emoji">${p.emoji}</div>
      <h3>${p.name}</h3>
      <div class="product-unit">${p.unit}</div>
      <p class="product-desc">${p.description}</p>
      <div class="product-foot">
        <span class="product-price">${money(p.price)}</span>
        <button class="add-btn" data-id="${p.id}" aria-label="Add ${p.name} to basket">+</button>
      </div>
    </article>
  `
    )
    .join("");

  grid.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", () => addToCart(Number(btn.dataset.id)));
  });
}

// ---------- category filters ----------
document.getElementById("filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".filter-chip");
  if (!chip) return;
  document
    .querySelectorAll(".filter-chip")
    .forEach((c) => c.classList.remove("is-active"));
  chip.classList.add("is-active");
  currentCategory = chip.dataset.category;
  applyFilters();
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  applyFilters();
});

// ---------- cart ----------
function addToCart(productId) {
  const line = cart.find((l) => l.productId === productId);
  if (line) line.quantity += 1;
  else cart.push({ productId, quantity: 1 });
  renderCart();
  openCart();
}

function changeQty(productId, delta) {
  const line = cart.find((l) => l.productId === productId);
  if (!line) return;
  line.quantity += delta;
  if (line.quantity <= 0) {
    cart = cart.filter((l) => l.productId !== productId);
  }
  renderCart();
}

function removeLine(productId) {
  cart = cart.filter((l) => l.productId !== productId);
  renderCart();
}

function cartLinesWithProduct() {
  // products list can be filtered by category, so look up full catalog
  // via a simple cache built the first time we ever loaded it.
  return cart
    .map((line) => {
      const product = allProductsCache.find((p) => p.id === line.productId);
      return product ? { ...line, product } : null;
    })
    .filter(Boolean);
}

let allProductsCache = [];

function renderCart() {
  document.getElementById("cartCount").textContent = cart.reduce(
    (sum, l) => sum + l.quantity,
    0
  );

  const lines = cartLinesWithProduct();
  const container = document.getElementById("drawerItems");

  if (lines.length === 0) {
    container.innerHTML = `<p class="drawer-empty">Your basket is empty. Add something sweet!</p>`;
  } else {
    container.innerHTML = lines
      .map(
        (l) => `
      <div class="cart-line">
        <div class="emoji">${l.product.emoji}</div>
        <div class="cart-line-info">
          <div class="name">${l.product.name}</div>
          <div class="price">${money(l.product.price)} · ${l.product.unit}</div>
        </div>
        <div class="qty-controls">
          <button data-action="dec" data-id="${l.productId}">−</button>
          <span>${l.quantity}</span>
          <button data-action="inc" data-id="${l.productId}">+</button>
        </div>
        <button class="remove-line" data-action="remove" data-id="${l.productId}">Remove</button>
      </div>
    `
      )
      .join("");

    container.querySelectorAll("[data-action]").forEach((btn) => {
      const id = Number(btn.dataset.id);
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "inc") changeQty(id, 1);
        if (btn.dataset.action === "dec") changeQty(id, -1);
        if (btn.dataset.action === "remove") removeLine(id);
      });
    });
  }

  const total = lines.reduce(
    (sum, l) => sum + l.product.price * l.quantity,
    0
  );
  document.getElementById("drawerTotal").textContent = money(total);
}

// ---------- cart drawer open/close ----------
const drawer = document.getElementById("cartDrawer");
const drawerOverlay = document.getElementById("drawerOverlay");

function openCart() {
  drawer.classList.add("is-open");
  drawerOverlay.classList.add("is-open");
}
function closeCart() {
  drawer.classList.remove("is-open");
  drawerOverlay.classList.remove("is-open");
}
document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
drawerOverlay.addEventListener("click", () => {
  closeCart();
  closeCheckout();
});

// ---------- checkout modal ----------
const checkoutOverlay = document.getElementById("checkoutOverlay");

function toISO(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function setupDeliveryDate() {
  const input = document.getElementById("deliveryDate");
  const earliest = new Date();
  earliest.setDate(earliest.getDate() + 1); // baked to order: at least 1 day ahead
  const latest = new Date();
  latest.setDate(latest.getDate() + 60);
  input.min = toISO(earliest);
  input.max = toISO(latest);
}

// Logged-in customers get their name, phone and saved addresses filled in.
function setupCheckoutForUser() {
  const form = $("checkoutForm");
  const savedWrap = $("savedAddressWrap");
  const savedSelect = $("savedAddress");

  if (!currentUser) {
    $("loginHint").classList.remove("is-hidden");
    savedWrap.classList.add("is-hidden");
    $("saveAddressWrap").classList.add("is-hidden");
    return;
  }

  $("loginHint").classList.add("is-hidden");
  if (!form.customerName.value) form.customerName.value = currentUser.name;
  if (!form.contactNumber.value) form.contactNumber.value = currentUser.phone || "";

  const addrs = currentUser.addresses;
  if (addrs.length) {
    savedSelect.innerHTML =
      addrs
        .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)}: ${escapeHtml(a.address)}</option>`)
        .join("") + `<option value="">Use a different address…</option>`;
    savedWrap.classList.remove("is-hidden");
    if (!form.address.value) {
      savedSelect.value = addrs[0].id;
      form.address.value = addrs[0].address;
    } else {
      const match = savedAddressMatching(form.address.value);
      savedSelect.value = match ? match.id : "";
    }
  } else {
    savedSelect.innerHTML = "";
    savedWrap.classList.add("is-hidden");
  }
  updateSaveAddressVisibility();
}

function savedAddressMatching(text) {
  if (!currentUser) return null;
  const t = text.trim().toLowerCase();
  return currentUser.addresses.find((a) => a.address.trim().toLowerCase() === t) || null;
}

// Offer "save this address" only for a new address typed by a logged-in customer.
function updateSaveAddressVisibility() {
  const text = $("addressField").value;
  const show = !!currentUser && text.trim() !== "" && !savedAddressMatching(text);
  $("saveAddressWrap").classList.toggle("is-hidden", !show);
  if (!show) $("saveAddress").checked = false;
}

$("savedAddress").addEventListener("change", (e) => {
  const chosen = currentUser && currentUser.addresses.find((a) => a.id === e.target.value);
  $("addressField").value = chosen ? chosen.address : "";
  if (!chosen) $("addressField").focus();
  updateSaveAddressVisibility();
});

$("addressField").addEventListener("input", () => {
  const select = $("savedAddress");
  if (select.options.length) {
    const match = savedAddressMatching($("addressField").value);
    select.value = match ? match.id : "";
  }
  updateSaveAddressVisibility();
});

function openCheckout() {
  if (cart.length === 0) return;
  $("checkoutFormWrap").classList.remove("is-hidden");
  $("checkoutDone").classList.add("is-hidden");
  $("checkoutError").textContent = "";
  setupDeliveryDate();
  setupCheckoutForUser();
  renderCheckoutSummary();
  checkoutOverlay.classList.add("is-open");
}
function closeCheckout() {
  checkoutOverlay.classList.remove("is-open");
}
checkoutOverlay.addEventListener("click", (e) => {
  if (e.target === checkoutOverlay) closeCheckout(); // click the dimmed area to close
});
document.getElementById("checkoutBtn").addEventListener("click", openCheckout);
document.getElementById("closeCheckout").addEventListener("click", closeCheckout);

// "Log in" link inside checkout: log in, then come straight back to checkout.
$("hintLogin").addEventListener("click", () => {
  closeCheckout();
  closeCart();
  reopenCheckoutAfterLogin = true;
  authMode = "login";
  openAccount();
});

function renderCheckoutSummary() {
  const lines = cartLinesWithProduct();
  const total = lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
  document.getElementById("modalSummary").innerHTML =
    lines
      .map(
        (l) => `
      <div class="line"><span>${l.quantity}× ${escapeHtml(l.product.name)}</span><span>${money(
          l.product.price * l.quantity
        )}</span></div>
    `
      )
      .join("") + `<div class="line total"><span>Total</span><span>${money(total)}</span></div>`;
}

document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = $("checkoutError");
  const submitBtn = form.querySelector('button[type="submit"]');
  errorEl.textContent = "";
  submitBtn.disabled = true;

  const wantsToSave =
    !$("saveAddressWrap").classList.contains("is-hidden") && $("saveAddress").checked;

  const payload = {
    customerName: form.customerName.value,
    contactNumber: form.contactNumber.value,
    address: form.address.value,
    deliveryDate: form.deliveryDate.value,
    notes: form.notes.value,
    paymentMethod: form.paymentMethod.value,
    saveAddress: wantsToSave,
    addressLabel: $("addressLabel").value,
    items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
  };

  try {
    const order = await api("/orders", { method: "POST", body: payload });
    if (currentUser) {
      // pick up any newly saved address
      try { currentUser = await api("/me"); } catch (_) { /* not critical */ }
    }
    showConfirmation(order);
    cart = [];
    renderCart();
    form.reset();
    $("saveAddressWrap").classList.add("is-hidden");
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

function showConfirmation(order) {
  $("checkoutFormWrap").classList.add("is-hidden");
  const done = $("checkoutDone");
  done.classList.remove("is-hidden");
  done.innerHTML = `
    <div class="confirmation">
      <div class="big-emoji">🎉</div>
      <h3>Order placed!</h3>
      <p>Thanks, ${escapeHtml(order.customerName)}. We're getting it ready.</p>
      <div class="order-number">#${order.id}</div>
      <p>Delivery date: <strong>${formatDate(order.deliveryDate)}</strong></p>
      <p>Total: <strong>${money(order.total)}</strong> · ${escapeHtml(order.paymentMethod)}</p>
      ${currentUser ? `<p>You can see this order any time under <strong>My account</strong>.</p>` : ""}
      <button class="btn btn-primary btn-block" id="closeConfirmation">Done</button>
    </div>
  `;
  $("closeConfirmation").addEventListener("click", () => {
    closeCheckout();
    closeCart();
  });
}

// ---------- accounts: log in / create account / my account ----------
const accountOverlay = $("accountOverlay");
let accountTab = "orders"; // orders | addresses | profile
let authMode = "login"; // login | register
let reopenCheckoutAfterLogin = false;

function openAccount() {
  accountTab = "orders"; // "My account" always opens on the orders list
  renderAccount();
  accountOverlay.classList.add("is-open");
}
function closeAccount() {
  accountOverlay.classList.remove("is-open");
  reopenCheckoutAfterLogin = false;
}
$("accountBtn").addEventListener("click", openAccount);
$("closeAccount").addEventListener("click", closeAccount);
accountOverlay.addEventListener("click", (e) => {
  if (e.target === accountOverlay) closeAccount();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAccount();
    closeCheckout();
    closeCart();
  }
});

function renderAccount() {
  const box = $("accountContent");
  if (currentUser) renderAccountHome(box);
  else renderAuthForms(box);
}

function onAuthSuccess(token, user) {
  setSession(token, user);
  if (reopenCheckoutAfterLogin) {
    closeAccount();
    openCheckout();
  } else {
    accountTab = "orders";
    renderAccount();
  }
}

// If the saved login has expired, quietly go back to the logged-out view.
function handleExpiredLogin() {
  clearSession();
  authMode = "login";
  renderAccount();
}

function renderAuthForms(box) {
  const isLogin = authMode === "login";
  const isForgot = authMode === "forgot";
  const isReset = authMode === "reset";

  if (isForgot) {
    box.innerHTML = `
      <h3>Reset your password</h3>
      <p>Enter your email and we'll send you a reset link.</p>
      <form id="authForm" class="form-stack">
        <label>Email
          <input type="email" name="email" required autocomplete="email" />
        </label>
        <p class="form-ok" id="authOk"></p>
        <p class="form-error" id="authError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block">Send reset link</button>
      </form>
      <p style="margin-top:14px;text-align:center">
        <button class="link-btn" id="backToLogin">Back to log in</button>
      </p>
    `;
    box.querySelector("#backToLogin").addEventListener("click", () => { authMode = "login"; renderAccount(); });
    $("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      $("authError").textContent = "";
      btn.disabled = true;
      try {
        await api("/auth/forgot-password", { method: "POST", body: { email: e.target.email.value } });
        $("authOk").textContent = "If that email is registered, a reset link is on its way.";
        e.target.reset();
      } catch (_) {
        $("authOk").textContent = "If that email is registered, a reset link is on its way.";
      } finally {
        btn.disabled = false;
      }
    });
    return;
  }

  if (isReset) {
    box.innerHTML = `
      <h3>Choose a new password</h3>
      <form id="authForm" class="form-stack">
        <label><span>New password <span class="optional">(at least 8 characters)</span></span>
          <input type="password" name="newPassword" required minlength="8" maxlength="72" autocomplete="new-password" />
        </label>
        <p class="form-ok" id="authOk"></p>
        <p class="form-error" id="authError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block">Set new password</button>
      </form>
    `;
    $("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      $("authError").textContent = "";
      btn.disabled = true;
      try {
        await api("/auth/reset-password", { method: "POST", body: { token: resetToken, newPassword: e.target.newPassword.value } });
        $("authOk").textContent = "Password updated! You can now log in.";
        resetToken = null;
        history.replaceState(null, "", location.pathname);
        setTimeout(() => { authMode = "login"; renderAccount(); }, 2000);
      } catch (err) {
        $("authError").textContent = err.message;
        btn.disabled = false;
      }
    });
    return;
  }

  const isLogin = authMode === "login";
  box.innerHTML = `
    <h3>${isLogin ? "Welcome back" : "Create your account"}</h3>
    <p>Save your delivery addresses and keep all your orders in one place.</p>
    <div class="tabs">
      <button class="tab ${isLogin ? "is-active" : ""}" data-mode="login">Log in</button>
      <button class="tab ${!isLogin ? "is-active" : ""}" data-mode="register">Create account</button>
    </div>
    <form id="authForm" class="form-stack">
      ${isLogin ? "" : `
        <label>Full name
          <input type="text" name="name" required maxlength="80" autocomplete="name" />
        </label>`}
      <label>Email
        <input type="email" name="email" required autocomplete="email" />
      </label>
      ${isLogin ? "" : `
        <label><span>Contact number <span class="optional">(optional)</span></span>
          <input type="tel" name="phone" autocomplete="tel" />
        </label>`}
      <label><span>Password ${isLogin ? "" : `<span class="optional">(at least 8 characters)</span>`}</span>
        <input type="password" name="password" required ${isLogin ? "" : 'minlength="8"'} maxlength="72"
               autocomplete="${isLogin ? "current-password" : "new-password"}" />
      </label>
      <p class="form-error" id="authError" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-block">${isLogin ? "Log in" : "Create account"}</button>
      ${isLogin ? `<p style="margin-top:10px;text-align:center"><button type="button" class="link-btn" id="forgotBtn">Forgot password?</button></p>` : ""}
    </form>
  `;

  box.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      authMode = b.dataset.mode;
      renderAccount();
    })
  );

  if (isLogin) {
    const forgotBtn = box.querySelector("#forgotBtn");
    if (forgotBtn) forgotBtn.addEventListener("click", () => { authMode = "forgot"; renderAccount(); });
  }

  const form = $("authForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const errorEl = $("authError");
    errorEl.textContent = "";
    btn.disabled = true;
    const fields = Object.fromEntries(new FormData(form));
    try {
      const data = await api(isLogin ? "/auth/login" : "/auth/register", {
        method: "POST",
        body: fields,
      });
      onAuthSuccess(data.token, data.user);
    } catch (err) {
      errorEl.textContent = err.message;
      btn.disabled = false;
    }
  });
}

function renderAccountHome(box) {
  const first = currentUser.name.split(" ")[0];
  const labels = { orders: "My orders", addresses: "Addresses", profile: "Profile" };
  box.innerHTML = `
    <h3>Hi, ${escapeHtml(first)}!</h3>
    <p>${escapeHtml(currentUser.email)}</p>
    <div class="tabs">
      ${Object.keys(labels)
        .map((t) => `<button class="tab ${accountTab === t ? "is-active" : ""}" data-tab="${t}">${labels[t]}</button>`)
        .join("")}
    </div>
    <div id="accountPanel"></div>
    <div class="acct-actions">
      ${currentUser.role === "admin" ? `<a href="admin.html">Open the admin dashboard →</a><br/>` : ""}
      <button class="btn btn-ghost btn-block" id="logoutBtn">Log out</button>
    </div>
  `;

  box.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      accountTab = b.dataset.tab;
      renderAccount();
    })
  );
  $("logoutBtn").addEventListener("click", () => {
    clearSession();
    authMode = "login";
    renderAccount();
  });

  const panel = $("accountPanel");
  if (accountTab === "orders") renderOrdersPanel(panel);
  else if (accountTab === "addresses") renderAddressesPanel(panel);
  else renderProfilePanel(panel);
}

async function renderOrdersPanel(panel) {
  panel.innerHTML = `<p class="acct-empty">Loading your orders…</p>`;
  try {
    const orders = await api("/me/orders");
    if (orders.length === 0) {
      panel.innerHTML = `<p class="acct-empty">No orders yet. Your next sweet treat will show up here.</p>`;
      return;
    }
    panel.innerHTML = orders
      .map(
        (o) => `
      <div class="acct-card">
        <div class="acct-card-head">
          <strong>Order #${o.id}</strong>
          <span class="order-status-badge">${escapeHtml(o.status)}</span>
        </div>
        <p>${o.items.map((i) => `${i.quantity}× ${escapeHtml(i.name)}`).join(", ")}</p>
        <p class="meta">Deliver on ${formatDate(o.deliveryDate)} · Total ${money(o.total)}</p>
        ${o.notes ? `<p class="meta">Notes: ${escapeHtml(o.notes)}</p>` : ""}
      </div>`
      )
      .join("");
  } catch (err) {
    if (err.status === 401) return handleExpiredLogin();
    panel.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

function renderAddressesPanel(panel) {
  const list = currentUser.addresses.length
    ? currentUser.addresses
        .map(
          (a) => `
      <div class="acct-card">
        <div class="acct-card-head">
          <strong>${escapeHtml(a.label)}</strong>
          <button class="link-btn" data-remove="${escapeHtml(a.id)}">Remove</button>
        </div>
        <p>${escapeHtml(a.address)}</p>
      </div>`
        )
        .join("")
    : `<p class="acct-empty">No saved addresses yet.</p>`;

  panel.innerHTML = `
    ${list}
    <h4 class="acct-section-title">Add an address</h4>
    <form id="addAddressForm" class="form-stack">
      <label>Label
        <input type="text" name="label" maxlength="40" placeholder="Home, Office…" />
      </label>
      <label>Address
        <textarea name="address" rows="2" maxlength="300" required></textarea>
      </label>
      <p class="form-error" id="addrError" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-block">Save address</button>
    </form>
  `;

  panel.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        currentUser = await api(`/me/addresses/${btn.dataset.remove}`, { method: "DELETE" });
        renderAddressesPanel(panel);
      } catch (err) {
        if (err.status === 401) return handleExpiredLogin();
        $("addrError").textContent = err.message;
      }
    })
  );

  $("addAddressForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.target));
    try {
      currentUser = await api("/me/addresses", { method: "POST", body: fields });
      renderAddressesPanel(panel);
    } catch (err) {
      if (err.status === 401) return handleExpiredLogin();
      $("addrError").textContent = err.message;
    }
  });
}

function renderProfilePanel(panel) {
  panel.innerHTML = `
    <form id="profileForm" class="form-stack">
      <label>Email
        <input type="email" value="${escapeHtml(currentUser.email)}" readonly />
      </label>
      <label>Name
        <input type="text" name="name" value="${escapeHtml(currentUser.name)}" required maxlength="80" />
      </label>
      <label>Contact number
        <input type="tel" name="phone" value="${escapeHtml(currentUser.phone)}" />
      </label>
      <p class="form-ok" id="profileOk"></p>
      <p class="form-error" id="profileError" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-block">Save changes</button>
    </form>

    <h4 class="acct-section-title">Change password</h4>
    <form id="passwordForm" class="form-stack">
      <label>Current password
        <input type="password" name="currentPassword" required autocomplete="current-password" />
      </label>
      <label><span>New password <span class="optional">(at least 8 characters)</span></span>
        <input type="password" name="newPassword" required minlength="8" maxlength="72" autocomplete="new-password" />
      </label>
      <p class="form-ok" id="passwordOk"></p>
      <p class="form-error" id="passwordError" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-block">Update password</button>
    </form>
  `;

  $("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("profileOk").textContent = "";
    $("profileError").textContent = "";
    try {
      currentUser = await api("/me", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) });
      updateAccountButton();
      renderAccountHome($("accountContent")); // refresh the greeting
      $("profileOk").textContent = "Saved!";
    } catch (err) {
      if (err.status === 401) return handleExpiredLogin();
      $("profileError").textContent = err.message;
    }
  });

  $("passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    $("passwordOk").textContent = "";
    $("passwordError").textContent = "";
    try {
      await api("/me/password", { method: "PUT", body: Object.fromEntries(new FormData(form)) });
      form.reset();
      $("passwordOk").textContent = "Password updated.";
    } catch (err) {
      if (err.status === 401) return handleExpiredLogin();
      $("passwordError").textContent = err.message;
    }
  });
}

// ---------- order tracking ----------
document.getElementById("trackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("trackOrderId").value;
  const resultBox = document.getElementById("trackResult");
  resultBox.innerHTML = "Looking that up…";

  const res = await fetch(`${API}/orders/${id}`);
  if (!res.ok) {
    resultBox.innerHTML = `<p class="error-text">We couldn't find order #${id}. Double-check the number and try again.</p>`;
    return;
  }
  const order = await res.json();
  resultBox.innerHTML = `
    <div class="order-status-card">
      <span class="order-status-badge">${order.status}</span>
      <p><strong>Order #${order.id}</strong> for ${escapeHtml(order.customerName)}</p>
      <p>${order.items.map((i) => `${i.quantity}× ${escapeHtml(i.name)}`).join(", ")}</p>
      <p class="order-extra">Delivery date: <strong>${order.deliveryDate ? formatDate(order.deliveryDate) : "—"}</strong></p>
      ${order.notes ? `<p class="order-extra">Notes: ${escapeHtml(order.notes)}</p>` : ""}
      <p>Total: <strong>${money(order.total)}</strong></p>
    </div>
  `;
});

// ---------- init ----------
(async function init() {
  const res = await fetch(`${API}/products`);
  allProductsCache = await res.json();
  applyFilters();
  renderCart();
  await restoreSession();
  if (resetToken) {
    authMode = "reset";
    openAccount();
  }
})();
