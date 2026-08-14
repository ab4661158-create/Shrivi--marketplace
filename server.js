const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Admin credentials
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let ADMIN_HASH = null;

// Create admin password hash
(async () => {
  if (!ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD environment variable is missing");
    return;
  }

  ADMIN_HASH = await bcrypt.hash(ADMIN_PASSWORD, 10);
})();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    secret:
      process.env.SESSION_SECRET || "shrivi-session-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// =========================
// PAGES
// =========================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/shop", (req, res) => {
  res.sendFile(path.join(__dirname, "customer.html"));
});

// =========================
// LOGIN
// =========================

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!ADMIN_HASH) {
      return res.status(500).json({
        error: "Admin login is not configured"
      });
    }

    const validUser = username === ADMIN_USER;

    const validPassword = await bcrypt.compare(
      password || "",
      ADMIN_HASH
    );

    if (validUser && validPassword) {
      req.session.admin = {
        username: ADMIN_USER
      };

      return req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);

          return res.status(500).json({
            error: "Session error"
          });
        }

        res.json({
          ok: true
        });
      });
    }

    return res.status(401).json({
      error: "Invalid username or password"
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      error: "Login error"
    });
  }
});

// =========================
// LOGOUT
// =========================

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        error: "Logout error"
      });
    }

    res.json({
      ok: true
    });
  });
});

// =========================
// CHECK LOGIN
// =========================

app.get("/api/me", (req, res) => {
  if (req.session.admin) {
    return res.json({
      loggedIn: true,
      username: req.session.admin.username
    });
  }

  res.status(401).json({
    loggedIn: false
  });
});

// =========================
// ADMIN SECURITY
// =========================

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin login required"
    });
  }

  next();
}

// =========================
// DATABASE TABLES
// =========================

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      category TEXT,
      image TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      total NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("SHRIVI database tables ready");
}

// =========================
// DASHBOARD
// =========================

app.get("/api/dashboard", requireAdmin, async (req, res) => {
  try {
    const products = await pool.query(
      "SELECT COUNT(*) AS count FROM products"
    );

    const orders = await pool.query(
      "SELECT COUNT(*) AS count FROM orders"
    );

    const sellers = await pool.query(
      "SELECT COUNT(*) AS count FROM sellers"
    );

    const result = {
      products: Number(products.rows[0].count),
      orders: Number(orders.rows[0].count),
      sellers: Number(sellers.rows[0].count)
    };

    console.log("Dashboard data:", result);

    res.json(result);
  } catch (error) {
    console.error("Dashboard error:", error);

    res.status(500).json({
      error: "Database error"
    });
  }
});

// =========================
// DATABASE CONNECTION
// =========================

async function startDatabase() {
  try {
    await pool.query("SELECT NOW()");

    console.log(
      "SHRIVI PostgreSQL connected successfully"
    );

    await initializeDatabase();
  } catch (error) {
    console.error(
      "PostgreSQL connection error:",
      error.message
    );
  }
}

startDatabase();

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {
  console.log(
    `SHRIVI server running on port ${PORT}`
  );
});
