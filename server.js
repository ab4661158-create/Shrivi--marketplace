const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { v2: cloudinary } = require("cloudinary");
const Razorpay = require("razorpay");

const app = express();

const PORT = Number(process.env.PORT) || 10000;

// =====================================================
// DATABASE
// =====================================================

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", error => {
  console.error("POSTGRES POOL ERROR:", error);
});

// =====================================================
// CLOUDINARY
// =====================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// =====================================================
// RAZORPAY
// =====================================================

let razorpay = null;

if (
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET
) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  console.log("Razorpay configured.");
} else {
  console.warn(
    "WARNING: Razorpay environment variables are not configured."
  );
}

// =====================================================
// EXPRESS
// =====================================================

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  express.json({
    limit: "5mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "5mb"
  })
);

// =====================================================
// SESSION
// =====================================================

const sessionSecret =
  process.env.SESSION_SECRET;

app.use(
  session({
    secret:
      sessionSecret ||
      "CHANGE_THIS_SESSION_SECRET",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,

      secure:
        process.env.NODE_ENV === "production",

      sameSite: "lax",

      maxAge:
        24 * 60 * 60 * 1000
    }
  })
);

// =====================================================
// IMAGE UPLOAD
// =====================================================

const imageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error(
          "Only JPG, PNG, WEBP and GIF images are allowed."
        )
      );
    }

    cb(null, true);
  }
});

// =====================================================
// HELPERS
// =====================================================

function clean(value) {
  return String(value ?? "").trim();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    clean(email).toLowerCase()
  );
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 200
  );
}

function validPhone(phone) {
  return (
    !phone ||
    /^[0-9]{10}$/.test(phone)
  );
}

function positiveInteger(value) {
  const n = Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  );
}

function validStock(value) {
  const n = Number(value);

  return (
    Number.isInteger(n) &&
    n >= 0
  );
}

function validDiscount(value) {
  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n >= 0 &&
    n <= 100
  );
}

function calculateSalePrice(
  price,
  discount
) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;

  return Math.round(
    (p - (p * d) / 100) * 100
  ) / 100;
}

function normalizeProduct(product) {
  const price =
    Number(product.price) || 0;

  const discount =
    Number(product.discount_percent) || 0;

  return {
    ...product,

    id: Number(product.id),

    price,

    original_price: price,

    discount_percent: discount,

    sale_price:
      calculateSalePrice(
        price,
        discount
      ),

    stock:
      Math.max(
        0,
        Number(product.stock) || 0
      ),

    seller_id:
      product.seller_id == null
        ? null
        : Number(product.seller_id)
  };
}

function normalizeOrder(order) {
  let items = order.items;

  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }

  return {
    ...order,

    id: Number(order.id),

    customer_id:
      order.customer_id == null
        ? null
        : Number(order.customer_id),

    total:
      Number(order.total) || 0,

    items:
      Array.isArray(items)
        ? items
        : []
  };
}

function safeError(error) {
  return (
    error?.message ||
    "Something went wrong"
  );
}

// =====================================================
// AUTH MIDDLEWARE
// =====================================================

function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    return res.status(401).json({
      error: "Admin login required"
    });
  }

  next();
}

function requireSeller(req, res, next) {
  if (!req.session?.seller) {
    return res.status(401).json({
      error: "Seller login required"
    });
  }

  next();
}

function requireCustomer(req, res, next) {
  if (!req.session?.customer) {
    return res.status(401).json({
      error: "Customer login required"
    });
  }

  next();
}

// =====================================================
// PRODUCT VALIDATION
// =====================================================

function validateProductInput(body) {
  const name = clean(body?.name);

  const price = Number(body?.price);

  const stock =
    body?.stock === "" ||
    body?.stock === undefined ||
    body?.stock === null
      ? 0
      : Number(body.stock);

  const discount =
    body?.discount_percent === "" ||
    body?.discount_percent === undefined ||
    body?.discount_percent === null
      ? 0
      : Number(body.discount_percent);

  if (!name) {
    throw new Error(
      "Product name is required"
    );
  }

  if (name.length > 250) {
    throw new Error(
      "Product name is too long"
    );
  }

  if (
    !Number.isFinite(price) ||
    price < 0 ||
    price > 100000000
  ) {
    throw new Error(
      "Valid product price is required"
    );
  }

  if (!validStock(stock)) {
    throw new Error(
      "Stock must be a whole number 0 or greater"
    );
  }

  if (!validDiscount(discount)) {
    throw new Error(
      "Discount must be between 0 and 100"
    );
  }

  return {
    name,
    price,

    category:
      clean(body?.category) || null,

    image:
      clean(body?.image) || null,

    description:
      clean(body?.description) || null,

    stock,

    discount
  };
}

// =====================================================
// PAGES
// =====================================================

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

app.get("/seller", (req, res) => {
  res.sendFile(
    path.join(__dirname, "seller.html")
  );
});

app.get("/app", (req, res) => {
  res.sendFile(
    path.join(__dirname, "app-v2.html")
  );
});

