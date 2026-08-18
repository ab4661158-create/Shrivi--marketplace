const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const multer = require("multer");
const { Pool } = require("pg");
const { v2: cloudinary } = require("cloudinary");

const app = express();
const PORT = process.env.PORT || 10000;

// ======================================================
// DATABASE
// ======================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error);
});

// ======================================================
// CLOUDINARY
// ======================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error("Only JPG, PNG and WEBP images are allowed")
      );
    }

    cb(null, true);
  }
});

// ======================================================
// ADMIN
// ======================================================

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let ADMIN_HASH = null;

async function prepareAdminPassword() {
  if (!ADMIN_PASSWORD) {
    console.error("WARNING: ADMIN_PASSWORD is missing");
    return;
  }

  try {
    ADMIN_HASH = await bcrypt.hash(ADMIN_PASSWORD, 12);
    console.log("Admin authentication ready");
  } catch (error) {
    console.error("Admin hash error:", error);
  }
}

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json({
  limit: "2mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "2mb"
}));

app.set("trust proxy", 1);

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "shrivi-session-secret-change-this",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

app.use(
  express.static(__dirname, {
    index: false
  })
);

// ======================================================
// HELPERS
// ======================================================

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function integer(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(email || "").trim().toLowerCase()
  );
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8
  );
}

function validPhone(phone) {
  return /^[0-9]{10}$/.test(
    String(phone || "").trim()
  );
}

function validStock(stock) {
  const n = Number(stock);

  return (
    Number.isInteger(n) &&
    n >= 0
  );
}

function validDiscount(discount) {
  const n = Number(discount);

  return (
    Number.isFinite(n) &&
    n >= 0 &&
    n <= 100
  );
}

function salePrice(price, discount) {
  const p = number(price);
  const d = number(discount);

  return Math.round(
    (p - (p * d) / 100) * 100
  ) / 100;
}

// ======================================================
// PAGES
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});

app.get("/shop", (req, res) => {
  res.sendFile(
    path.join(__dirname, "customer.html")
  );
});

app.get("/app", (req, res) => {
  res.sendFile(
    path.join(__dirname, "app-v2.html")
  );
});

app.get("/seller", (req, res) => {
  res.sendFile(
    path.join(__dirname, "seller.html")
  );
});

// ======================================================
// ADMIN AUTH
// ======================================================

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      ok: false,
      error: "Admin login required"
    });
  }

  next();
}

app.post("/api/login", async (req, res) => {
  try {
    const username = cleanText(
      req.body?.username
    );

    const password =
      req.body?.password || "";

    if (!ADMIN_HASH) {
      return res.status(500).json({
        ok: false,
        error: "Admin login is not configured"
      });
    }

    const valid =
      username === ADMIN_USER &&
      await bcrypt.compare(
        password,
        ADMIN_HASH
      );

    if (!valid) {
      return res.status(401).json({
        ok: false,
        error: "Invalid username or password"
      });
    }

    req.session.admin = {
      username: ADMIN_USER
    };

    req.session.save((error) => {
      if (error) {
        console.error(
          "Admin session save:",
          error
        );

        return res.status(500).json({
          ok: false,
          error: "Session error"
        });
      }

      res.json({
        ok: true,
        message: "Admin login successful"
      });
    });
  } catch (error) {
    console.error(
      "Admin login:",
      error
    );

    res.status(500).json({
      ok: false,
      error: "Login error"
    });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error(
        "Admin logout:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "Logout error"
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      ok: true
    });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.admin) {
    return res.status(401).json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    username: req.session.admin.username
  });
});

// ======================================================
// CUSTOMER AUTH
// ======================================================

