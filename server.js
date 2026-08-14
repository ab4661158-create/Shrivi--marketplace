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

// Admin login
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let ADMIN_HASH;

(async () => {
  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD environment variable is missing");
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
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// Pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/shop", (req, res) => {
  res.sendFile(path.join(__dirname, "customer.html"));
});

// Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (
    username === ADMIN_USER &&
    ADMIN_HASH &&
    (await bcrypt.compare(password || "", ADMIN_HASH))
  ) {
    req.session.admin = {
      username: ADMIN_USER
    };

    return res.json({
      ok: true
    });
  }

  return res.status(401).json({
    error: "Invalid username or password"
  });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

// Check login
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

// Admin authentication middleware
function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin login required"
    });
  }

  next();
}

// Create database tables
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

// Dashboard statistics
app.get("/api/dashboard", requireAdmin, async (req, res) => {
  try {
    const productsResult = await pool.query(
      "SELECT COUNT(*) FROM products"
    );

    const ordersResult = await pool.query(
      "SELECT COUNT(*) FROM orders"
    );

    const sellersResult = await pool.query(
      "SELECT COUNT(*) FROM sellers"
    );

    res.json({
      products: Number(productsResult.rows[0].count),
      orders: Number(ordersResult.rows[0].count),
      sellers: Number(sellersResult.rows[0].count)
    });
  } catch (error) {
    console.error("Dashboard error:", error);

    res.status(500).json({
      error: "Database error"
    });
  }
});

// Test PostgreSQL connection
pool
  .query("SELECT NOW()")
  .then(() => {
    console.log("SHRIVI PostgreSQL connected successfully");
    return initializeDatabase();
  })
  .catch((error) => {
    console.error(
      "PostgreSQL connection error:",
      error.message
    );
  });

// Start server
app.listen(PORT, () => {
  console.log(`SHRIVI server running on port ${PORT}`);
});