app.get("/manifest.json", (req, res) => {
  res.sendFile(
    path.join(__dirname, "manifest.json")
  );
});

// =====================================================
// HEALTH
// =====================================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "Shrivi Marketplace",
      database: "connected",
      razorpay:
        razorpay ? "configured" : "not_configured",
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "HEALTH ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      service: "Shrivi Marketplace",
      database: "error"
    });
  }
});

// =====================================================
// ADMIN LOGIN
// =====================================================

app.post("/api/login", async (req, res) => {
  try {
    const username =
      clean(req.body?.username);

    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    const adminUser =
      process.env.ADMIN_USER || "admin";

    const adminPassword =
      process.env.ADMIN_PASSWORD || "";

    const adminHash =
      process.env.ADMIN_PASSWORD_HASH || "";

    if (!adminPassword && !adminHash) {
      return res.status(500).json({
        error:
          "Admin login is not configured in Render Environment Variables"
      });
    }

    if (username !== adminUser) {
      return res.status(401).json({
        error:
          "Invalid username or password"
      });
    }

    let passwordOk = false;

    if (adminHash) {
      passwordOk =
        await bcrypt.compare(
          password,
          adminHash
        );
    } else {
      passwordOk =
        password === adminPassword;
    }

    if (!passwordOk) {
      return res.status(401).json({
        error:
          "Invalid username or password"
      });
    }

    req.session.admin = {
      username: adminUser
    };

    req.session.save(error => {
      if (error) {
        console.error(
          "ADMIN SESSION ERROR:",
          error
        );

        return res.status(500).json({
          error: "Session error"
        });
      }

      res.json({
        ok: true,
        username: adminUser
      });
    });
  } catch (error) {
    console.error(
      "ADMIN LOGIN ERROR:",
      error
    );

    res.status(500).json({
      error: safeError(error)
    });
  }
});

// =====================================================
// ADMIN LOGOUT
// =====================================================

app.post("/api/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        error: "Logout error"
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      ok: true
    });
  });
});

// =====================================================
// ADMIN ME
// =====================================================

app.get("/api/me", (req, res) => {
  if (!req.session?.admin) {
    return res.status(401).json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    username:
      req.session.admin.username
  });
});

// =====================================================
// SELLER REGISTER
// =====================================================

app.post(
  "/api/seller/register",
  async (req, res) => {
    try {
      const name =
        clean(req.body?.name);

      const email =
        clean(req.body?.email)
          .toLowerCase();

      const phone =
        clean(req.body?.phone);

      const password =
        req.body?.password || "";

      if (!name) {
        return res.status(400).json({
          error:
            "Seller name is required"
        });
      }

      if (!validEmail(email)) {
        return res.status(400).json({
          error:
            "Valid email is required"
        });
      }

      if (!validPhone(phone)) {
        return res.status(400).json({
          error:
            "Phone must be 10 digits"
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          error:
            "Password must be at least 8 characters"
        });
      }

      const existing =
        await pool.query(
          `SELECT id
           FROM sellers
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [email]
        );

      if (existing.rows.length) {
        return res.status(409).json({
          error:
            "Seller email already exists"
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `INSERT INTO sellers
           (name,email,phone,password_hash,status)
           VALUES
           ($1,$2,$3,$4,'active')
           RETURNING
           id,name,email,phone,status,created_at`,
          [
            name,
            email,
            phone || null,
            hash
          ]
        );

      const seller =
        result.rows[0];

      req.session.seller =
        seller;

      req.session.save(error => {
        if (error) {
          return res.status(500).json({
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
        "SELLER REGISTER ERROR:",
        error
      );

      res.status(500).json({
        error: safeError(error)
      });
    }
  }
);

// =====================================================
// SELLER LOGIN
// =====================================================

app.post(
  "/api/seller/login",
  async (req, res) => {
    try {
      const email =
        clean(req.body?.email)
          .toLowerCase();

      const password =
        req.body?.password || "";

      if (!validEmail(email)) {
        return res.status(400).json({
          error:
            "Valid email is required"
        });
      }

      const result =
        await pool.query(
          `SELECT *
           FROM sellers
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [email]
        );

      if (!result.rows.length) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      const seller =
        result.rows[0];

      const passwordOk =
        await bcrypt.compare(
          password,
          seller.password_hash || ""
        );

      if (!passwordOk) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      if (seller.status !== "active") {
        return res.status(403).json({
          error:
            "Seller account is not active"
        });
      }

      delete seller.password_hash;

      req.session.seller =
        seller;

      req.session.save(error => {
        if (error) {
          return res.status(500).json({
            error: "Session error"
          });
        }

        res.json({
          ok: true,
          seller
        });
      });
    } catch (error) {
      console.error(
        "SELLER LOGIN ERROR:",
        error
      );

      res.status(500).json({
        error: safeError(error)
      });
    }
  }
);

// =====================================================
// SELLER LOGOUT
// =====================================================

app.post(
  "/api/seller/logout",
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        return res.status(500).json({
          error:
            "Logout failed"
        });
      }

      res.clearCookie("connect.sid");

      res.json({
        ok: true
      });
    });
  }
);