async function requireCustomer(req, res, next) {
  try {
    if (!req.session.customer) {
      return res.status(401).json({
        ok: false,
        error: "Customer login required"
      });
    }

    const id = integer(
      req.session.customer.id
    );

    if (id <= 0) {
      delete req.session.customer;

      return res.status(401).json({
        ok: false,
        error: "Invalid customer session"
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        created_at
      FROM customers
      WHERE id=$1
      LIMIT 1
      `,
      [id]
    );

    if (!result.rows.length) {
      delete req.session.customer;

      return res.status(401).json({
        ok: false,
        error: "Customer account not found"
      });
    }

    req.customer = result.rows[0];

    next();
  } catch (error) {
    console.error(
      "Customer auth:",
      error
    );

    res.status(500).json({
      ok: false,
      error: "Customer authorization error"
    });
  }
}

app.post(
  "/api/customer/register",
  async (req, res) => {
    try {
      const name = cleanText(
        req.body?.name
      );

      const email = cleanText(
        req.body?.email
      ).toLowerCase();

      const phone = cleanText(
        req.body?.phone
      );

      const password =
        req.body?.password || "";

      if (name.length < 2) {
        return res.status(400).json({
          ok: false,
          error: "Name must be at least 2 characters"
        });
      }

      if (!validEmail(email)) {
        return res.status(400).json({
          ok: false,
          error: "Valid email is required"
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          ok: false,
          error: "Password must be at least 8 characters"
        });
      }

      if (
        phone &&
        !validPhone(phone)
      ) {
        return res.status(400).json({
          ok: false,
          error: "Phone must be a valid 10-digit number"
        });
      }

      const existing = await pool.query(
        `
        SELECT id
        FROM customers
        WHERE LOWER(email)=LOWER($1)
        LIMIT 1
        `,
        [email]
      );

      if (existing.rows.length) {
        return res.status(409).json({
          ok: false,
          error: "Customer account already exists"
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO customers
          (
            name,
            email,
            phone,
            password_hash
          )
          VALUES ($1,$2,$3,$4)
          RETURNING
            id,
            name,
            email,
            phone,
            created_at
          `,
          [
            name,
            email,
            phone || null,
            hash
          ]
        );

      const customer =
        result.rows[0];

      req.session.customer = {
        id: Number(customer.id),
        name: customer.name,
        email: customer.email
      };

      req.session.save((error) => {
        if (error) {
          console.error(
            "Customer session:",
            error
          );

          return res.status(500).json({
            ok: false,
            error: "Session error"
          });
        }

        res.status(201).json({
          ok: true,
          customer
        });
      });
    } catch (error) {
      console.error(
        "Customer register:",
        error
      );

      if (error.code === "23505") {
        return res.status(409).json({
          ok: false,
          error: "Customer account already exists"
        });
      }

      res.status(500).json({
        ok: false,
        error: "Failed to register customer"
      });
    }
  }
);

app.post(
  "/api/customer/login",
  async (req, res) => {
    try {
      const email = cleanText(
        req.body?.email
      ).toLowerCase();

      const password =
        req.body?.password || "";

      if (!validEmail(email)) {
        return res.status(400).json({
          ok: false,
          error: "Valid email is required"
        });
      }

      if (!password) {
        return res.status(400).json({
          ok: false,
          error: "Password is required"
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            phone,
            password_hash,
            created_at
          FROM customers
          WHERE LOWER(email)=LOWER($1)
          LIMIT 1
          `,
          [email]
        );

      if (!result.rows.length) {
        return res.status(401).json({
          ok: false,
          error: "Invalid email or password"
        });
      }

      const customer =
        result.rows[0];

      const valid =
        await bcrypt.compare(
          password,
          customer.password_hash || ""
        );

      if (!valid) {
        return res.status(401).json({
          ok: false,
          error: "Invalid email or password"
        });
      }

      req.session.customer = {
        id: Number(customer.id),
        name: customer.name,
        email: customer.email
      };

      req.session.save((error) => {
        if (error) {
          return res.status(500).json({
            ok: false,
            error: "Session error"
          });
        }

        res.json({
          ok: true,
          customer: {
            id: Number(customer.id),
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            created_at:
              customer.created_at
          }
        });
      });
    } catch (error) {
      console.error(
        "Customer login:",
        error
      );

      res.status(500).json({
        ok: false,
        error: "Customer login error"
      });
    }
  }
);

app.post(
  "/api/customer/logout",
  (req, res) => {
    delete req.session.customer;

    req.session.save((error) => {
      if (error) {
        return res.status(500).json({
          ok: false,
          error: "Logout error"
        });
      }

      res.json({
        ok: true
      });
    });
  }
);

app.get(
  "/api/customer/me",
  requireCustomer,
  (req, res) => {
    res.json({
      loggedIn: true,
      customer: req.customer
    });
  }
);

// ======================================================
// SELLER AUTH
// ======================================================

async function requireSeller(req, res, next) {
  try {
    if (!req.session.seller) {
      return res.status(401).json({
        ok: false,
        error: "Seller login required"
      });
    }

    const id = integer(
      req.session.seller.id
    );

    if (id <= 0) {
      delete req.session.seller;

      return res.status(401).json({
        ok: false,
        error: "Invalid seller session"
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        status,
        created_at
      FROM sellers
      WHERE id=$1
      LIMIT 1
      `,
      [id]
    );

    if (!result.rows.length) {
      delete req.session.seller;

      return res.status(401).json({
        ok: false,
        error: "Seller account not found"
      });
    }

    const seller =
      result.rows[0];

    if (seller.status !== "active") {
      delete req.session.seller;

      return res.status(403).json({
        ok: false,
        error: "Seller account is blocked"
      });
    }

    req.seller = seller;

    next();
  } catch (error) {
    console.error(
      "Seller auth:",
      error
    );

    res.status(500).json({
      ok: false,
      error: "Seller authorization error"
    });
  }
}

app.post(
  "/api/seller/register",
  async (req, res) => {
    try {
      const name = cleanText(
        req.body?.name
      );

      const email = cleanText(
        req.body?.email
      ).toLowerCase();

      const phone = cleanText(
        req.body?.phone
      );

      const password =
        req.body?.password || "";

      if (name.length < 2) {
        return res.status(400).json({
          ok: false,
          error: "Seller name is too short"
        });
      }

      if (!validEmail(email)) {
        return res.status(400).json({
          ok: false,
          error: "Valid email is required"
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          ok: false,
          error: "Password must be at least 8 characters"
        });
      }

      if (
        phone &&
        !validPhone(phone)
      ) {
        return res.status(400).json({
          ok: false,
          error: "Phone must be a valid 10-digit number"
        });
      }

      const existing =
        await pool.query(
          `
          SELECT id
          FROM sellers
          WHERE LOWER(email)=LOWER($1)
          LIMIT 1
          `,
          [email]
        );

      if (existing.rows.length) {
        return res.status(409).json({
          ok: false,
          error: "Seller account already exists"
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO sellers
          (
            name,
            email,
            phone,
            password_hash,
            status
          )
          VALUES ($1,$2,$3,$4,'active')
          RETURNING
            id,
            name,
            email,
            phone,
            status,
            created_at
          `,
          [
            name,
            email,
            phone || null,
            hash
          ]
        );

      const seller =
        result.rows[0];

      req.session.seller = {
        id: Number(seller.id),
        name: seller.name,
        email: seller.email
      };

      req.session.save((error) => {
        if (error) {
          return res.status(500).json({
            ok: false,
            error: "Session error"
          });
        }

        res.status(201).json({
          ok: true,
          seller
        });
      });
    } catch (error) {
      console.error(
        "Seller register:",
        error
      );

      if (error.code === "23505") {
        return res.status(409).json({
          ok: false,
          error: "Seller account already exists"
        });
      }

      res.status(500).json({
        ok: false,
        error: "Failed to register seller"
      });
    }
  }
);

app.post(
  "/api/seller/login",
  async (req, res) => {
    try {
      const email = cleanText(
        req.body?.email
      ).toLowerCase();

      const password =
        req.body?.password || "";

      if (!validEmail(email)) {
        return res.status(400).json({
          ok: false,
          error: "Valid email is required"
        });
      }

      if (!password) {
        return res.status(400).json({
          ok: false,
          error: "Password is required"
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            phone,
            password_hash,
            status,
            created_at
          FROM sellers
          WHERE LOWER(email)=LOWER($1)
          LIMIT 1
          `,
          [email]
        );

      if (!result.rows.length) {
        return res.status(401).json({
          ok: false,
          error: "Invalid email or password"
        });
      }

      const seller =
        result.rows[0];

      if (seller.status !== "active") {
        return res.status(403).json({
          ok: false,
          error: "Seller account is not active"
        });
      }

      const valid =
        await bcrypt.compare(
          password,
          seller.password_hash || ""
        );

      if (!valid) {
        return res.status(401).json({
          ok: false,
          error: "Invalid email or password"
        });
      }

      req.session.seller = {
        id: Number(seller.id),
        name: seller.name,
        email: seller.email
      };

      req.session.save((error) => {
        if (error) {
          return res.status(500).json({
            ok: false,
            error: "Session error"
          });
        }

        res.json({
          ok: true,
          seller: {
            id: Number(seller.id),
            name: seller.name,
            email: seller.email,
            phone: seller.phone,
            status: seller.status
          }
        });
      });
    } catch (error) {
      console.error(
        "Seller login:",
        error
      );

      res.status(500).json({
        ok: false,
        error: "Seller login error"
      });
    }
  }
);

app.post(
  "/api/seller/logout",
  (req, res) => {
    delete req.session.seller;

    req.session.save((error) => {
      if (error) {
        return res.status(500).json({
          ok: false,
          error: "Logout error"
        });
      }

      res.json({
        ok: true
      });
    });
  }
);

app.get(
  "/api/seller/me",
  requireSeller,
  (req, res) => {
    res.json({
      loggedIn: true,
      seller: req.seller
    });
  }
);

// ======================================================
// IMAGE UPLOAD - ADMIN OR SELLER
// ======================================================

function requireAdminOrSeller(
  req,
  res,
  next
) {
  if (req.session.admin) {
    req.userType = "admin";
    return next();
  }

  if (req.session.seller) {
    req.userType = "seller";
    return next();
  }

  return res.status(401).json({
    ok: false,
    error: "Login required"
  });
}

function handleImageUpload(
  req,
  res,
  next
) {
  upload.single("image")(
    req,
    res,
    (error) => {
      if (error) {
        console.error(
          "Image middleware error:",
          error
        );

        if (
          error.code ===
          "LIMIT_FILE_SIZE"
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Image size must be 5MB or less"
          });
        }

        return res.status(400).json({
          ok: false,
          error:
            error.message ||
            "Image upload error"
        });
      }

      next();
    }
  );
}

async function uploadToCloudinary(
  req,
  res
) {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "Please select an image"
      });
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      console.error(
        "Cloudinary environment variables are missing"
      );

      return res.status(500).json({
        ok: false,
        error:
          "Cloudinary is not configured"
      });
    }

    const result =
      await new Promise(
        (resolve, reject) => {
          const stream =
            cloudinary.uploader.upload_stream(
              {
                folder:
                  "shrivi/products",
                resource_type:
                  "image"
              },
              (
                error,
                result
              ) => {
                if (error) {
                  reject(error);
                } else {
                  resolve(result);
                }
              }
            );

          stream.end(
            req.file.buffer
          );
        }
      );

    return res.json({
      ok: true,
      url: result.secure_url,
      secure_url: result.secure_url,
      public_id:
        result.public_id
    });
  } catch (error) {
    console.error(
      "Cloudinary upload:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Image upload failed"
    });
  }
}

