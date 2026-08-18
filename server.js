const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// =====================================================
// CLOUDINARY
// =====================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error(
          "Only JPG, PNG and WEBP images are allowed."
        )
      );
    }

    cb(null, true);
  }
});

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
// ADMIN
// =====================================================

const ADMIN_USER =
  process.env.ADMIN_USER || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;

let ADMIN_HASH = null;

(async () => {

  try {

    if (ADMIN_PASSWORD) {

      ADMIN_HASH =
        await bcrypt.hash(
          ADMIN_PASSWORD,
          10
        );

    } else {

      console.error(
        "ADMIN_PASSWORD environment variable is missing"
      );

    }

  } catch (error) {

    console.error(
      "Admin password hash error:",
      error
    );

  }

})();

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb"
  })
);

app.set(
  "trust proxy",
  1
);

app.use(
  session({

    secret:
      process.env.SESSION_SECRET ||
      "shrivi-session-secret-2026",

    resave: false,

    saveUninitialized: false,

    cookie: {

      httpOnly: true,

      secure: true,

      sameSite: "lax",

      maxAge:
        24 * 60 * 60 * 1000
    }

  })
);

// =====================================================
// PAGES
// =====================================================

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "admin.html"
      )
    );

  }
);

app.get(
  "/shop",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "customer.html"
      )
    );

  }
);

app.get(
  "/seller",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "seller.html"
      )
    );

  }
);

// =====================================================
// HELPERS
// =====================================================

function clean(value) {

  return String(
    value ?? ""
  ).trim();

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
    Number.isInteger(
      Number(value)
    ) &&
    Number(value) >= 0
  );

}

function validDiscount(value) {

  const d =
    Number(value);

  return (
    Number.isFinite(d) &&
    d >= 0 &&
    d <= 100
  );

}

function calculateSalePrice(
  price,
  discount
) {

  const p =
    Number(price) || 0;

  const d =
    Number(discount) || 0;

  return Math.round(
    (
      p -
      (p * d / 100)
    ) * 100
  ) / 100;

}

function normalizeProduct(product) {

  const price =
    Number(product.price) || 0;

  const discount =
    Number(
      product.discount_percent
    ) || 0;

  return {

    ...product,

    price,

    original_price:
      price,

    discount_percent:
      discount,

    sale_price:
      calculateSalePrice(
        price,
        discount
      ),

    stock:
      Number(product.stock) || 0

  };

}

function normalizeOrder(order) {

  return {

    ...order,

    total:
      Number(order.total) || 0,

    items:
      Array.isArray(order.items)
        ? order.items
        : []

  };

}

// =====================================================
// AUTH MIDDLEWARE
// =====================================================

function requireAdmin(
  req,
  res,
  next
) {

  if (!req.session.admin) {

    return res.status(401).json({
      error:
        "Admin login required"
    });

  }

  next();

}

function requireSeller(
  req,
  res,
  next
) {

  if (!req.session.seller) {

    return res.status(401).json({
      error:
        "Seller login required"
    });

  }

  next();

}

// =====================================================
// ADMIN AUTH
// =====================================================

app.post(
  "/api/login",
  async (req, res) => {

    try {

      const username =
        clean(
          req.body?.username
        );

      const password =
        req.body?.password || "";

      if (!ADMIN_HASH) {

        return res.status(500).json({
          error:
            "Admin login is not configured"
        });

      }

      const validUser =
        username === ADMIN_USER;

      const passwordOk =
        await bcrypt.compare(
          password,
          ADMIN_HASH
        );

      if (
        !validUser ||
        !passwordOk
      ) {

        return res.status(401).json({
          error:
            "Invalid username or password"
        });

      }

      req.session.admin = {
        username:
          ADMIN_USER
      };

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Session save error:",
              error
            );

            return res.status(500).json({
              error:
                "Session error"
            });

          }

          res.json({
            ok: true
          });

        }
      );

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        error:
          "Login error"
      });

    }

  }
);

app.post(
  "/api/logout",
  (req, res) => {

    req.session.destroy(
      error => {

        if (error) {

          return res.status(500).json({
            error:
              "Logout error"
          });

        }

        res.json({
          ok: true
        });

      }
    );

  }
);