// =====================================================
// SELLER ME
// =====================================================

app.get(
  "/api/seller/me",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        Number(req.session.seller.id);

      const result =
        await pool.query(
          `SELECT
           id,name,email,phone,status,created_at
           FROM sellers
           WHERE id=$1
           LIMIT 1`,
          [id]
        );

      if (!result.rows.length) {
        req.session.seller = null;

        return res.status(401).json({
          loggedIn: false
        });
      }

      if (
        result.rows[0].status !==
        "active"
      ) {
        req.session.seller = null;

        return res.status(403).json({
          loggedIn: false,
          error:
            "Seller account is not active"
        });
      }

      req.session.seller =
        result.rows[0];

      res.json({
        loggedIn: true,
        seller:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "SELLER ME ERROR:",
        error
      );

      res.status(500).json({
        error: safeError(error)
      });
    }
  }
);

// =====================================================
// PUBLIC PRODUCTS
// =====================================================

app.get(
  "/api/products",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS seller_name
           FROM products p
           LEFT JOIN sellers s
           ON s.id=p.seller_id
           ORDER BY p.id DESC`
        );

      res.json(
        result.rows.map(
          normalizeProduct
        )
      );
    } catch (error) {
      console.error(
        "PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load products"
      });
    }
  }
);

// =====================================================
// CLOUDINARY IMAGE UPLOAD
// =====================================================

app.post(
  "/api/seller/upload/image",
  requireSeller,
  (req, res) => {
    imageUpload.single("image")(
      req,
      res,
      async error => {
        if (error) {
          return res.status(400).json({
            error:
              error.message ||
              "Image upload failed"
          });
        }

        try {
          if (!req.file) {
            return res.status(400).json({
              error:
                "Please select an image."
            });
          }

          if (
            !process.env.CLOUDINARY_CLOUD_NAME ||
            !process.env.CLOUDINARY_API_KEY ||
            !process.env.CLOUDINARY_API_SECRET
          ) {
            return res.status(500).json({
              error:
                "Cloudinary is not configured."
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
                      uploadError,
                      uploadResult
                    ) => {
                      if (uploadError) {
                        reject(
                          uploadError
                        );
                      } else {
                        resolve(
                          uploadResult
                        );
                      }
                    }
                  );

                stream.end(
                  req.file.buffer
                );
              }
            );

          res.json({
            ok: true,
            image:
              result.secure_url,
            url:
              result.secure_url
          });
        } catch (error) {
          console.error(
            "CLOUDINARY ERROR:",
            error
          );

          res.status(500).json({
            error:
              "Image upload failed"
          });
        }
      }
    );
  }
);

// =====================================================
// SELLER PRODUCTS
// =====================================================

app.get(
  "/api/seller/products",
  requireSeller,
  async (req, res) => {
    try {
      const sellerId =
        Number(
          req.session.seller.id
        );

      const result =
        await pool.query(
          `SELECT *
           FROM products
           WHERE seller_id=$1
           ORDER BY id DESC`,
          [sellerId]
        );

      res.json(
        result.rows.map(
          normalizeProduct
        )
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load seller products"
      });
    }
  }
);

// =====================================================
// SELLER ADD PRODUCT
// =====================================================

app.post(
  "/api/seller/products",
  requireSeller,
  async (req, res) => {
    try {
      const data =
        validateProductInput(
          req.body
        );

      const sellerId =
        Number(
          req.session.seller.id
        );

      const result =
        await pool.query(
          `INSERT INTO products
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
          RETURNING *`,
          [
            data.name,
            data.price,
            data.category,
            data.image,
            data.description,
            data.stock,
            data.discount,
            sellerId
          ]
        );

      res.status(201).json({
        ok: true,
        product:
          normalizeProduct(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "SELLER ADD PRODUCT ERROR:",
        error
      );

      res.status(400).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// SELLER UPDATE PRODUCT
// =====================================================

app.put(
  "/api/seller/products/:id",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!positiveInteger(id)) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const data =
        validateProductInput(
          req.body
        );

      const sellerId =
        Number(
          req.session.seller.id
        );

      const result =
        await pool.query(
          `UPDATE products
           SET
             name=$1,
             price=$2,
             category=$3,
             image=$4,
             description=$5,
             stock=$6,
             discount_percent=$7
           WHERE id=$8
           AND seller_id=$9
           RETURNING *`,
          [
            data.name,
            data.price,
            data.category,
            data.image,
            data.description,
            data.stock,
            data.discount,
            id,
            sellerId
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true,
        product:
          normalizeProduct(
            result.rows[0]
          )
      });
    } catch (error) {
      res.status(400).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// SELLER DELETE PRODUCT
// =====================================================

app.delete(
  "/api/seller/products/:id",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const sellerId =
        Number(
          req.session.seller.id
        );

      if (!positiveInteger(id)) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const result =
        await pool.query(
          `DELETE FROM products
           WHERE id=$1
           AND seller_id=$2
           RETURNING id`,
          [
            id,
            sellerId
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to delete product"
      });
    }
  }
);

// =====================================================
// CUSTOMER REGISTER
// =====================================================

app.post(
  "/api/customer/register",
  async (req, res) => {
    try {
      const name =
        clean(req.body?.name);

      const email =
        clean(req.body?.email)
          .toLowerCase();

      const phone =
        clean(req.body?.phone);

      const password =
        req.body?.password || "";

      if (!name) {
        return res.status(400).json({
          error:
            "Name is required"
        });
      }

      if (!validEmail(email)) {
        return res.status(400).json({
          error:
            "Valid email is required"
        });
      }

      if (!validPhone(phone)) {
        return res.status(400).json({
          error:
            "Phone must be 10 digits"
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          error:
            "Password must be at least 8 characters"
        });
      }

      const existing =
        await pool.query(
          `SELECT id
           FROM customers
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [email]
        );

      if (existing.rows.length) {
        return res.status(409).json({
          error:
            "Email already registered"
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `INSERT INTO customers
          (
            name,
            email,
            phone,
            password_hash,
            status
          )
          VALUES
          ($1,$2,$3,$4,'active')
          RETURNING
          id,name,email,phone,status,created_at`,
          [
            name,
            email,
            phone || null,
            hash
          ]
        );

      const customer =
        result.rows[0];

      req.session.customer =
        customer;

      req.session.save(error => {
        if (error) {
          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.status(201).json({
          ok: true,
          customer
        });
      });
    } catch (error) {
      console.error(
        "CUSTOMER REGISTER ERROR:",
        error
      );

      res.status(500).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// CUSTOMER LOGIN
// =====================================================

app.post(
  "/api/customer/login",
  async (req, res) => {
    try {
      const email =
        clean(req.body?.email)
          .toLowerCase();

      const password =
        req.body?.password || "";

      if (!validEmail(email)) {
        return res.status(400).json({
          error:
            "Valid email is required"
        });
      }

      const result =
        await pool.query(
          `SELECT *
           FROM customers
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [email]
        );

      if (!result.rows.length) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      const customer =
        result.rows[0];

      const passwordOk =
        await bcrypt.compare(
          password,
          customer.password_hash || ""
        );

      if (!passwordOk) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      if (
        customer.status &&
        customer.status !== "active"
      ) {
        return res.status(403).json({
          error:
            "Customer account is not active"
        });
      }

      delete customer.password_hash;

      req.session.customer =
        customer;

      req.session.save(error => {
        if (error) {
          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.json({
          ok: true,
          customer
        });
      });
    } catch (error) {
      res.status(500).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// CUSTOMER LOGOUT
// =====================================================

app.post(
  "/api/customer/logout",
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        return res.status(500).json({
          error:
            "Logout failed"
        });
      }

      res.clearCookie("connect.sid");

      res.json({
        ok: true
      });
    });
  }
);

// =====================================================
// CUSTOMER ME
// =====================================================

app.get(
  "/api/customer/me",
  async (req, res) => {
    try {
      if (!req.session?.customer) {
        return res.json({
          loggedIn: false
        });
      }

      const result =
        await pool.query(
          `SELECT
           id,name,email,phone,status,created_at
           FROM customers
           WHERE id=$1
           LIMIT 1`,
          [
            req.session.customer.id
          ]
        );

      if (!result.rows.length) {
        req.session.customer = null;

        return res.json({
          loggedIn: false
        });
      }

      if (
        result.rows[0].status !==
        "active"
      ) {
        req.session.customer = null;

        return res.json({
          loggedIn: false
        });
      }

      req.session.customer =
        result.rows[0];

      res.json({
        loggedIn: true,
        customer:
          result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// CREATE RAZORPAY ORDER
// =====================================================

app.post(
  "/api/payment/create-order",
  requireCustomer,
  async (req, res) => {
    try {
      if (!razorpay) {
        return res.status(503).json({
          error:
            "Razorpay is not configured."
        });
      }

      const amount =
        Number(req.body?.amount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          error:
            "Invalid payment amount"
        });
      }

      if (amount > 10000000) {
        return res.status(400).json({
          error:
            "Payment amount is too large"
        });
      }

      const razorpayOrder =
        await razorpay.orders.create({
          amount:
            Math.round(amount * 100),

          currency: "INR",

          receipt:
            `shrivi_${Date.now()}`
        });

      res.json({
        ok: true,

        key:
          process.env.RAZORPAY_KEY_ID,

        order:
          razorpayOrder
      });
    } catch (error) {
      console.error(
        "RAZORPAY CREATE ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Unable to create payment order"
      });
    }
  }
);

// =====================================================
// RAZORPAY VERIFY
// =====================================================

app.post(
  "/api/payment/verify",
  requireCustomer,
  async (req, res) => {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = req.body || {};

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        return res.status(400).json({
          error:
            "Incomplete payment verification data"
        });
      }

      if (
        !process.env.RAZORPAY_KEY_SECRET
      ) {
        return res.status(500).json({
          error:
            "Razorpay secret is not configured"
        });
      }

      const generatedSignature =
        crypto
          .createHmac(
            "sha256",
            process.env.RAZORPAY_KEY_SECRET
          )
          .update(
            `${razorpay_order_id}|${razorpay_payment_id}`
          )
          .digest("hex");

      const valid =
        crypto.timingSafeEqual(
          Buffer.from(
            generatedSignature
          ),
          Buffer.from(
            razorpay_signature
          )
        );

      if (!valid) {
        return res.status(400).json({
          error:
            "Invalid payment signature"
        });
      }

      res.json({
        ok: true,
        verified: true,
        payment_id:
          razorpay_payment_id,
        order_id:
          razorpay_order_id
      });
    } catch (error) {
      console.error(
        "PAYMENT VERIFY ERROR:",
        error
      );

      res.status(400).json({
        error:
          "Payment verification failed"
      });
    }
  }
);

// =====================================================
// CUSTOMER ORDERS
// =====================================================

app.get(
  "/api/customer/orders",
  requireCustomer,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE customer_id=$1
           ORDER BY id DESC`,
          [
            req.session.customer.id
          ]
        );

      res.json(
        result.rows.map(
          normalizeOrder
        )
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load orders"
      });
    }
  }
);

// =====================================================
// CREATE CUSTOMER ORDER
// =====================================================

async function createCustomerOrder(
  req,
  res
) {
  if (!req.session?.customer) {
    return res.status(401).json({
      error:
        "Customer login required"
    });
  }

  const client =
    await pool.connect();

  try {
    const incomingItems =
      Array.isArray(req.body?.items)
        ? req.body.items
        : [];

    if (!incomingItems.length) {
      return res.status(400).json({
        error:
          "Order items are required"
      });
    }

    const requested =
      new Map();

    for (const item of incomingItems) {
      const id =
        Number(item?.id);

      const quantity =
        Number(item?.quantity);

      if (
        !positiveInteger(id) ||
        !positiveInteger(quantity)
      ) {
        return res.status(400).json({
          error:
            "Invalid product or quantity"
        });
      }

      requested.set(
        id,
        (requested.get(id) || 0) +
          quantity
      );
    }

    const ids =
      [...requested.keys()];

    await client.query("BEGIN");

    const productsResult =
      await client.query(
        `SELECT *
         FROM products
         WHERE id=ANY($1::int[])
         FOR UPDATE`,
        [ids]
      );

    if (
      productsResult.rows.length !==
      ids.length
    ) {
      throw new Error(
        "One or more products no longer exist"
      );
    }

    const productMap =
      new Map();

    for (
      const product
      of productsResult.rows
    ) {
      productMap.set(
        Number(product.id),
        product
      );
    }

    const orderItems = [];

    for (
      const [id, quantity]
      of requested
    ) {
      const product =
        productMap.get(id);

      const stock =
        Number(product.stock) || 0;

      if (quantity > stock) {
        throw new Error(
          `${product.name} has only ${stock} item(s) in stock`
        );
      }

      const originalPrice =
        Number(product.price) || 0;

      const discount =
        Number(
          product.discount_percent
        ) || 0;

      const salePrice =
        calculateSalePrice(
          originalPrice,
          discount
        );

      const itemTotal =
        Math.round(
          salePrice *
            quantity *
            100
        ) / 100;

      orderItems.push({
        id,

        product_id: id,

        name:
          product.name,

        image:
          product.image || "",

        price:
          salePrice,

        original_price:
          originalPrice,

        quantity,

        seller_id:
          product.seller_id == null
            ? null
            : Number(product.seller_id),

        item_total:
          itemTotal
      });
    }

    const total =
      Math.round(
        orderItems.reduce(
          (sum, item) =>
            sum +
            Number(item.item_total),
          0
        ) * 100
      ) / 100;

    const customer =
      req.session.customer;

    const customerName =
      clean(
        req.body?.customer_name
      ) ||
      clean(req.body?.name) ||
      customer.name ||
      "";

    const customerPhone =
      clean(
        req.body?.customer_phone
      ) ||
      clean(req.body?.phone) ||
      customer.phone ||
      "";

    const customerAddress =
      clean(
        req.body?.customer_address
      ) ||
      clean(req.body?.address) ||
      "";

    if (!customerAddress) {
      throw new Error(
        "Delivery address is required"
      );
    }

    const paymentMethod =
      clean(
        req.body?.payment_method
      ).toLowerCase() || "cod";

    const allowedPaymentMethods = [
      "cod",
      "razorpay"
    ];

    if (
      !allowedPaymentMethods.includes(
        paymentMethod
      )
    ) {
      throw new Error(
        "Invalid payment method"
      );
    }

    if (
      paymentMethod === "razorpay" &&
      !req.body?.payment_id
    ) {
      throw new Error(
        "Payment is required"
      );
    }

    const paymentStatus =
      paymentMethod === "razorpay"
        ? "paid"
        : "pending";

    const orderResult =
      await client.query(
        `INSERT INTO orders
        (
          customer_id,
          customer_name,
          customer_phone,
          customer_address,
          items,
          total,
          status,
          payment_method,
          payment_status,
          payment_id,
          razorpay_order_id
        )
        VALUES
        (
          $1,$2,$3,$4,$5::jsonb,$6,
          'pending',$7,$8,$9,$10
        )
        RETURNING *`,
        [
          customer.id,
          customerName,
          customerPhone,
          customerAddress,
          JSON.stringify(orderItems),
          total,
          paymentMethod,
          paymentStatus,
          req.body?.payment_id || null,
          req.body?.razorpay_order_id || null
        ]
      );

    for (const item of orderItems) {
      const update =
        await client.query(
          `UPDATE products
           SET stock=stock-$1
           WHERE id=$2
           AND stock >= $1
           RETURNING id,stock`,
          [
            item.quantity,
            item.product_id
          ]
        );

      if (!update.rows.length) {
        throw new Error(
          `${item.name} is out of stock`
        );
      }
    }

    await client.query("COMMIT");

    res.status(201).json({
      ok: true,

      order:
        normalizeOrder(
          orderResult.rows[0]
        )
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error(
      "CREATE ORDER ERROR:",
      error
    );

    res.status(400).json({
      error:
        safeError(error)
    });
  } finally {
    client.release();
  }
}

app.post(
  "/api/customer/orders",
  createCustomerOrder
);

app.post(
  "/api/orders",
  createCustomerOrder
);

// =====================================================
// ADMIN PRODUCTS
// =====================================================

app.get(
  "/api/admin/products",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS seller_name,
             s.email AS seller_email
           FROM products p
           LEFT JOIN sellers s
           ON s.id=p.seller_id
           ORDER BY p.id DESC`
        );

      res.json(
        result.rows.map(
          normalizeProduct
        )
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load products"
      });
    }
  }
);

// =====================================================
// VERIFY SELLER
// =====================================================

async function verifySellerId(
  sellerId
) {
  const id =
    Number(sellerId);

  if (!positiveInteger(id)) {
    throw new Error(
      "Invalid seller ID"
    );
  }

  const result =
    await pool.query(
      `SELECT id,status
       FROM sellers
       WHERE id=$1
       LIMIT 1`,
      [id]
    );

  if (!result.rows.length) {
    throw new Error(
      "Seller not found"
    );
  }

  if (
    result.rows[0].status !==
    "active"
  ) {
    throw new Error(
      "Seller is not active"
    );
  }

  return id;
}

// =====================================================
// ADMIN ADD PRODUCT
// =====================================================

app.post(
  "/api/products",
  requireAdmin,
  async (req, res) => {
    try {
      const data =
        validateProductInput(
          req.body
        );

      let sellerId =
        req.body?.seller_id;

      if (
        sellerId !== undefined &&
        sellerId !== null &&
        sellerId !== ""
      ) {
        sellerId =
          await verifySellerId(
            sellerId
          );
      } else {
        sellerId = null;
      }

      const result =
        await pool.query(
          `INSERT INTO products
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
          RETURNING *`,
          [
            data.name,
            data.price,
            data.category,
            data.image,
            data.description,
            data.stock,
            data.discount,
            sellerId
          ]
        );

      res.status(201).json({
        ok: true,
        product:
          normalizeProduct(
            result.rows[0]
          )
      });
    } catch (error) {
      res.status(400).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// ADMIN UPDATE PRODUCT
// =====================================================

app.put(
  "/api/products/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!positiveInteger(id)) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const data =
        validateProductInput(
          req.body
        );

      let sellerId =
        req.body?.seller_id;

      if (
        sellerId !== undefined &&
        sellerId !== null &&
        sellerId !== ""
      ) {
        sellerId =
          await verifySellerId(
            sellerId
          );
      } else {
        const old =
          await pool.query(
            `SELECT seller_id
             FROM products
             WHERE id=$1`,
            [id]
          );

        if (!old.rows.length) {
          return res.status(404).json({
            error:
              "Product not found"
          });
        }

        sellerId =
          old.rows[0].seller_id;
      }

      const result =
        await pool.query(
          `UPDATE products
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
           RETURNING *`,
          [
            data.name,
            data.price,
            data.category,
            data.image,
            data.description,
            data.stock,
            data.discount,
            sellerId,
            id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true,
        product:
          normalizeProduct(
            result.rows[0]
          )
      });
    } catch (error) {
      res.status(400).json({
        error:
          safeError(error)
      });
    }
  }
);

// =====================================================
// ADMIN DELETE PRODUCT
// =====================================================

app.delete(
  "/api/products/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!positiveInteger(id)) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const result =
        await pool.query(
          `DELETE FROM products
           WHERE id=$1
           RETURNING id`,
          [id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to delete product"
      });
    }
  }
);

// =====================================================
// ADMIN SELLERS
// =====================================================

app.get(
  "/api/admin/sellers",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,name,email,phone,status,created_at
           FROM sellers
           ORDER BY id DESC`
        );

      res.json(
        result.rows
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load sellers"
      });
    }
  }
);