app.post(
  "/api/upload/image",
  requireAdminOrSeller,
  handleImageUpload,
  uploadToCloudinary
);

app.post(
  "/api/seller/upload/image",
  requireSeller,
  handleImageUpload,
  uploadToCloudinary
);

// ======================================================
// PUBLIC PRODUCTS
// ======================================================

app.get(
  "/api/products",
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            p.id,
            p.name,
            p.price,
            p.category,
            p.image,
            p.description,
            p.stock,
            p.discount_percent,
            p.created_at,
            p.seller_id,
            s.name AS seller_name
          FROM products p
          LEFT JOIN sellers s
            ON s.id=p.seller_id
          WHERE
            p.seller_id IS NULL
            OR s.status='active'
          ORDER BY p.id DESC
        `);

      res.json(
        result.rows.map(
          (p) => {
            const price =
              number(p.price);

            const discount =
              number(
                p.discount_percent
              );

            return {
              ...p,
              price,
              original_price:
                price,
              discount_percent:
                discount,
              sale_price:
                salePrice(
                  price,
                  discount
                ),
              stock:
                integer(p.stock),
              seller_name:
                p.seller_name ||
                "Shrivi"
            };
          }
        )
      );
    } catch (error) {
      console.error(
        "Products:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to fetch products"
      });
    }
  }
);

// ======================================================
// PRODUCT INPUT
// ======================================================

async function validateSellerId(
  sellerId
) {
  if (
    sellerId === null ||
    sellerId === undefined ||
    sellerId === ""
  ) {
    return null;
  }

  const id =
    integer(sellerId);

  if (id <= 0) {
    throw new Error(
      "INVALID_SELLER"
    );
  }

  const result =
    await pool.query(
      `
      SELECT id,status
      FROM sellers
      WHERE id=$1
      LIMIT 1
      `,
      [id]
    );

  if (!result.rows.length) {
    throw new Error(
      "SELLER_NOT_FOUND"
    );
  }

  if (
    result.rows[0].status !==
    "active"
  ) {
    throw new Error(
      "SELLER_BLOCKED"
    );
  }

  return id;
}

async function getProductInput(
  body,
  isEdit = false
) {
  const name =
    cleanText(body?.name);

  const price =
    number(
      body?.price,
      NaN
    );

  const category =
    cleanText(
      body?.category
    );

  const image =
    cleanText(
      body?.image
    );

  const description =
    cleanText(
      body?.description
    );

  const stock =
    body?.stock === "" ||
    body?.stock === undefined
      ? isEdit
        ? NaN
        : 0
      : Number(body.stock);

  const discount =
    body?.discount_percent ===
      "" ||
    body?.discount_percent ===
      undefined
      ? 0
      : Number(
          body.discount_percent
        );

  return {
    name,
    price,
    category,
    image,
    description,
    stock,
    discount
  };
}

// ======================================================
// ADMIN PRODUCTS
// ======================================================

app.get(
  "/api/admin/products",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            p.*,
            s.name AS seller_name,
            s.email AS seller_email,
            s.status AS seller_status
          FROM products p
          LEFT JOIN sellers s
            ON s.id=p.seller_id
          ORDER BY p.id DESC
        `);

      res.json(
        result.rows.map(
          (p) => ({
            ...p,
            price:
              number(p.price),
            stock:
              integer(p.stock),
            discount_percent:
              number(
                p.discount_percent
              ),
            sale_price:
              salePrice(
                p.price,
                p.discount_percent
              )
          })
        )
      );
    } catch (error) {
      console.error(
        "Admin products:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load products"
      });
    }
  }
);