app.get(
  "/api/me",
  (req, res) => {

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

  }
);

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

      const passwordHash =
        await bcrypt.hash(
          password,
          10
        );

      const result =
        await pool.query(
          `INSERT INTO sellers
           (name,email,phone,password_hash,status)
           VALUES ($1,$2,$3,$4,'active')
           RETURNING
           id,name,email,phone,status,created_at`,
          [
            name,
            email,
            phone || null,
            passwordHash
          ]
        );

      const seller =
        result.rows[0];

      req.session.seller =
        seller;

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Seller session error:",
              error
            );

            return res.status(500).json({
              error:
                "Seller session error"
            });

          }

          res.status(201).json({
            ok: true,
            seller
          });

        }
      );

    } catch (error) {

      console.error(
        "Seller register error:",
        error
      );

      res.status(500).json({
        error:
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
          `SELECT
           id,name,email,phone,
           password_hash,status,created_at
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

      if (
        seller.status !== "active"
      ) {

        return res.status(403).json({
          error:
            "Seller account is not active"
        });

      }

      delete seller.password_hash;

      req.session.seller =
        seller;

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Seller session save error:",
              error
            );

            return res.status(500).json({
              error:
                "Session error"
            });

          }

          res.json({
            ok: true,
            seller
          });

        }
      );

    } catch (error) {

      console.error(
        "Seller login error:",
        error
      );

      res.status(500).json({
        error:
          "Seller login failed"
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

    req.session.destroy(
      error => {

        if (error) {

          return res.status(500).json({
            error:
              "Logout error"
          });

        }

        res.json({
          ok: true
        });

      }
    );

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
          [req.session.seller.id]
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
        "Seller session check error:",
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
        "Public products error:",
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
// PRODUCT VALIDATION
// =====================================================

async function verifySellerId(
  sellerId
) {

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

function validateProductInput(
  body,
  isEdit = false
) {

  const name =
    clean(body?.name);

  const price =
    Number(body?.price);

  const stock =
    body?.stock === "" ||
    body?.stock === undefined
      ? (isEdit ? NaN : 0)
      : Number(body.stock);

  const discount =
    body?.discount_percent === "" ||
    body?.discount_percent === undefined
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
      clean(body?.category) ||
      null,

    image:
      clean(body?.image) ||
      null,

    description:
      clean(body?.description) ||
      null,

    stock,

    discount

  };

}

// =====================================================
// SELLER IMAGE UPLOAD
// =====================================================

app.post(
  "/api/seller/upload/image",
  requireSeller,
  (req, res) => {

    imageUpload.single(
      "image"
    )(
      req,
      res,
      async error => {

        if (error) {

          console.error(
            "Image upload validation error:",
            error
          );

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
                "Image storage is not configured. Add Cloudinary environment variables in Render."
            });

          }

          const result =
            await new Promise(
              (resolve, reject) => {

                const stream =
                  cloudinary
                    .uploader
                    .upload_stream(

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

                        if (
                          uploadError
                        ) {

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

        } catch (uploadError) {

          console.error(
            "Cloudinary upload error:",
            uploadError
          );

          res.status(500).json({
            error:
              "Image upload failed. Please try again."
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
          [req.session.seller.id]
        );

      res.json(
        result.rows.map(
          normalizeProduct
        )
      );

    } catch (error) {

      console.error(
        "Seller products error:",
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
        "Seller product add error:",
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

      const result =
        await pool.query(
          `UPDATE products SET
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
        "Seller product update error:",
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

      const result =
        await pool.query(
          `DELETE FROM products
           WHERE id=$1
           AND seller_id=$2
           RETURNING id`,
          [
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
        ok: true
      });

    } catch (error) {

      console.error(
        "Seller product delete error:",
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
        req.session.seller.id;

      const productsResult =
        await pool.query(
          `SELECT
             COUNT(*)::int AS products,
             COALESCE(SUM(stock),0)::int AS stock
           FROM products
           WHERE seller_id=$1`,
          [sellerId]
        );

      const ordersResult =
        await pool.query(
          `SELECT
             COUNT(DISTINCT o.id)::int AS orders,
             COALESCE(
               SUM(
                 COALESCE(
                   (item->>'item_total')::numeric,
                   0
                 )
               ),
               0
             ) AS revenue
           FROM orders o
           CROSS JOIN LATERAL
             jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(o.items::jsonb)='array'
                 THEN o.items::jsonb
                 ELSE '[]'::jsonb
               END
             ) item
           WHERE
             o.items::jsonb @> jsonb_build_array(
               jsonb_build_object(
                 'seller_id',
                 sellerId
               )
             )`,
          [sellerId]
        );

      res.json({

        products:
          productsResult.rows[0]?.products || 0,

        stock:
          productsResult.rows[0]?.stock || 0,

        orders:
          ordersResult.rows[0]?.orders || 0,

        revenue:
          Number(
            ordersResult.rows[0]?.revenue || 0
          )

      });

    } catch (error) {

      console.error(
        "Seller dashboard error:",
        error
      );

      /*
       * Some older orders tables may not have
       * seller_id inside JSON items.
       * Dashboard should still work.
       */

      try {

        const sellerId =
          req.session.seller.id;

        const products =
          await pool.query(
            `SELECT
               COUNT(*)::int AS products,
               COALESCE(SUM(stock),0)::int AS stock
             FROM products
             WHERE seller_id=$1`,
            [sellerId]
          );

        res.json({

          products:
            products.rows[0]?.products || 0,

          stock:
            products.rows[0]?.stock || 0,

          orders: 0,

          revenue: 0

        });

      } catch (fallbackError) {

        console.error(
          "Seller dashboard fallback error:",
          fallbackError
        );

        res.status(500).json({
          error:
            "Failed to load seller dashboard"
        });

      }

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

      for (
        const order of result.rows
      ) {

        let rawItems =
          order.items;

        if (
          typeof rawItems === "string"
        ) {

          try {

            rawItems =
              JSON.parse(
                rawItems
              );

          } catch {

            rawItems = [];

          }

        }

        if (
          !Array.isArray(rawItems)
        ) {

          rawItems = [];

        }

        const sellerItems =
          rawItems.filter(
            item =>
              Number(
                item?.seller_id
              ) === sellerId
          );

        if (
          !sellerItems.length
        ) {

          continue;

        }

        const sellerTotal =
          sellerItems.reduce(
            (sum, item) => {

              const total =
                Number(
                  item?.item_total
                );

              if (
                Number.isFinite(total)
              ) {

                return sum + total;

              }

              const price =
                Number(
                  item?.price
                ) || 0;

              const quantity =
                Number(
                  item?.quantity
                ) || 0;

              return (
                sum +
                price *
                quantity
              );

            },
            0
          );

        sellerOrders.push({

          id:
            order.id,

          status:
            order.status ||
            "pending",

          created_at:
            order.created_at,

          customer_name:
            order.customer_name ||
            order.name ||
            "-",

          customer_phone:
            order.customer_phone ||
            order.phone ||
            "-",

          customer_address:
            order.customer_address ||
            order.address ||
            "-",

          items:
            sellerItems,

          seller_total:
            sellerTotal

        });

      }

      res.json(
        sellerOrders
      );

    } catch (error) {

      console.error(
        "Seller orders error:",
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
        Number(
          req.params.id
        );

      const newStatus =
        String(
          req.body?.status || ""
        )
          .trim()
          .toLowerCase();

      const allowedStatuses = [
        "confirmed",
        "shipped",
        "delivered",
        "cancelled"
      ];

      if (
        !Number.isInteger(orderId) ||
        orderId <= 0
      ) {

        return res.status(400).json({
          error:
            "Invalid order ID"
        });

      }

      if (
        !allowedStatuses.includes(
          newStatus
        )
      ) {

        return res.status(400).json({
          error:
            "Invalid order status"
        });

      }

      /*
       * First verify that this order actually
       * contains one of the current seller's products.
       */

      const orderResult =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE id=$1
           LIMIT 1`,
          [orderId]
        );

      if (
        !orderResult.rows.length
      ) {

        return res.status(404).json({
          error:
            "Order not found"
        });

      }

      const order =
        orderResult.rows[0];

      let items =
        order.items;

      if (
        typeof items === "string"
      ) {

        try {

          items =
            JSON.parse(items);

        } catch {

          items = [];

        }

      }

      if (
        !Array.isArray(items)
      ) {

        items = [];

      }

      const sellerId =
        Number(
          req.session.seller.id
        );

      const belongsToSeller =
        items.some(
          item =>
            Number(
              item?.seller_id
            ) === sellerId
        );

      if (
        !belongsToSeller
      ) {

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
            newStatus,
            orderId
          ]
        );

      res.json({

        ok: true,

        order:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Seller order status error:",
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
// CUSTOMER AUTH
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

      if (
        existing.rows.length
      ) {

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
             name,
             email,
             phone,
             password_hash,
             status
           )
           VALUES
           ($1,$2,$3,$4,'active')
           RETURNING
             id,
             name,
             email,
             phone,
             status,
             created_at`,
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

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Customer session error:",
              error
            );

            return res.status(500).json({
              error:
                "Session error"
            });

          }

          res.status(201).json({

            ok: true,

            customer

          });

        }
      );

    } catch (error) {

      console.error(
        "Customer register error:",
        error
      );

      res.status(500).json({
        error:
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

      const result =
        await pool.query(
          `SELECT *
           FROM customers
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [email]
        );

      if (
        !result.rows.length
      ) {

        return res.status(401).json({
          error:
            "Invalid email or password"
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

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Customer session save error:",
              error
            );

            return res.status(500).json({
              error:
                "Session error"
            });

          }

          res.json({

            ok: true,

            customer

          });

        }
      );

    } catch (error) {

      console.error(
        "Customer login error:",
        error
      );

      res.status(500).json({
        error:
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

    req.session.destroy(
      error => {

        if (error) {

          return res.status(500).json({
            error:
              "Logout failed"
          });

        }

        res.json({
          ok: true
        });

      }
    );

  }
);

// =====================================================
// CUSTOMER SESSION
// =====================================================

app.get(
  "/api/customer/me",
  (req, res) => {

    if (
      !req.session.customer
    ) {

      return res.json({
        loggedIn: false
      });

    }

    res.json({

      loggedIn: true,

      customer:
        req.session.customer

    });

  }
);

// =====================================================
// CUSTOMER ORDERS
// =====================================================

app.get(
  "/api/customer/orders",
  async (req, res) => {

    try {

      if (
        !req.session.customer
      ) {

        return res.status(401).json({
          error:
            "Customer login required"
        });

      }

      const customerId =
        req.session.customer.id;

      const result =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE customer_id=$1
           ORDER BY id DESC`,
          [customerId]
        );

      res.json(
        result.rows.map(
          normalizeOrder
        )
      );

    } catch (error) {

      console.error(
        "Customer orders error:",
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
// CREATE CUSTOMER ORDER
// =====================================================

app.post(
  "/api/customer/orders",
  async (req, res) => {

    try {

      if (
        !req.session.customer
      ) {

        return res.status(401).json({
          error:
            "Customer login required"
        });

      }

      const incomingItems =
        Array.isArray(
          req.body?.items
        )
          ? req.body.items
          : [];

      if (
        !incomingItems.length
      ) {

        return res.status(400).json({
          error:
            "Order items are required"
        });

      }

      const productIds =
        incomingItems
          .map(
            item =>
              Number(item?.id)
          )
          .filter(
            Number.isInteger
          );

      if (
        !productIds.length
      ) {

        return res.status(400).json({
          error:
            "Invalid products"
        });

      }

      const productsResult =
        await pool.query(
          `SELECT *
           FROM products
           WHERE id=ANY($1::int[])`,
          [productIds]
        );

      const products =
        productsResult.rows;

      if (
        products.length !==
        new Set(productIds).size
      ) {

        return res.status(400).json({
          error:
            "One or more products no longer exist"
        });

      }

      const productMap =
        new Map(
          products.map(
            p =>
              [
                Number(p.id),
                p
              ]
          )
        );

      const orderItems = [];

      for (
        const incoming of incomingItems
      ) {

        const product =
          productMap.get(
            Number(incoming?.id)
          );

        if (!product) {

          continue;

        }

        const quantity =
          Number(
            incoming?.quantity
          );

        if (
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {

          return res.status(400).json({
            error:
              "Invalid quantity"
          });

        }

        const stock =
          Number(product.stock) || 0;

        if (
          quantity > stock
        ) {

          return res.status(400).json({
            error:
              `${product.name} has only ${stock} item(s) in stock`
          });

        }

        const price =
          Number(product.price) || 0;

        const discount =
          Number(
            product.discount_percent
          ) || 0;

        const salePrice =
          calculateSalePrice(
            price,
            discount
          );

        const itemTotal =
          Math.round(
            salePrice *
            quantity *
            100
          ) / 100;

        orderItems.push({

          product_id:
            Number(product.id),

          id:
            Number(product.id),

          name:
            product.name,

          image:
            product.image || "",

          price:
            salePrice,

          original_price:
            price,

          quantity,

          seller_id:
            product.seller_id
              ? Number(product.seller_id)
              : null,

          item_total:
            itemTotal

        });

      }

      if (
        !orderItems.length
      ) {

        return res.status(400).json({
          error:
            "No valid products in order"
        });

      }

      const total =
        Math.round(
          orderItems.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.item_total
              ),
            0
          ) * 100
        ) / 100;

      const customerId =
        req.session.customer.id;

      const client =
        await pool.connect();

      try {

        await client.query(
          "BEGIN"
        );

        /*
         * Lock product rows so two
         * customers cannot oversell.
         */

        for (
          const item of orderItems
        ) {

          const stockResult =
            await client.query(
              `SELECT stock
               FROM products
               WHERE id=$1
               FOR UPDATE`,
              [item.product_id]
            );

          if (
            !stockResult.rows.length
          ) {

            throw new Error(
              "Product no longer exists"
            );

          }

          const latestStock =
            Number(
              stockResult.rows[0].stock
            ) || 0;

          if (
            item.quantity >
            latestStock
          ) {

            throw new Error(
              `${item.name} is out of stock`
            );

          }

        }

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
             (
               $1,$2,$3,$4,$5::jsonb,$6,'pending'
             )
             RETURNING *`,
            [
              customerId,

              req.body?.customer_name ||
                req.session.customer.name ||
                "",

              req.body?.customer_phone ||
                req.session.customer.phone ||
                "",

              req.body?.customer_address ||
                "",

              JSON.stringify(
                orderItems
              ),

              total

            ]
          );

        /*
         * Reduce stock.
         */

        for (
          const item of orderItems
        ) {

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

        await client.query(
          "COMMIT"
        );

        res.status(201).json({

          ok: true,

          order:
            normalizeOrder(
              orderResult.rows[0]
            )

        });

      } catch (transactionError) {

        await client.query(
          "ROLLBACK"
        );

        throw transactionError;

      } finally {

        client.release();

      }

    } catch (error) {

      console.error(
        "Create order error:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Failed to create order"
      });

    }

  }
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
        "Admin products error:",
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

      console.error(
        "Admin add product error:",
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
        Number(
          req.params.id
        );

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

        /*
         * Preserve current seller
         * when seller_id is not supplied.
         */

        const existing =
          await pool.query(
            `SELECT seller_id
             FROM products
             WHERE id=$1
             LIMIT 1`,
            [id]
          );

        if (
          !existing.rows.length
        ) {

          return res.status(404).json({
            error:
              "Product not found"
          });

        }

        sellerId =
          existing.rows[0].seller_id;

      }

      const result =
        await pool.query(
          `UPDATE products SET
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

      if (
        !result.rows.length
      ) {

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
        "Admin update product error:",
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
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

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

      if (
        !result.rows.length
      ) {

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
        "Admin delete product error:",
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
             id,
             name,
             email,
             phone,
             status,
             created_at
           FROM sellers
           ORDER BY id DESC`
        );

      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "Admin sellers error:",
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
             id,
             name,
             email,
             phone,
             status,
             created_at
           FROM customers
           ORDER BY id DESC`
        );

      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "Admin customers error:",
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

      console.error(
        "Admin orders error:",
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
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    // -------------------------------------------------
    // SELLERS
    // -------------------------------------------------

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

    // -------------------------------------------------
    // CUSTOMERS
    // -------------------------------------------------

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

    // -------------------------------------------------
    // PRODUCTS
    // -------------------------------------------------

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        category TEXT,
        image TEXT,
        description TEXT,
        stock INTEGER NOT NULL DEFAULT 0,
        discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
        seller_id INTEGER REFERENCES sellers(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -------------------------------------------------
    // ORDERS
    // -------------------------------------------------

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        customer_name TEXT,
        customer_phone TEXT,
        customer_address TEXT,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -------------------------------------------------
    // ADD MISSING PRODUCT COLUMNS
    // -------------------------------------------------

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS seller_id
      INTEGER REFERENCES sellers(id)
      ON DELETE SET NULL
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount_percent
      NUMERIC(5,2) NOT NULL DEFAULT 0
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

    // -------------------------------------------------
    // INDEXES
    // -------------------------------------------------

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
      idx_orders_customer_id
      ON orders(customer_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      idx_orders_created_at
      ON orders(created_at DESC)
    `);

    await client.query(
      "COMMIT"
    );

    console.log(
      "Database initialized successfully."
    );
catch (error) {

    await client.query(
      "ROLLBACK"
    );

    console.error(
      "Database initialization error:",
      error
    );

    throw error;

  } finally {

    client.release();

  }



// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
  "/api/health",
  async (req, res) => {

    try {

      await pool.query(
        "SELECT 1"
      );

      res.json({

        ok: true,

        service:
          "Shrivi Marketplace",

        database:
          "connected"

      });

    } catch (error) {

      res.status(500).json({

        ok: false,

        service:
          "Shrivi Marketplace",

        database:
          "error"

      });

    }

  }
);

// =====================================================
// ERROR HANDLER
// =====================================================

app.use(
  (error, req, res, next) => {

    console.error(
      "Unhandled server error:",
      error
    );

    if (
      error instanceof multer.MulterError
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

      return res.status(400).json({
        error:
          error.message ||
          "Image upload error"
      });

    }

    res.status(500).json({
      error:
        "Internal server error"
    });

  }
);

// =====================================================
// START SERVER
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
      "Server startup failed:",
      error
    );

    process.exit(
      1
    );

  }

}

startServer();
  }
