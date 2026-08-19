const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const { Pool } = require("pg");
const { v2: cloudinary } = require("cloudinary");

const app = express();
const PORT = process.env.PORT || 10000;

// =====================================================
// DATABASE
// =====================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
// MIDDLEWARE
// =====================================================

app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "2mb"
}));

app.use(session({
  secret:
    process.env.SESSION_SECRET ||
    "shrivi-session-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

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
    password.length >= 8
  );
}

function validStock(value) {
  return (
    Number.isInteger(Number(value)) &&
    Number(value) >= 0
  );
}

function validDiscount(value) {
  const d = Number(value);

  return (
    Number.isFinite(d) &&
    d >= 0 &&
    d <= 100
  );
}

function calculateSalePrice(price, discount) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;

  return Math.round(
    (p - (p * d) / 100) * 100
  ) / 100;
}

function parseItems(items) {
  if (Array.isArray(items)) {
    return items;
  }

  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed)
        ? parsed
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeProduct(product) {
  const price = Number(product.price) || 0;
  const discount =
    Number(product.discount_percent) || 0;

  return {
    ...product,
    price,
    original_price: price,
    discount_percent: discount,
    sale_price: calculateSalePrice(
      price,
      discount
    ),
    stock: Number(product.stock) || 0
  };
}

function normalizeOrder(order) {
  const items = parseItems(order.items);

  return {
    ...order,
    total: Number(order.total) || 0,
    items
  };
}

function validateProductInput(body, isEdit = false) {
  const name = clean(body?.name);
  const price = Number(body?.price);

  const stock =
    body?.stock === "" ||
    body?.stock === undefined ||
    body?.stock === null
      ? isEdit
        ? NaN
        : 0
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

  if (
    !Number.isFinite(price) ||
    price < 0
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
// AUTH
// =====================================================

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin login required"
    });
  }

  next();
}

function requireSeller(req, res, next) {
  if (!req.session.seller) {
    return res.status(401).json({
      error: "Seller login required"
    });
  }

  next();
}

function requireCustomer(req, res, next) {
  if (!req.session.customer) {
    return res.status(401).json({
      error: "Customer login required"
    });
  }

  next();
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
      database: "connected"
    });
  } catch (error) {
    console.error("Health:", error);

    res.status(500).json({
      ok: false,
      service: "Shrivi Marketplace",
      database: "error",
      error: error.message
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
      req.body?.password || "";

    const adminUser =
      process.env.ADMIN_USER || "admin";

    const adminPassword =
      process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return res.status(500).json({
        error:
          "Admin login is not configured"
      });
    }

    if (username !== adminUser) {
      return res.status(401).json({
        error:
          "Invalid username or password"
      });
    }

    const passwordOk =
      password === adminPassword;

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
          "Admin session:",
          error
        );

        return res.status(500).json({
          error: "Session error"
        });
      }

      res.json({
        ok: true
      });
    });
  } catch (error) {
    console.error(
      "Admin login:",
      error
    );

    res.status(500).json({
      error: "Login error"
    });
  }
});

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