app.post(
  "/api/products",
  requireAdmin,
  async (req, res) => {
    try {
      const p =
        await getProductInput(
          req.body
        );

      if (!p.name) {
        return res.status(400).json({
          ok: false,
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          p.price
        ) ||
        p.price < 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Valid product price is required"
        });
      }

      if (!validStock(p.stock)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid stock"
        });
      }

      if (
        !validDiscount(
          p.discount
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid discount"
        });
      }

      let sellerId;

      try {
        sellerId =
          await validateSellerId(
            req.body?.seller_id
          );
      } catch (error) {
        if (
          error.message ===
          "INVALID_SELLER"
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Invalid seller ID"
          });
        }

        if (
          error.message ===
          "SELLER_NOT_FOUND"
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Seller not found"
          });
        }

        return res.status(400).json({
          ok: false,
          error:
            "Seller is blocked"
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO products
          (
            name,
            price,
            category,
            image,
            description,
            stock,
            discount_percent,
            seller_id
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [
            p.name,
            p.price,
            p.category || null,
            p.image || null,
            p.description ||
              null,
            p.stock,
            p.discount,
            sellerId
          ]
        );

      const product =
        result.rows[0];

      res.status(201).json({
        ok: true,
        product: {
          ...product,
          sale_price:
            salePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Add product:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to add product"
      });
    }
  }
);