// =====================================================
// ADMIN CUSTOMERS
// =====================================================

app.get(
  "/api/admin/customers",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,name,email,phone,status,created_at
           FROM customers
           ORDER BY id DESC`
        );

      res.json(
        result.rows
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load customers"
      });
    }
  }
);

// =====================================================
// ADMIN ORDERS
// =====================================================

app.get(
  "/api/admin/orders",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT *
           FROM orders
           ORDER BY id DESC`
        );

      res.json(
        result.rows.map(
          normalizeOrder
        )
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load orders"
      });
    }
  }
);

app.get(
  "/api/orders",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT *
           FROM orders
           ORDER BY id DESC`
        );

      res.json(
        result.rows.map(
          normalizeOrder
        )
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load orders"
      });
    }
  }
);

// =====================================================
// ADMIN ORDER STATUS
// =====================================================

async function updateAdminOrderStatus(
  req,
  res
) {
  try {
    const id =
      Number(req.params.id);

    const status =
      clean(
        req.body?.status
      ).toLowerCase();

    const allowed = [
      "pending",
      "confirmed",
      "shipped",
      "delivered",
      "cancelled"
    ];

    if (!positiveInteger(id)) {
      return res.status(400).json({
        error:
          "Invalid order ID"
      });
    }

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error:
          "Invalid order status"
      });
    }

    const result =
      await pool.query(
        `UPDATE orders
         SET status=$1
         WHERE id=$2
         RETURNING *`,
        [
          status,
          id
        ]
      );

    if (!result.rows.length) {
      return res.status(404).json({
        error:
          "Order not found"
      });
    }

    res.json({
      ok: true,
      order:
        normalizeOrder(
          result.rows[0]
        )
    });
  } catch (error) {
    res.status(500).json({
      error:
        "Failed to update order status"
    });
  }
}

app.put(
  "/api/admin/orders/:id/status",
  requireAdmin,
  updateAdminOrderStatus
);

app.put(
  "/api/orders/:id/status",
  requireAdmin,
  updateAdminOrderStatus
);

// =====================================================
// SELLER DASHBOARD
// =====================================================

app.get(
  "/api/seller/dashboard",
  requireSeller,
  async (req, res) => {
    try {
      const sellerId =
        Number(
          req.session.seller.id
        );

      const products =
        await pool.query(
          `SELECT
             COUNT(*)::int AS products,
             COALESCE(SUM(stock),0)::int AS stock
           FROM products
           WHERE seller_id=$1`,
          [sellerId]
        );

      const orders =
        await pool.query(
          `SELECT items
           FROM orders`
        );

      let orderCount = 0;
      let revenue = 0;

      for (
        const order
        of orders.rows
      ) {
        const normalized =
          normalizeOrder(order);

        const sellerItems =
          normalized.items.filter(
            item =>
              Number(
                item?.seller_id
              ) === sellerId
          );

        if (sellerItems.length) {
          orderCount++;

          revenue +=
            sellerItems.reduce(
              (sum, item) =>
                sum +
                (
                  Number(
                    item?.item_total
                  ) || 0
                ),
              0
            );
        }
      }

      res.json({
        products:
          products.rows[0]?.products || 0,

        stock:
          products.rows[0]?.stock || 0,

        orders:
          orderCount,

        revenue:
          Math.round(
            revenue * 100
          ) / 100
      });
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load seller dashboard"
      });
    }
  }
);

// =====================================================
// SELLER ORDERS
// =====================================================

app.get(
  "/api/seller/orders",
  requireSeller,
  async (req, res) => {
    try {
      const sellerId =
        Number(
          req.session.seller.id
        );

      const result =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE EXISTS (
             SELECT 1
             FROM jsonb_array_elements(
               COALESCE(
                 items,
                 '[]'::jsonb
               )
             ) item
             WHERE
             (item->>'seller_id')::integer=$1
           )
           ORDER BY id DESC`,
          [sellerId]
        );

      const sellerOrders =
        result.rows.map(order => {
          const normalized =
            normalizeOrder(order);

          const sellerItems =
            normalized.items.filter(
              item =>
                Number(
                  item?.seller_id
                ) === sellerId
            );

          const sellerTotal =
            Math.round(
              sellerItems.reduce(
                (sum, item) =>
                  sum +
                  (
                    Number(
                      item?.item_total
                    ) || 0
                  ),
                0
              ) * 100
            ) / 100;

          return {
            ...normalized,

            items:
              sellerItems,

            seller_total:
              sellerTotal
          };
        });

      res.json(
        sellerOrders
      );
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to load seller orders"
      });
    }
  }
);

