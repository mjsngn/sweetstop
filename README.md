# Sweet Stop — Dessert Shop Website

A full-stack website for selling brownies, cookies, cakes (yema, ube), leche flan and other treats.

- **Frontend:** plain HTML, CSS and JavaScript (no framework, no build step)
- **Backend:** Node.js + Express REST API
- **Database:** MongoDB (via Mongoose)
- **Security:** passwords hashed with bcrypt, login tokens (JWT), login attempt limiting

## Features

**Customers**
- Browse the menu, filter by category, and search (try "choco")
- Basket and checkout with a delivery date, order notes (e.g. message on the cake) and payment method
- Order as a guest, or create an account to get **order history** and **saved addresses**
- Track an order by its number

**Admin**
- Log in at `/admin.html` with the admin account
- See every order (customer, address, items, delivery date, notes, total) and update its status

## Setup

You need [Node.js](https://nodejs.org) (LTS) and a MongoDB database.

### 1. Get MongoDB (pick one)

**Option A — on your own computer (simplest, no .env needed)**
1. Download *MongoDB Community Server* from https://www.mongodb.com/try/download/community
2. Run the installer, keep the defaults (it installs MongoDB as a Windows service that starts automatically). Keeping *MongoDB Compass* ticked gives you a window to look at your data.

**Option B — MongoDB Atlas (free, in the cloud)**
1. Create a free account and a free cluster at https://www.mongodb.com/atlas
2. Create a database user, and under *Network Access* allow your IP address.
3. Click *Connect → Drivers* and copy the connection string.
4. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` to that string, adding `/sweetstop` before the `?`.

### 2. Run the site

```bash
cd backend
npm install
npm start
```

You should see `Connected to MongoDB` and `Sweet Stop server running at http://localhost:3000`.
Open **http://localhost:3000**. The admin page is **http://localhost:3000/admin.html**.

The first time the server starts it adds the starter menu (from `backend/data/products.json`) and creates the admin account.

## Admin login

| | |
|---|---|
| Email | `admin@sweetstop.local` (or `ADMIN_EMAIL` from `.env`) |
| Password | `ChangeMe123!` (or `ADMIN_PASSWORD` from `.env`) |

**Change the password after your first login:** log in on the main site, open your account, then *Profile → Change password*.
The admin account is only created once, so setting `ADMIN_PASSWORD` in `.env` only works before the first run.

## Settings (`backend/.env`, optional for local MongoDB)

See `backend/.env.example`. `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PORT`.
Set your own `JWT_SECRET` (any long random text) before putting the site online.

## API

| Method | Endpoint | Who | Description |
|---|---|---|---|
| GET | `/api/products` | everyone | Menu |
| POST | `/api/orders` | guest or customer | Place an order |
| GET | `/api/orders/:id` | everyone | Track an order (no phone/address shown) |
| POST | `/api/auth/register` | everyone | Create an account |
| POST | `/api/auth/login` | everyone | Log in (customers and admin) |
| GET / PUT | `/api/me` | customer | Profile |
| PUT | `/api/me/password` | customer | Change password |
| POST / DELETE | `/api/me/addresses` | customer | Save / remove an address |
| GET | `/api/me/orders` | customer | Order history |
| GET | `/api/admin/orders` | admin | All orders |
| PATCH | `/api/admin/orders/:id` | admin | Update order status |

## Customizing

- **Menu:** edit `backend/data/products.json`. It is only read when the products collection is empty, so to reload it, delete the `products` collection in MongoDB Compass and restart the server.
- **Look and feel:** `frontend/style.css` and `frontend/index.html`.

## Troubleshooting

- **"Could not connect to MongoDB"** — MongoDB isn't running (Option A) or the connection string in `.env` is wrong (Option B).
- **"npm is not recognized"** — install Node.js, then restart VS Code.
- **Page looks old after an update** — hard refresh with Ctrl+Shift+R.