app.put(
  "/api/products/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid product ID"
        });
      }

      const p =
        await getProductInput(
          req.body,
          true
        );

      if (!p.name) {
        return res.status(400).json({
          ok: false,
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          p.price
        ) ||
        p.price < 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid price"
        });
      }

      if (!validStock(p.stock)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid stock"
        });
      }

      if (
        !validDiscount(
          p.discount
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid discount"
        });
      }

      let sellerId;

      try {
        sellerId =
          await validateSellerId(
            req.body?.seller_id
          );
      } catch (error) {
        if (
          error.message ===
          "INVALID_SELLER"
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Invalid seller ID"
          });
        }

        if (
          error.message ===
          "SELLER_NOT_FOUND"
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Seller not found"
          });
        }

        return res.status(400).json({
          ok: false,
          error:
            "Seller is blocked"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE products
          SET
            name=$1,
            price=$2,
            category=$3,
            image=$4,
            description=$5,
            stock=$6,
            discount_percent=$7,
            seller_id=$8
          WHERE id=$9
          RETURNING *
          `,
          [
            p.name,
            p.price,
            p.category ||
              null,
            p.image ||
              null,
            p.description ||
              null,
            p.stock,
            p.discount,
            sellerId,
            id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Product not found"
        });
      }

      const product =
        result.rows[0];

      res.json({
        ok: true,
        product: {
          ...product,
          sale_price:
            salePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Edit product:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to update product"
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid product ID"
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM products
          WHERE id=$1
          RETURNING id
          `,
          [id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "Delete product:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to delete product"
      });
    }
  }
);

// ======================================================
// SELLER PRODUCTS
// ======================================================

app.get(
  "/api/seller/products",
  requireSeller,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM products
          WHERE seller_id=$1
          ORDER BY id DESC
          `,
          [req.seller.id]
        );

      res.json(
        result.rows.map(
          (p) => ({
            ...p,
            price:
              number(p.price),
            stock:
              integer(p.stock),
            discount_percent:
              number(
                p.discount_percent
              ),
            sale_price:
              salePrice(
                p.price,
                p.discount_percent
              )
          })
        )
      );
    } catch (error) {
      console.error(
        "Seller products:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load seller products"
      });
    }
  }
);

app.post(
  "/api/seller/products",
  requireSeller,
  async (req, res) => {
    try {
      const p =
        await getProductInput(
          req.body
        );

      if (!p.name) {
        return res.status(400).json({
          ok: false,
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          p.price
        ) ||
        p.price < 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Valid product price is required"
        });
      }

      if (!validStock(p.stock)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid stock"
        });
      }

      if (
        !validDiscount(
          p.discount
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid discount"
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO products
          (
            name,
            price,
            category,
            image,
            description,
            stock,
            discount_percent,
            seller_id
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [
            p.name,
            p.price,
            p.category ||
              null,
            p.image ||
              null,
            p.description ||
              null,
            p.stock,
            p.discount,
            req.seller.id
          ]
        );

      const product =
        result.rows[0];

      res.status(201).json({
        ok: true,
        product: {
          ...product,
          sale_price:
            salePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Seller add product:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to add product"
      });
    }
  }
);

app.put(
  "/api/seller/products/:id",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid product ID"
        });
      }

      const p =
        await getProductInput(
          req.body,
          true
        );

      if (!p.name) {
        return res.status(400).json({
          ok: false,
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          p.price
        ) ||
        p.price < 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid price"
        });
      }

      if (!validStock(p.stock)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid stock"
        });
      }

      if (
        !validDiscount(
          p.discount
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid discount"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE products
          SET
            name=$1,
            price=$2,
            category=$3,
            image=$4,
            description=$5,
            stock=$6,
            discount_percent=$7
          WHERE
            id=$8
            AND seller_id=$9
          RETURNING *
          `,
          [
            p.name,
            p.price,
            p.category ||
              null,
            p.image ||
              null,
            p.description ||
              null,
            p.stock,
            p.discount,
            id,
            req.seller.id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Product not found"
        });
      }

      const product =
        result.rows[0];

      res.json({
        ok: true,
        product: {
          ...product,
          sale_price:
            salePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Seller edit product:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to update seller product"
      });
    }
  }
);

