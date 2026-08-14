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

// FIXED LOGIN
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

app.use(
  session({
    secret: process.env.SESSION_SECRET || "shrivi-session-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// Admin page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Customer shop
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

// PostgreSQL connection test
pool
  .query("SELECT NOW()")
  .then(() => {
    console.log("SHRIVI PostgreSQL connected successfully");
  })
  .catch((err) => {
    console.error("PostgreSQL connection error:", err.message);
  });

// Start server
app.listen(PORT, () => {
  console.log(`SHRIVI server running on port ${PORT}`);
});