// =====================================================
// SELLER ORDER STATUS
// =====================================================

app.put(
  "/api/seller/orders/:id/status",
  requireSeller,
  async (req, res) => {
    try {
      const orderId =
        Number(req.params.id);

      const status =
        clean(
          req.body?.status
        ).toLowerCase();

      const allowed = [
        "confirmed",
        "shipped",
        "delivered",
        "cancelled"
      ];

      if (!positiveInteger(orderId)) {
        return res.status(400).json({
          error:
            "Invalid order ID"
        });
      }

      if (!allowed.includes(status)) {
        return res.status(400).json({
          error:
            "Invalid order status"
        });
      }

      const result =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE id=$1
           LIMIT 1`,
          [orderId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const order =
        normalizeOrder(
          result.rows[0]
        );

      const sellerId =
        Number(
          req.session.seller.id
        );

      const belongs =
        order.items.some(
          item =>
            Number(
              item?.seller_id
            ) === sellerId
        );

      if (!belongs) {
        return res.status(403).json({
          error:
            "You cannot update this order"
        });
      }

      const updated =
        await pool.query(
          `UPDATE orders
           SET status=$1
           WHERE id=$2
           RETURNING *`,
          [
            status,
            orderId
          ]
        );

      res.json({
        ok: true,
        order:
          normalizeOrder(
            updated.rows[0]
          )
      });
    } catch (error) {
      res.status(500).json({
        error:
          "Failed to update order status"
      });
    }
  }
);

// =====================================================
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {
  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    // SELLERS
    await client.query(`
      CREATE TABLE IF NOT EXISTS sellers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE sellers
      ADD COLUMN IF NOT EXISTS phone TEXT
    `);

    await client.query(`
      ALTER TABLE sellers
      ADD COLUMN IF NOT EXISTS status TEXT
      DEFAULT 'active'
    `);

    await client.query(`
      ALTER TABLE sellers
      ADD COLUMN IF NOT EXISTS created_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    // CUSTOMERS
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS phone TEXT
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS password_hash TEXT
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS status TEXT
      DEFAULT 'active'
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS created_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    // PRODUCTS
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        category TEXT,
        image TEXT,
        description TEXT,
        stock INTEGER NOT NULL DEFAULT 0,
        discount_percent NUMERIC(5,2)
          NOT NULL DEFAULT 0,
        seller_id INTEGER
          REFERENCES sellers(id)
          ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS image TEXT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description TEXT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock INTEGER
      NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount_percent
      NUMERIC(5,2)
      NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS seller_id INTEGER
    `);

    // ORDERS
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER
          REFERENCES customers(id)
          ON DELETE SET NULL,
        customer_name TEXT,
        customer_phone TEXT,
        customer_address TEXT,
        items JSONB
          NOT NULL DEFAULT '[]'::jsonb,
        total NUMERIC(12,2)
          NOT NULL DEFAULT 0,
        status TEXT
          NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_id INTEGER
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_name TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_phone TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_address TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS items JSONB
      DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS total
      NUMERIC(12,2)
      DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS status TEXT
      DEFAULT 'pending'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS created_at
      TIMESTAMPTZ
      DEFAULT NOW()
    `);

    // PAYMENT COLUMNS
    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_method TEXT
      DEFAULT 'cod'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_status TEXT
      DEFAULT 'pending'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_id TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT
    `);

    // SAFETY
    await client.query(`
      UPDATE sellers
      SET status='active'
      WHERE status IS NULL
    `);

    await client.query(`
      UPDATE customers
      SET status='active'
      WHERE status IS NULL
    `);

    await client.query(`
      UPDATE products
      SET stock=0
      WHERE stock IS NULL
    `);

    await client.query(`
      UPDATE products
      SET discount_percent=0
      WHERE discount_percent IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET items='[]'::jsonb
      WHERE items IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET total=0
      WHERE total IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET status='pending'
      WHERE status IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET payment_method='cod'
      WHERE payment_method IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET payment_status='pending'
      WHERE payment_status IS NULL
    `);

    // INDEXES
    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_products_seller_id
      ON products(seller_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_products_category
      ON products(category)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_customers_email
      ON customers(email)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_sellers_email
      ON sellers(email)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_orders_customer_id
      ON orders(customer_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_orders_created_at
      ON orders(created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_orders_payment_id
      ON orders(payment_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_orders_razorpay_order_id
      ON orders(razorpay_order_id)
    `);

    await client.query("COMMIT");

    console.log(
      "========================================"
    );

    console.log(
      "SHRIVI DATABASE READY"
    );

    console.log(
      "Existing data preserved."
    );

    console.log(
      "Payment columns ready."
    );

    console.log(
      "========================================"
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error(
      "DATABASE INITIALIZATION ERROR:",
      error
    );

    throw error;
  } finally {
    client.release();
  }
}

// =====================================================
// API 404
// =====================================================

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      error:
        "API endpoint not found",
      path:
        req.originalUrl
    });
  }
);

// =====================================================
// GLOBAL ERROR
// =====================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "UNHANDLED SERVER ERROR:",
      error
    );

    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          error:
            "Image must be 5MB or smaller."
        });
      }
    }

    res.status(500).json({
      error:
        error.message ||
        "Internal server error"
    });
  }
);

// =====================================================
// START
// =====================================================

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Shrivi Marketplace running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "SERVER STARTUP FAILED:",
      error
    );

    process.exit(1);
  }
}

startServer();