app.delete(
  "/api/seller/products/:id",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid product ID"
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM products
          WHERE
            id=$1
            AND seller_id=$2
          RETURNING id
          `,
          [
            id,
            req.seller.id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "Seller delete product:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to delete seller product"
      });
    }
  }
);

// ======================================================
// CREATE ORDER
// ======================================================

app.post(
  "/api/orders",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const name =
        cleanText(
          req.body?.customer_name
        );

      const phone =
        cleanText(
          req.body?.customer_phone
        );

      const address =
        cleanText(
          req.body?.customer_address
        );

      const items =
        req.body?.items;

      if (
        !name ||
        !phone ||
        !address ||
        !Array.isArray(items) ||
        !items.length
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Customer details and cart items are required"
        });
      }

      if (!validPhone(phone)) {
        return res.status(400).json({
          ok: false,
          error:
            "Valid 10-digit mobile number is required"
        });
      }

      const quantityMap =
        new Map();

      for (const item of items) {
        const id =
          integer(item?.id);

        const quantity =
          integer(
            item?.quantity
          );

        if (
          id <= 0 ||
          quantity <= 0 ||
          quantity > 999
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Invalid cart item"
          });
        }

        const totalQuantity =
          (quantityMap.get(id) ||
            0) +
          quantity;

        if (
          totalQuantity >
          999
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Maximum quantity exceeded"
          });
        }

        quantityMap.set(
          id,
          totalQuantity
        );
      }

      const ids =
        [...quantityMap.keys()];

      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT
            p.*,
            s.name AS seller_name,
            s.status AS seller_status
          FROM products p
          LEFT JOIN sellers s
            ON s.id=p.seller_id
          WHERE
            p.id=ANY($1::int[])
            AND (
              p.seller_id IS NULL
              OR s.status='active'
            )
          FOR UPDATE OF p
          `,
          [ids]
        );

      if (
        result.rows.length !==
        ids.length
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          error:
            "One or more products are no longer available"
        });
      }

      const productMap =
        new Map();

      result.rows.forEach(
        (product) => {
          productMap.set(
            Number(product.id),
            product
          );
        }
      );

      const verifiedItems =
        [];

      let total = 0;

      for (const id of ids) {
        const product =
          productMap.get(id);

        const quantity =
          quantityMap.get(id);

        const stock =
          integer(
            product.stock
          );

        if (
          stock < quantity
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            ok: false,
            error:
              `${product.name} has only ${stock} item(s) available`
          });
        }

        const price =
          number(
            product.price
          );

        const discount =
          number(
            product.discount_percent
          );

        const finalPrice =
          salePrice(
            price,
            discount
          );

        const itemTotal =
          Math.round(
            finalPrice *
              quantity *
              100
          ) / 100;

        total += itemTotal;

        verifiedItems.push({
          id: Number(
            product.id
          ),
          name:
            product.name,
          category:
            product.category ||
            "",
          image:
            product.image ||
            "",
          quantity,
          original_price:
            price,
          discount_percent:
            discount,
          price:
            finalPrice,
          item_total:
            itemTotal,
          seller_id:
            product.seller_id
              ? Number(
                  product.seller_id
                )
              : null,
          seller_name:
            product.seller_name ||
            "Shrivi"
        });
      }

      total =
        Math.round(
          total * 100
        ) / 100;

      for (const id of ids) {
        const quantity =
          quantityMap.get(id);

        const updated =
          await client.query(
            `
            UPDATE products
            SET stock=stock-$1
            WHERE
              id=$2
              AND stock >= $1
            RETURNING id,stock
            `,
            [
              quantity,
              id
            ]
          );

        if (
          !updated.rows.length
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res.status(409).json({
            ok: false,
            error:
              "Stock changed. Please refresh your cart."
          });
        }
      }

      const order =
        await client.query(
          `
          INSERT INTO orders
          (
            customer_name,
            customer_phone,
            customer_address,
            items,
            total,
            status
          )
          VALUES
          ($1,$2,$3,$4,$5,'pending')
          RETURNING *
          `,
          [
            name,
            phone,
            address,
            JSON.stringify(
              verifiedItems
            ),
            total
          ]
        );

      await client.query(
        "COMMIT"
      );

      res.status(201).json({
        ok: true,
        order:
          order.rows[0]
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Create order:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to create order"
      });
    } finally {
      client.release();
    }
  }
);

// ======================================================
// CUSTOMER ORDERS
// ======================================================

