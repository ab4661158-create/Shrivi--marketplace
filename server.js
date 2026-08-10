const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_HASH =
  process.env.ADMIN_HASH || bcrypt.hashSync("CHANGE_ME", 12);

const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SECRET";

app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  if (req.session.admin) {
    return next();
  }

  res.status(401).json({
    error: "Unauthorized"
  });
}

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (
    username === ADMIN_USER &&
    await bcrypt.compare(password, ADMIN_HASH)
  ) {
    req.session.admin = {
      username
    };

    return res.json({
      ok: true
    });
  }

  res.status(401).json({
    error: "Invalid username or password"
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: !!req.session.admin,
    username: req.session.admin?.username || null
  });
});

app.get("/api/dashboard", auth, (req, res) => {
  res.json({
    products: 4,
    orders: 0,
    sellers: 0
  });
});

app.listen(PORT, () => {
  console.log("Shrivi running on port " + PORT);
});
