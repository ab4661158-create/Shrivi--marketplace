const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// FIXED LOGIN
const ADMIN_USER = "admin";
const ADMIN_PASSWORD = "Shrivi@2026";

let ADMIN_HASH;

(async () => {
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

// Start server
app.listen(PORT, () => {
  console.log(`SHRIVI server running on port ${PORT}`);
});