app.get(
  "/api/customer/orders",
  requireCustomer,
  async (req, res) => {
    try {
      const phone =
        req.customer.phone;

      if (!phone) {
        return res.json([]);
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            status,
            total,
            items,
            created_at
          FROM orders
          WHERE customer_phone=$1
          ORDER BY id DESC
          `,
          [phone]
        );

      res.json(
        result.rows.map(
          (order) => ({
            ...order,
            total:
              number(
                order.total
              ),
            items:
              Array.isArray(
                order.items
              )
                ? order.items
                : []
          })
        )
      );
    } catch (error) {
      console.error(
        "Customer orders:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load customer orders"
      });
    }
  }
);

// ======================================================
// TRACK ORDER
// ======================================================

app.get(
  "/api/orders/track/:id",
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order ID"
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            status,
            total,
            items,
            created_at
          FROM orders
          WHERE id=$1
          LIMIT 1
          `,
          [id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      const order =
        result.rows[0];

      res.json({
        id: order.id,
        status:
          order.status,
        total:
          number(
            order.total
          ),
        items:
          Array.isArray(
            order.items
          )
            ? order.items
            : [],
        created_at:
          order.created_at
      });
    } catch (error) {
      console.error(
        "Track order:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to track order"
      });
    }
  }
);

// ======================================================
// ADMIN ORDERS
// ======================================================

app.get(
  "/api/orders",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM orders
          ORDER BY id DESC
          `
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "Admin orders:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to fetch orders"
      });
    }
  }
);

app.put(
  "/api/orders/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      const status =
        cleanText(
          req.body?.status
        ).toLowerCase();

      const allowed = [
        "pending",
        "confirmed",
        "shipped",
        "delivered",
        "cancelled"
      ];

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order ID"
        });
      }

      if (
        !allowed.includes(
          status
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order status"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE orders
          SET status=$1
          WHERE id=$2
          RETURNING *
          `,
          [
            status,
            id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      res.json({
        ok: true,
        order:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Admin order status:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to update order status"
      });
    }
  }
);

// ======================================================
// SELLER ORDERS
// ======================================================

app.get(
  "/api/seller/orders",
  requireSeller,
  async (req, res) => {
    try {
      const sellerId =
        Number(
          req.seller.id
        );

      const result =
        await pool.query(
          `
          SELECT *
          FROM orders
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(
                items,
                '[]'::jsonb
              )
            ) AS item
            WHERE NULLIF(
              item->>'seller_id',
              ''
            )::integer=$1
          )
          ORDER BY id DESC
          `,
          [sellerId]
        );

      res.json(
        result.rows.map(
          (order) => {
            const allItems =
              Array.isArray(
                order.items
              )
                ? order.items
                : [];

            const sellerItems =
              allItems.filter(
                (item) =>
                  Number(
                    item?.seller_id
                  ) === sellerId
              );

            const sellerTotal =
              Math.round(
                sellerItems.reduce(
                  (
                    sum,
                    item
                  ) =>
                    sum +
                    number(
                      item?.item_total
                    ),
                  0
                ) * 100
              ) / 100;

            return {
              ...order,
              items:
                sellerItems,
              seller_total:
                sellerTotal
            };
          }
        )
      );
    } catch (error) {
      console.error(
        "Seller orders:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load seller orders"
      });
    }
  }
);

// ======================================================
// SELLER DASHBOARD
// ======================================================

app.get(
  "/api/seller/dashboard",
  requireSeller,
  async (req, res) => {
    try {
      const sellerId =
        Number(
          req.seller.id
        );

      const products =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM products
          WHERE seller_id=$1
          `,
          [sellerId]
        );

      const stock =
        await pool.query(
          `
          SELECT
            COALESCE(
              SUM(stock),
              0
            ) AS stock
          FROM products
          WHERE seller_id=$1
          `,
          [sellerId]
        );

      const orders =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM orders
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(
                items,
                '[]'::jsonb
              )
            ) AS item
            WHERE NULLIF(
              item->>'seller_id',
              ''
            )::integer=$1
          )
          `,
          [sellerId]
        );

      const revenue =
        await pool.query(
          `
          SELECT
            COALESCE(
              SUM(
                (
                  SELECT
                    COALESCE(
                      SUM(
                        COALESCE(
                          NULLIF(
                            item->>'item_total',
                            ''
                          )::numeric,
                          0
                        )
                      ),
                      0
                    )
                  FROM jsonb_array_elements(
                    COALESCE(
                      orders.items,
                      '[]'::jsonb
                    )
                  ) AS item
                  WHERE NULLIF(
                    item->>'seller_id',
                    ''
                  )::integer=$1
                )
              ),
              0
            ) AS revenue
          FROM orders
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(
                items,
                '[]'::jsonb
              )
            ) AS item
            WHERE NULLIF(
              item->>'seller_id',
              ''
            )::integer=$1
          )
          `,
          [sellerId]
        );

      res.json({
        products:
          integer(
            products.rows[0].count
          ),

        stock:
          integer(
            stock.rows[0].stock
          ),

        orders:
          integer(
            orders.rows[0].count
          ),

        revenue:
          number(
            revenue.rows[0].revenue
          )
      });
    } catch (error) {
      console.error(
        "Seller dashboard:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load seller dashboard"
      });
    }
  }
);

// ======================================================
// SELLER ORDER STATUS
// ======================================================