app.get("/api/me", (req, res) => {
  if (!req.session.admin) {
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

      if (
        phone &&
        !/^[0-9]{10}$/.test(phone)
      ) {
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
        await bcrypt.hash(password, 10);

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

      req.session.seller =
        result.rows[0];

      req.session.save(error => {
        if (error) {
          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.status(201).json({
          ok: true,
          seller:
            result.rows[0]
        });
      });
    } catch (error) {
      console.error(
        "Seller register:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Seller registration failed"
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

      req.session.seller = seller;

      req.session.save(error => {
        if (error) {
          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.json({
          ok: true,
          seller
        });
      });
    } catch (error) {
      console.error(
        "Seller login:",
        error
      );

      res.status(500).json({
        error:
          "Seller login failed"
      });
    }
  }
);

app.post(
  "/api/seller/logout",
  (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");

      res.json({
        ok: true
      });
    });
  }
);

app.get(
  "/api/seller/me",
  requireSeller,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,name,email,phone,status,created_at
           FROM sellers
           WHERE id=$1
           LIMIT 1`,
          [
            req.session.seller.id
          ]
        );

      if (!result.rows.length) {
        req.session.seller = null;

        return res.status(401).json({
          loggedIn: false
        });
      }

      res.json({
        loggedIn: true,
        seller:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Seller me:",
        error
      );

      res.status(500).json({
        error:
          "Failed to check seller session"
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
        "Products:",
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
// CLOUDINARY UPLOAD
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
                "Cloudinary is not configured in Render."
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
            "Cloudinary:",
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
      const result =
        await pool.query(
          `SELECT *
           FROM products
           WHERE seller_id=$1
           ORDER BY id DESC`,
          [
            req.session.seller.id
          ]
        );

      res.json(
        result.rows.map(
          normalizeProduct
        )
      );
    } catch (error) {
      console.error(
        "Seller products:",
        error
      );

      res.status(500).json({
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
      const data =
        validateProductInput(
          req.body
        );

      const result =
        await pool.query(
          `INSERT INTO products
           (
             name,price,category,image,
             description,stock,
             discount_percent,seller_id
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
            req.session.seller.id
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
        "Seller add:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
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
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const data =
        validateProductInput(
          req.body,
          true
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
            req.session.seller.id
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
      console.error(
        "Seller update:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Failed to update product"
      });
    }
  }
);

app.delete(
  "/api/seller/products/:id",
  requireSeller,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `DELETE FROM products
           WHERE id=$1
           AND seller_id=$2
           RETURNING id`,
          [
            Number(req.params.id),
            req.session.seller.id
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
      console.error(
        "Seller delete:",
        error
      );

      res.status(500).json({
        error:
          "Failed to delete product"
      });
    }
  }
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

      for (const order of orders.rows) {
        const items =
          parseItems(order.items);

        const sellerItems =
          items.filter(
            item =>
              Number(item?.seller_id) ===
              sellerId
          );

        if (sellerItems.length) {
          orderCount++;

          revenue +=
            sellerItems.reduce(
              (sum, item) =>
                sum +
                (Number(
                  item?.item_total
                ) || 0),
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
      console.error(
        "Seller dashboard:",
        error
      );

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
           ORDER BY id DESC`
        );

      const sellerOrders = [];

      for (const order of result.rows) {
        const items =
          parseItems(order.items);

        const sellerItems =
          items.filter(
            item =>
              Number(item?.seller_id) ===
              sellerId
          );

        if (!sellerItems.length) {
          continue;
        }

        sellerOrders.push({
          id: order.id,
          status:
            order.status || "pending",
          created_at:
            order.created_at,
          customer_name:
            order.customer_name || "-",
          customer_phone:
            order.customer_phone || "-",
          customer_address:
            order.customer_address || "-",
          items: sellerItems,
          seller_total:
            Math.round(
              sellerItems.reduce(
                (sum, item) =>
                  sum +
                  (Number(
                    item?.item_total
                  ) || 0),
                0
              ) * 100
            ) / 100
        });
      }

      res.json(sellerOrders);
    } catch (error) {
      console.error(
        "Seller orders:",
        error
      );

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

      if (
        !Number.isInteger(orderId) ||
        !allowed.includes(status)
      ) {
        return res.status(400).json({
          error:
            "Invalid order status"
        });
      }

      const orderResult =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE id=$1`,
          [orderId]
        );

      if (!orderResult.rows.length) {
        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const items =
        parseItems(
          orderResult.rows[0].items
        );

      const sellerId =
        Number(
          req.session.seller.id
        );

      const belongs =
        items.some(
          item =>
            Number(item?.seller_id) ===
            sellerId
        );

      if (!belongs) {
        return res.status(403).json({
          error:
            "You cannot update this order"
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
            orderId
          ]
        );

      res.json({
        ok: true,
        order:
          normalizeOrder(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Seller status:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update order status"
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

      if (
        phone &&
        !/^[0-9]{10}$/.test(phone)
      ) {
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
          10
        );

      const result =
        await pool.query(
          `INSERT INTO customers
           (
             name,email,phone,
             password_hash,status
           )
           VALUES
           ($1,$2,$3,$4,'active')
           RETURNING
             id,name,email,phone,
             status,created_at`,
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
        "CUSTOMER REGISTER:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Registration failed"
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

      if (!password) {
        return res.status(400).json({
          error:
            "Password is required"
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
      console.error(
        "CUSTOMER LOGIN:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Login failed"
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
      if (!req.session.customer) {
        return res.json({
          loggedIn: false
        });
      }

      const result =
        await pool.query(
          `SELECT
             id,name,email,phone,
             status,created_at
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
      console.error(
        "Customer me:",
        error
      );

      res.status(500).json({
        error:
          "Failed to check customer session"
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
      console.error(
        "Customer orders:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load orders"
      });
    }
  }
);

// =====================================================
// CREATE ORDER
// =====================================================

async function createCustomerOrder(req, res) {
  const client =
    await pool.connect();

  try {
    if (!req.session.customer) {
      return res.status(401).json({
        error:
          "Customer login required"
      });
    }

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

    const ids =
      incomingItems
        .map(
          item =>
            Number(item?.id)
        )
        .filter(
          id =>
            Number.isInteger(id) &&
            id > 0
        );

    const uniqueIds =
      [...new Set(ids)];

    if (!uniqueIds.length) {
      return res.status(400).json({
        error:
          "Invalid products"
      });
    }

    await client.query("BEGIN");

    const productsResult =
      await client.query(
        `SELECT *
         FROM products
         WHERE id=ANY($1::int[])
         FOR UPDATE`,
        [uniqueIds]
      );

    if (
      productsResult.rows.length !==
      uniqueIds.length
    ) {
      throw new Error(
        "One or more products no longer exist"
      );
    }

    const productMap =
      new Map(
        productsResult.rows.map(
          product => [
            Number(product.id),
            product
          ]
        )
      );

    const orderItems = [];

    for (const incoming of incomingItems) {
      const product =
        productMap.get(
          Number(incoming?.id)
        );

      if (!product) continue;

      const quantity =
        Number(incoming?.quantity);

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        throw new Error(
          "Invalid quantity"
        );
      }

      const stock =
        Number(product.stock) || 0;

      if (quantity > stock) {
        throw new Error(
          `${product.name} has only ${stock} item(s) in stock`
        );
      }

      const price =
        Number(product.price) || 0;

      const discount =
        Number(
          product.discount_percent
        ) || 0;

      const currentPrice =
        calculateSalePrice(
          price,
          discount
        );

      const itemTotal =
        Math.round(
          currentPrice *
            quantity *
            100
        ) / 100;

      orderItems.push({
        id: Number(product.id),
        product_id:
          Number(product.id),
        name: product.name,
        image: product.image || "",
        price: currentPrice,
        original_price: price,
        quantity,
        seller_id:
          product.seller_id
            ? Number(product.seller_id)
            : null,
        item_total:
          itemTotal
      });
    }

    if (!orderItems.length) {
      throw new Error(
        "No valid products in order"
      );
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
      clean(req.body?.customer_name) ||
      clean(req.body?.name) ||
      customer.name ||
      "";

    const customerPhone =
      clean(req.body?.customer_phone) ||
      clean(req.body?.phone) ||
      customer.phone ||
      "";

    const customerAddress =
      clean(req.body?.customer_address) ||
      clean(req.body?.address) ||
      "";

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
           status
         )
         VALUES
         ($1,$2,$3,$4,$5::jsonb,$6,'pending')
         RETURNING *`,
        [
          customer.id,
          customerName,
          customerPhone,
          customerAddress,
          JSON.stringify(orderItems),
          total
        ]
      );

    for (const item of orderItems) {
      await client.query(
        `UPDATE products
         SET stock=stock-$1
         WHERE id=$2`,
        [
          item.quantity,
          item.product_id
        ]
      );
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
      "CREATE ORDER:",
      error
    );

    res.status(400).json({
      error:
        error.message ||
        "Failed to create order"
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
      console.error(
        "Admin products:",
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
// VERIFY SELLER
// =====================================================

async function verifySellerId(sellerId) {
  const id =
    Number(sellerId);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
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
             name,price,category,image,
             description,stock,
             discount_percent,seller_id
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
        "Admin add:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Failed to add product"
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

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const data =
        validateProductInput(
          req.body,
          true
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
             WHERE id=$1
             LIMIT 1`,
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
      console.error(
        "Admin update:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Failed to update product"
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
      console.error(
        "Admin delete:",
        error
      );

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
             id,name,email,phone,
             status,created_at
           FROM sellers
           ORDER BY id DESC`
        );

      res.json(result.rows);
    } catch (error) {
      console.error(
        "Admin sellers:",
        error
      );

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
             id,name,email,phone,
             status,created_at
           FROM customers
           ORDER BY id DESC`
        );

      res.json(result.rows);
    } catch (error) {
      console.error(
        "Admin customers:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load customers"
      });
    }
  }
);

// =====================================================
// ADMIN ORDERS — FIXED
// =====================================================

app.get(
  "/api/admin/orders",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             customer_id,
             customer_name,
             customer_phone,
             customer_address,
             items,
             total,
             status,
             created_at
           FROM orders
           ORDER BY id DESC`
        );

      const orders =
        result.rows.map(order => {
          const normalized =
            normalizeOrder(order);

          const items =
            normalized.items.map(
              item => ({
                ...item,
                quantity:
                  Number(item.quantity) || 0,
                price:
                  Number(item.price) || 0,
                item_total:
                  Number(item.item_total) || 0,
                seller_id:
                  item.seller_id === null ||
                  item.seller_id === undefined
                    ? null
                    : Number(item.seller_id)
              })
            );

          return {
            id: order.id,
            customer_id:
              order.customer_id,
            customer_name:
              order.customer_name || "-",
            customer_phone:
              order.customer_phone || "-",
            customer_address:
              order.customer_address || "-",
            items,
            total:
              Number(order.total) || 0,
            status:
              order.status || "pending",
            created_at:
              order.created_at
          };
        });

      res.json(orders);
    } catch (error) {
      console.error(
        "ADMIN ORDERS FULL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load admin orders",
        details:
          process.env.NODE_ENV ===
          "production"
            ? undefined
            : error.message
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

    await client.query(`
      UPDATE customers
      SET status='active'
      WHERE status IS NULL
    `);

    // PRODUCTS
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price NUMERIC(12,2)
          NOT NULL DEFAULT 0,
        category TEXT,
        image TEXT,
        description TEXT,
        stock INTEGER
          NOT NULL DEFAULT 0,
        discount_percent NUMERIC(5,2)
          NOT NULL DEFAULT 0,
        seller_id INTEGER
          REFERENCES sellers(id)
          ON DELETE SET NULL,
        created_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS seller_id INTEGER
      REFERENCES sellers(id)
      ON DELETE SET NULL
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
      ADD COLUMN IF NOT EXISTS stock
      INTEGER NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount_percent
      NUMERIC(5,2)
      NOT NULL DEFAULT 0
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
      REFERENCES customers(id)
      ON DELETE SET NULL
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

    // SAFE ORDER DATA FIX
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
      idx_orders_customer_id
      ON orders(customer_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_orders_created_at
      ON orders(created_at DESC)
    `);

    await client.query("COMMIT");

    console.log(
      "========================================"
    );
    console.log(
      "SHRIVI DATABASE INITIALIZED"
    );
    console.log(
      "Customers checked"
    );
    console.log(
      "Products checked"
    );
    console.log(
      "Orders checked"
    );
    console.log(
      "Existing data preserved"
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
// GLOBAL ERROR HANDLER
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