app.put(
  "/api/seller/orders/:id/status",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      const status =
        cleanText(
          req.body?.status
        ).toLowerCase();

      const allowed = [
        "confirmed",
        "shipped",
        "delivered",
        "cancelled"
      ];

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order ID"
        });
      }

      if (
        !allowed.includes(
          status
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid order status"
        });
      }

      const sellerId =
        Number(
          req.seller.id
        );

      const check =
        await pool.query(
          `
          SELECT id
          FROM orders
          WHERE id=$1
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(
                items,
                '[]'::jsonb
              )
            ) AS item
            WHERE NULLIF(
              item->>'seller_id',
              ''
            )::integer=$2
          )
          `,
          [
            id,
            sellerId
          ]
        );

      if (!check.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found for this seller"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE orders
          SET status=$1
          WHERE id=$2
          RETURNING *
          `,
          [
            status,
            id
          ]
        );

      res.json({
        ok: true,
        order:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Seller status:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to update order status"
      });
    }
  }
);

// ======================================================
// ADMIN SELLERS
// ======================================================

app.get(
  "/api/admin/sellers",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            s.id,
            s.name,
            s.email,
            s.phone,
            s.status,
            s.created_at,
            COUNT(p.id) AS product_count
          FROM sellers s
          LEFT JOIN products p
            ON p.seller_id=s.id
          GROUP BY
            s.id,
            s.name,
            s.email,
            s.phone,
            s.status,
            s.created_at
          ORDER BY s.id DESC
        `);

      res.json(
        result.rows.map(
          (seller) => ({
            ...seller,
            product_count:
              integer(
                seller.product_count
              )
          })
        )
      );
    } catch (error) {
      console.error(
        "Admin sellers:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load sellers"
      });
    }
  }
);

app.put(
  "/api/admin/sellers/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        integer(
          req.params.id
        );

      const status =
        cleanText(
          req.body?.status
        ).toLowerCase();

      if (id <= 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid seller ID"
        });
      }

      if (
        ![
          "active",
          "blocked"
        ].includes(status)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid seller status"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE sellers
          SET status=$1
          WHERE id=$2
          RETURNING
            id,
            name,
            email,
            phone,
            status,
            created_at
          `,
          [
            status,
            id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Seller not found"
        });
      }

      res.json({
        ok: true,
        seller:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Seller status:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to update seller status"
      });
    }
  }
);

// ======================================================
// ADMIN DASHBOARD
// ======================================================

app.get(
  "/api/dashboard",
  requireAdmin,
  async (req, res) => {
    try {
      const products =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM products
          `
        );

      const orders =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM orders
          `
        );

      const sellers =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM sellers
          `
        );

      const customers =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM customers
          `
        );

      res.json({
        products:
          integer(
            products.rows[0].count
          ),

        orders:
          integer(
            orders.rows[0].count
          ),

        sellers:
          integer(
            sellers.rows[0].count
          ),

        customers:
          integer(
            customers.rows[0].count
          )
      });
    } catch (error) {
      console.error(
        "Dashboard:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Database error"
      });
    }
  }
);

// ======================================================
// DATABASE INITIALIZATION
// ======================================================

async function initializeDatabase() {

  // ----------------------------------------------------
  // SELLERS
  // ----------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      created_at
        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS phone TEXT
  `);

  await pool.query(`
    ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS password_hash TEXT
  `);

  await pool.query(`
    ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS
    status TEXT NOT NULL
    DEFAULT 'active'
  `);

  await pool.query(`
    UPDATE sellers
    SET status='active'
    WHERE status IS NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    sellers_email_unique_idx
    ON sellers(LOWER(email))
    WHERE email IS NOT NULL
  `);

  // ----------------------------------------------------
  // CUSTOMERS
  // ----------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      created_at
        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    customers_email_unique_idx
    ON customers(LOWER(email))
  `);

  // ----------------------------------------------------
  // PRODUCTS
  // ----------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10,2)
        NOT NULL DEFAULT 0,
      category TEXT,
      image TEXT,
      description TEXT,
      created_at
        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS
    stock INTEGER NOT NULL
    DEFAULT 999999
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS
    discount_percent
    NUMERIC(5,2)
    NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS
    seller_id INTEGER
  `);

  // ----------------------------------------------------
  // ORDERS
  // ----------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      total NUMERIC(10,2)
        DEFAULT 0,
      created_at
        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS
    customer_name TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS
    customer_phone TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS
    customer_address TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS
    items JSONB
  `);

  console.log(
    "SHRIVI database tables ready"
  );
}

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await pool.query(
        "SELECT NOW()"
      );

      res.json({
        ok: true,
        service:
          "Shrivi Marketplace",
        database:
          "connected"
      });
    } catch (error) {
      console.error(
        "Health:",
        error
      );

      res.status(500).json({
        ok: false,
        service:
          "Shrivi Marketplace",
        database:
          "disconnected"
      });
    }
  }
);

// ======================================================
// 404 API HANDLER
// ======================================================

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "API endpoint not found"
    });
  }
);

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "GLOBAL SERVER ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(
      error.status || 500
    ).json({
      ok: false,
      error:
        error.message ||
        "Something went wrong"
    });
  }
);

// ======================================================
// START
// ======================================================

async function start() {
  try {
    await pool.query(
      "SELECT NOW()"
    );

    console.log(
      "SHRIVI PostgreSQL connected successfully"
    );

    await initializeDatabase();

    await prepareAdminPassword();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `SHRIVI server running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "SHRIVI startup error:",
      error
    );

    process.exit(1);
  }
}

start();
