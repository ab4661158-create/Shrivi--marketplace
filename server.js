const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// =========================
// POSTGRESQL
// =========================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// =========================
// ADMIN AUTH
// =========================

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let ADMIN_HASH = null;

(async () => {
  try {
    if (ADMIN_PASSWORD) {
      ADMIN_HASH = await bcrypt.hash(
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

// =========================
// MIDDLEWARE
// =========================

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true
  })
);

app.set("trust proxy", 1);

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

// =========================
// PAGES
// =========================

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

// =========================
// HELPERS
// =========================

function calculateSalePrice(
  price,
  discount
) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;

  return (
    Math.round(
      (p - (p * d) / 100) * 100
    ) / 100
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

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(email || "")
      .trim()
      .toLowerCase()
  );
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8
  );
}

// =========================
// ADMIN AUTH
// =========================

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const {
        username,
        password
      } = req.body || {};

      if (!ADMIN_HASH) {
        return res.status(500).json({
          error:
            "Admin login is not configured"
        });
      }

      const validUser =
        username === ADMIN_USER;

      const validPassword =
        await bcrypt.compare(
          password || "",
          ADMIN_HASH
        );

      if (
        !validUser ||
        !validPassword
      ) {
        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      req.session.admin = {
        username: ADMIN_USER
      };

      req.session.save(err => {
        if (err) {
          console.error(
            "Session save error:",
            err
          );

          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.json({
          ok: true
        });
      });
    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        error: "Login error"
      });
    }
  }
);

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(err => {
      if (err) {
        return res.status(500).json({
          error:
            "Logout error"
        });
      }

      res.json({
        ok: true
      });
    });
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

// =========================
// CUSTOMER AUTH
// =========================

async function requireCustomer(
  req,
  res,
  next
) {
  try {
    if (!req.session.customer) {
      return res.status(401).json({
        error:
          "Customer login required"
      });
    }

    const customerId =
      Number(
        req.session.customer.id
      );

    if (
      !Number.isInteger(
        customerId
      ) ||
      customerId <= 0
    ) {
      delete req.session.customer;

      return res.status(401).json({
        error:
          "Invalid customer session"
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
          created_at
        FROM customers
        WHERE id = $1
        LIMIT 1
        `,
        [customerId]
      );

    if (!result.rows.length) {
      delete req.session.customer;

      return res.status(401).json({
        error:
          "Customer account not found"
      });
    }

    req.customer =
      result.rows[0];

    next();
  } catch (error) {
    console.error(
      "Customer authorization error:",
      error
    );

    res.status(500).json({
      error:
        "Customer authorization error"
    });
  }
}

// CUSTOMER REGISTER

app.post(
  "/api/customer/register",
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        phone
      } = req.body || {};

      const customerName =
        String(name || "").trim();

      const customerEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      const customerPhone =
        String(phone || "").trim();

      if (
        customerName.length < 2
      ) {
        return res.status(400).json({
          error:
            "Name must be at least 2 characters"
        });
      }

      if (
        !validEmail(
          customerEmail
        )
      ) {
        return res.status(400).json({
          error:
            "Valid email is required"
        });
      }

      if (
        !validPassword(password)
      ) {
        return res.status(400).json({
          error:
            "Password must be at least 8 characters"
        });
      }

      if (
        customerPhone &&
        !/^[0-9]{10}$/.test(
          customerPhone
        )
      ) {
        return res.status(400).json({
          error:
            "Phone must be a valid 10-digit number"
        });
      }

      const existing =
        await pool.query(
          `
          SELECT id
          FROM customers
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [customerEmail]
        );

      if (existing.rows.length) {
        return res.status(409).json({
          error:
            "Customer account already exists"
        });
      }

      const passwordHash =
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
            customerName,
            customerEmail,
            customerPhone ||
              null,
            passwordHash
          ]
        );

      const customer =
        result.rows[0];

      req.session.customer = {
        id: Number(
          customer.id
        ),
        name:
          customer.name,
        email:
          customer.email
      };

      req.session.save(err => {
        if (err) {
          console.error(
            "Customer session save error:",
            err
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
      });
    } catch (error) {
      console.error(
        "Customer registration error:",
        error
      );

      if (
        error.code === "23505"
      ) {
        return res.status(409).json({
          error:
            "Customer account already exists"
        });
      }

      res.status(500).json({
        error:
          "Failed to register customer"
      });
    }
  }
);

// CUSTOMER LOGIN

app.post(
  "/api/customer/login",
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body || {};

      const customerEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      if (
        !validEmail(
          customerEmail
        )
      ) {
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
          `
          SELECT
            id,
            name,
            email,
            phone,
            password_hash,
            created_at
          FROM customers
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [customerEmail]
        );

      if (!result.rows.length) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      const customer =
        result.rows[0];

      const passwordValid =
        await bcrypt.compare(
          password,
          customer.password_hash ||
            ""
        );

      if (!passwordValid) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      req.session.customer = {
        id: Number(
          customer.id
        ),
        name:
          customer.name,
        email:
          customer.email
      };

      req.session.save(err => {
        if (err) {
          console.error(
            "Customer login session error:",
            err
          );

          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.json({
          ok: true,
          customer: {
            id: Number(
              customer.id
            ),
            name:
              customer.name,
            email:
              customer.email,
            phone:
              customer.phone,
            created_at:
              customer.created_at
          }
        });
      });
    } catch (error) {
      console.error(
        "Customer login error:",
        error
      );

      res.status(500).json({
        error:
          "Customer login error"
      });
    }
  }
);

// CUSTOMER LOGOUT

app.post(
  "/api/customer/logout",
  (req, res) => {
    delete req.session.customer;

    req.session.save(err => {
      if (err) {
        return res.status(500).json({
          error:
            "Customer logout error"
        });
      }

      res.json({
        ok: true
      });
    });
  }
);

// CUSTOMER ACCOUNT

app.get(
  "/api/customer/me",
  requireCustomer,
  async (req, res) => {
    res.json({
      loggedIn: true,
      customer:
        req.customer
    });
  }
);

// CUSTOMER MY ORDERS

app.get(
  "/api/customer/orders",
  requireCustomer,
  async (req, res) => {
    try {
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
          WHERE customer_phone = $1
          ORDER BY id DESC
          `,
          [
            req.customer.phone
          ]
        );

      res.json(
        result.rows.map(order => ({
          ...order,
          total:
            Number(
              order.total
            ) || 0,
          items:
            Array.isArray(
              order.items
            )
              ? order.items
              : []
        }))
      );
    } catch (error) {
      console.error(
        "Customer orders error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load customer orders"
      });
    }
  }
);

// =========================
// SELLER AUTH
// =========================

async function requireSeller(
  req,
  res,
  next
) {
  try {
    if (!req.session.seller) {
      return res.status(401).json({
        error:
          "Seller login required"
      });
    }

    const sellerId =
      Number(
        req.session.seller.id
      );

    if (
      !Number.isInteger(
        sellerId
      ) ||
      sellerId <= 0
    ) {
      delete req.session.seller;

      return res.status(401).json({
        error:
          "Invalid seller session"
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
          status,
          created_at
        FROM sellers
        WHERE id = $1
        LIMIT 1
        `,
        [sellerId]
      );

    if (!result.rows.length) {
      delete req.session.seller;

      return res.status(401).json({
        error:
          "Seller account not found"
      });
    }

    const seller =
      result.rows[0];

    if (
      seller.status !==
      "active"
    ) {
      delete req.session.seller;

      return res.status(403).json({
        error:
          "Seller account is blocked"
      });
    }

    req.seller =
      seller;

    next();
  } catch (error) {
    console.error(
      "Seller authorization error:",
      error
    );

    res.status(500).json({
      error:
        "Seller authorization error"
    });
  }
}

// =========================
// SELLER REGISTER
// =========================

app.post(
  "/api/seller/register",
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        phone
      } = req.body || {};

      const sellerName =
        String(name || "").trim();

      const sellerEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      const sellerPhone =
        String(phone || "").trim();

      if (!sellerName) {
        return res.status(400).json({
          error:
            "Seller name is required"
        });
      }

      if (
        sellerName.length < 2
      ) {
        return res.status(400).json({
          error:
            "Seller name is too short"
        });
      }

      if (
        !validEmail(
          sellerEmail
        )
      ) {
        return res.status(400).json({
          error:
            "Valid email is required"
        });
      }

      if (
        !validPassword(password)
      ) {
        return res.status(400).json({
          error:
            "Password must be at least 8 characters"
        });
      }

      if (
        sellerPhone &&
        !/^[0-9]{10}$/.test(
          sellerPhone
        )
      ) {
        return res.status(400).json({
          error:
            "Phone must be a valid 10-digit number"
        });
      }

      const existing =
        await pool.query(
          `
          SELECT id
          FROM sellers
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [sellerEmail]
        );

      if (existing.rows.length) {
        return res.status(409).json({
          error:
            "Seller account already exists"
        });
      }

      const passwordHash =
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
          VALUES ($1,$2,$3,$4,$5)
          RETURNING
            id,
            name,
            email,
            phone,
            status,
            created_at
          `,
          [
            sellerName,
            sellerEmail,
            sellerPhone ||
              null,
            passwordHash,
            "active"
          ]
        );

      const seller =
        result.rows[0];

      req.session.seller = {
        id: Number(
          seller.id
        ),
        name:
          seller.name,
        email:
          seller.email
      };

      req.session.save(err => {
        if (err) {
          console.error(
            "Seller session save error:",
            err
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
      });
    } catch (error) {
      console.error(
        "Seller registration error:",
        error
      );

      if (
        error.code === "23505"
      ) {
        return res.status(409).json({
          error:
            "Seller account already exists"
        });
      }

      res.status(500).json({
        error:
          "Failed to register seller"
      });
    }
  }
);

// =========================
// SELLER LOGIN
// =========================

app.post(
  "/api/seller/login",
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body || {};

      const sellerEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      if (
        !validEmail(
          sellerEmail
        )
      ) {
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
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [sellerEmail]
        );

      if (!result.rows.length) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      const seller =
        result.rows[0];

      if (
        seller.status !==
        "active"
      ) {
        return res.status(403).json({
          error:
            "Seller account is not active"
        });
      }

      const validPasswordResult =
        await bcrypt.compare(
          password,
          seller.password_hash ||
            ""
        );

      if (
        !validPasswordResult
      ) {
        return res.status(401).json({
          error:
            "Invalid email or password"
        });
      }

      req.session.seller = {
        id: Number(
          seller.id
        ),
        name:
          seller.name,
        email:
          seller.email
      };

      req.session.save(err => {
        if (err) {
          console.error(
            "Seller login session error:",
            err
          );

          return res.status(500).json({
            error:
              "Session error"
          });
        }

        res.json({
          ok: true,
          seller: {
            id: Number(
              seller.id
            ),
            name:
              seller.name,
            email:
              seller.email,
            phone:
              seller.phone,
            status:
              seller.status
          }
        });
      });
    } catch (error) {
      console.error(
        "Seller login error:",
        error
      );

      res.status(500).json({
        error:
          "Seller login error"
      });
    }
  }
);

// =========================
// SELLER LOGOUT
// =========================

app.post(
  "/api/seller/logout",
  (req, res) => {
    delete req.session.seller;

    req.session.save(err => {
      if (err) {
        return res.status(500).json({
          error:
            "Seller logout error"
        });
      }

      res.json({
        ok: true
      });
    });
  }
);

// =========================
// SELLER CURRENT ACCOUNT
// =========================

app.get(
  "/api/seller/me",
  requireSeller,
  async (req, res) => {
    res.json({
      loggedIn: true,
      seller:
        req.seller
    });
  }
);

// =========================
// PUBLIC PRODUCTS
// =========================

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
          ON s.id = p.seller_id
        WHERE
          p.seller_id IS NULL
          OR s.status = 'active'
        ORDER BY p.id DESC
      `);

      const products =
        result.rows.map(
          product => {
            const price =
              Number(
                product.price
              ) || 0;

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
                Number(
                  product.stock
                ) || 0,

              seller_name:
                product.seller_name ||
                "Shrivi"
            };
          }
        );

      res.json(products);
    } catch (error) {
      console.error(
        "Products fetch error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to fetch products"
      });
    }
  }
);

// =========================
// ADMIN PRODUCTS
// =========================

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
          ON s.id = p.seller_id
        ORDER BY p.id DESC
      `);

      res.json(
        result.rows.map(
          product => ({
            ...product,

            price:
              Number(
                product.price
              ) || 0,

            stock:
              Number(
                product.stock
              ) || 0,

            discount_percent:
              Number(
                product.discount_percent
              ) || 0,

            sale_price:
              calculateSalePrice(
                product.price,
                product.discount_percent
              )
          })
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

// =========================
// ADMIN ADD PRODUCT
// =========================

app.post(
  "/api/products",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        name,
        price,
        category,
        image,
        description,
        stock,
        discount_percent,
        seller_id
      } = req.body || {};

      const numericPrice =
        Number(price);

      const numericStock =
        stock === "" ||
        stock === undefined
          ? 0
          : Number(stock);

      const numericDiscount =
        discount_percent === "" ||
        discount_percent === undefined
          ? 0
          : Number(
              discount_percent
            );

      let numericSellerId =
        null;

      if (
        seller_id !==
          undefined &&
        seller_id !== null &&
        seller_id !== ""
      ) {
        numericSellerId =
          Number(seller_id);

        if (
          !Number.isInteger(
            numericSellerId
          ) ||
          numericSellerId <= 0
        ) {
          return res.status(400).json({
            error:
              "Invalid seller ID"
          });
        }

        const sellerCheck =
          await pool.query(
            `
            SELECT id, status
            FROM sellers
            WHERE id = $1
            LIMIT 1
            `,
            [numericSellerId]
          );

        if (
          !sellerCheck.rows
            .length
        ) {
          return res.status(400).json({
            error:
              "Seller not found"
          });
        }

        if (
          sellerCheck.rows[0]
            .status !== "active"
        ) {
          return res.status(400).json({
            error:
              "Product cannot be assigned to a blocked seller"
          });
        }
      }

      if (
        !name ||
        !name.trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice < 0
      ) {
        return res.status(400).json({
          error:
            "Valid product price is required"
        });
      }

      if (
        !validStock(
          numericStock
        )
      ) {
        return res.status(400).json({
          error:
            "Stock must be a whole number 0 or greater"
        });
      }

      if (
        !validDiscount(
          numericDiscount
        )
      ) {
        return res.status(400).json({
          error:
            "Discount must be between 0 and 100"
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
            name.trim(),
            numericPrice,
            category || null,
            image || null,
            description || null,
            numericStock,
            numericDiscount,
            numericSellerId
          ]
        );

      const product =
        result.rows[0];

      res.status(201).json({
        ok: true,

        product: {
          ...product,

          sale_price:
            calculateSalePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Product add error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to add product"
      });
    }
  }
);

// =========================
// ADMIN EDIT PRODUCT
// =========================

app.put(
  "/api/products/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const {
        name,
        price,
        category,
        image,
        description,
        stock,
        discount_percent,
        seller_id
      } = req.body || {};

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const numericPrice =
        Number(price);

      const numericStock =
        Number(stock);

      const numericDiscount =
        Number(
          discount_percent
        );

      let numericSellerId =
        null;

      if (
        seller_id !==
          undefined &&
        seller_id !== null &&
        seller_id !== ""
      ) {
        numericSellerId =
          Number(seller_id);

        if (
          !Number.isInteger(
            numericSellerId
          ) ||
          numericSellerId <= 0
        ) {
          return res.status(400).json({
            error:
              "Invalid seller ID"
          });
        }

        const sellerCheck =
          await pool.query(
            `
            SELECT id, status
            FROM sellers
            WHERE id = $1
            LIMIT 1
            `,
            [numericSellerId]
          );

        if (
          !sellerCheck.rows
            .length
        ) {
          return res.status(400).json({
            error:
              "Seller not found"
          });
        }

        if (
          sellerCheck.rows[0]
            .status !== "active"
        ) {
          return res.status(400).json({
            error:
              "Product cannot be assigned to a blocked seller"
          });
        }
      }

      if (
        !name ||
        !name.trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice < 0
      ) {
        return res.status(400).json({
          error:
            "Invalid price"
        });
      }

      if (
        !validStock(
          numericStock
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid stock"
        });
      }

      if (
        !validDiscount(
          numericDiscount
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid discount"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE products
          SET
            name = $1,
            price = $2,
            category = $3,
            image = $4,
            description = $5,
            stock = $6,
            discount_percent = $7,
            seller_id = $8
          WHERE id = $9
          RETURNING *
          `,
          [
            name.trim(),
            numericPrice,
            category || null,
            image || null,
            description || null,
            numericStock,
            numericDiscount,
            numericSellerId,
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

      const product =
        result.rows[0];

      res.json({
        ok: true,

        product: {
          ...product,

          sale_price:
            calculateSalePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Product update error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update product"
      });
    }
  }
);

// =========================
// ADMIN DELETE PRODUCT
// =========================

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
          `
          DELETE FROM products
          WHERE id = $1
          RETURNING id
          `,
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
        "Product delete error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to delete product"
      });
    }
  }
);

// =========================
// SELLER PRODUCTS
// =========================

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
          WHERE seller_id = $1
          ORDER BY id DESC
          `,
          [req.seller.id]
        );

      res.json(
        result.rows.map(
          product => ({
            ...product,

            price:
              Number(
                product.price
              ) || 0,

            stock:
              Number(
                product.stock
              ) || 0,

            discount_percent:
              Number(
                product.discount_percent
              ) || 0,

            sale_price:
              calculateSalePrice(
                product.price,
                product.discount_percent
              )
          })
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

// =========================
// SELLER ADD PRODUCT
// =========================

app.post(
  "/api/seller/products",
  requireSeller,
  async (req, res) => {
    try {
      const {
        name,
        price,
        category,
        image,
        description,
        stock,
        discount_percent
      } = req.body || {};

      const numericPrice =
        Number(price);

      const numericStock =
        stock === "" ||
        stock === undefined
          ? 0
          : Number(stock);

      const numericDiscount =
        discount_percent === "" ||
        discount_percent === undefined
          ? 0
          : Number(
              discount_percent
            );

      if (
        !name ||
        !name.trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice < 0
      ) {
        return res.status(400).json({
          error:
            "Valid product price is required"
        });
      }

      if (
        !validStock(
          numericStock
        )
      ) {
        return res.status(400).json({
          error:
            "Stock must be a whole number 0 or greater"
        });
      }

      if (
        !validDiscount(
          numericDiscount
        )
      ) {
        return res.status(400).json({
          error:
            "Discount must be between 0 and 100"
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
            name.trim(),
            numericPrice,
            category || null,
            image || null,
            description || null,
            numericStock,
            numericDiscount,
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
            calculateSalePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Seller product add error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to add product"
      });
    }
  }
);

// =========================
// SELLER EDIT PRODUCT
// =========================

app.put(
  "/api/seller/products/:id",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const {
        name,
        price,
        category,
        image,
        description,
        stock,
        discount_percent
      } = req.body || {};

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          error:
            "Invalid product ID"
        });
      }

      const numericPrice =
        Number(price);

      const numericStock =
        Number(stock);

      const numericDiscount =
        Number(
          discount_percent
        );

      if (
        !name ||
        !name.trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required"
        });
      }

      if (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice < 0
      ) {
        return res.status(400).json({
          error:
            "Invalid price"
        });
      }

      if (
        !validStock(
          numericStock
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid stock"
        });
      }

      if (
        !validDiscount(
          numericDiscount
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid discount"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE products
          SET
            name = $1,
            price = $2,
            category = $3,
            image = $4,
            description = $5,
            stock = $6,
            discount_percent = $7
          WHERE id = $8
            AND seller_id = $9
          RETURNING *
          `,
          [
            name.trim(),
            numericPrice,
            category || null,
            image || null,
            description || null,
            numericStock,
            numericDiscount,
            id,
            req.seller.id
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

      const product =
        result.rows[0];

      res.json({
        ok: true,

        product: {
          ...product,

          sale_price:
            calculateSalePrice(
              product.price,
              product.discount_percent
            )
        }
      });
    } catch (error) {
      console.error(
        "Seller product update error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update seller product"
      });
    }
  }
);

// =========================
// SELLER DELETE PRODUCT
// =========================

app.delete(
  "/api/seller/products/:id",
  requireSeller,
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
          `
          DELETE FROM products
          WHERE id = $1
            AND seller_id = $2
          RETURNING id
          `,
          [
            id,
            req.seller.id
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
        ok: true
      });
    } catch (error) {
      console.error(
        "Seller product delete error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to delete seller product"
      });
    }
  }
);

// =========================
// CREATE CUSTOMER ORDER
// =========================

app.post(
  "/api/orders",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const {
        customer_name,
        customer_phone,
        customer_address,
        items
      } = req.body || {};

      if (
        !customer_name ||
        !customer_phone ||
        !customer_address ||
        !Array.isArray(items) ||
        !items.length
      ) {
        return res.status(400).json({
          error:
            "Customer details and cart items are required"
        });
      }

      const name =
        String(
          customer_name
        ).trim();

      const phone =
        String(
          customer_phone
        ).trim();

      const address =
        String(
          customer_address
        ).trim();

      if (!name) {
        return res.status(400).json({
          error:
            "Customer name is required"
        });
      }

      if (
        !/^[0-9]{10}$/.test(
          phone
        )
      ) {
        return res.status(400).json({
          error:
            "Valid 10-digit mobile number is required"
        });
      }

      if (!address) {
        return res.status(400).json({
          error:
            "Delivery address is required"
        });
      }

      const quantityMap =
        new Map();

      for (
        const item of items
      ) {
        const id =
          Number(
            item?.id
          );

        const quantity =
          Number(
            item?.quantity
          );

        if (
          !Number.isInteger(
            id
          ) ||
          id <= 0 ||
          !Number.isInteger(
            quantity
          ) ||
          quantity <= 0 ||
          quantity > 999
        ) {
          return res.status(400).json({
            error:
              "Invalid cart item"
          });
        }

        const newQuantity =
          (quantityMap.get(id) ||
            0) +
          quantity;

        if (
          newQuantity > 999
        ) {
          return res.status(400).json({
            error:
              "Maximum quantity exceeded"
          });
        }

        quantityMap.set(
          id,
          newQuantity
        );
      }

      const ids = [
        ...quantityMap.keys()
      ];

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
            ON s.id = p.seller_id
          WHERE
            p.id = ANY($1::int[])
            AND (
              p.seller_id IS NULL
              OR s.status = 'active'
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
          error:
            "One or more products are no longer available"
        });
      }

      const products =
        new Map();

      result.rows.forEach(
        product => {
          products.set(
            Number(
              product.id
            ),
            product
          );
        }
      );

      const verifiedItems =
        [];

      let total = 0;

      for (
        const id of ids
      ) {
        const product =
          products.get(id);

        const quantity =
          quantityMap.get(id);

        const stock =
          Number(
            product.stock
          ) || 0;

        if (
          stock < quantity
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error:
              `${product.name} has only ${stock} item(s) available`
          });
        }

        const price =
          Number(
            product.price
          ) || 0;

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
            salePrice,

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

      for (
        const id of ids
      ) {
        const quantity =
          quantityMap.get(id);

        const updateResult =
          await client.query(
            `
            UPDATE products
            SET stock = stock - $1
            WHERE id = $2
              AND stock >= $1
            RETURNING id, stock
            `,
            [
              quantity,
              id
            ]
          );

        if (
          !updateResult.rows
            .length
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res.status(409).json({
            error:
              "Stock changed. Please refresh your cart and try again."
          });
        }
      }

      const orderResult =
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
          ($1,$2,$3,$4,$5,$6)
          RETURNING *
          `,
          [
            name,
            phone,
            address,
            JSON.stringify(
              verifiedItems
            ),
            total,
            "pending"
          ]
        );

      await client.query(
        "COMMIT"
      );

      res.status(201).json({
        ok: true,
        order:
          orderResult.rows[0]
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "Order error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to create order"
      });
    } finally {
      client.release();
    }
  }
);

// =========================
// CUSTOMER ORDER TRACKING
// =========================

app.get(
  "/api/orders/track/:id",
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
          WHERE id = $1
          LIMIT 1
          `,
          [id]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const order =
        result.rows[0];

      res.json({
        id:
          order.id,

        status:
          order.status,

        total:
          Number(
            order.total
          ) || 0,

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
        "Order tracking error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to track order"
      });
    }
  }
);

// =========================
// ADMIN ORDERS
// =========================

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
        "Orders fetch error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to fetch orders"
      });
    }
  }
);

// =========================
// SELLER ORDERS
// =========================

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
            WHERE
              NULLIF(
                item->>'seller_id',
                ''
              )::integer = $1
          )
          ORDER BY id DESC
          `,
          [sellerId]
        );

      const sellerOrders =
        result.rows.map(
          order => {
            const allItems =
              Array.isArray(
                order.items
              )
                ? order.items
                : [];

            const sellerItems =
              allItems.filter(
                item =>
                  Number(
                    item?.seller_id
                  ) ===
                  sellerId
              );

            const sellerTotal =
              Math.round(
                sellerItems.reduce(
                  (
                    sum,
                    item
                  ) =>
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
              ...order,
              items:
                sellerItems,
              seller_total:
                sellerTotal
            };
          }
        );

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

// =========================
// SELLER DASHBOARD
// =========================

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
          WHERE seller_id = $1
          `,
          [sellerId]
        );

      const stock =
        await pool.query(
          `
          SELECT COALESCE(
            SUM(stock),
            0
          ) AS stock
          FROM products
          WHERE seller_id = $1
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
            WHERE
              NULLIF(
                item->>'seller_id',
                ''
              )::integer = $1
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
                  SELECT COALESCE(
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
                  WHERE
                    NULLIF(
                      item->>'seller_id',
                      ''
                    )::integer = $1
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
            WHERE
              NULLIF(
                item->>'seller_id',
                ''
              )::integer = $1
          )
          `,
          [sellerId]
        );

      res.json({
        products:
          Number(
            products.rows[0]
              .count
          ),

        stock:
          Number(
            stock.rows[0]
              .stock
          ),

        orders:
          Number(
            orders.rows[0]
              .count
          ),

        revenue:
          Number(
            revenue.rows[0]
              .revenue
          ) || 0
      });
    } catch (error) {
      console.error(
        "Seller dashboard error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load seller dashboard"
      });
    }
  }
);

// =========================
// SELLER UPDATE ORDER STATUS
// =========================

app.put(
  "/api/seller/orders/:id/status",
  requireSeller,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const status =
        String(
          req.body?.status ||
            ""
        )
          .trim()
          .toLowerCase();

      const allowed = [
        "confirmed",
        "shipped",
        "delivered",
        "cancelled"
      ];

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
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
          SELECT
            id,
            items,
            status
          FROM orders
          WHERE id = $1
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                COALESCE(
                  items,
                  '[]'::jsonb
                )
              ) AS item
              WHERE
                NULLIF(
                  item->>'seller_id',
                  ''
                )::integer = $2
            )
          `,
          [
            id,
            sellerId
          ]
        );

      if (
        !check.rows.length
      ) {
        return res.status(404).json({
          error:
            "Order not found for this seller"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE orders
          SET status = $1
          WHERE id = $2
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

// =========================
// ADMIN UPDATE ORDER STATUS
// =========================

app.put(
  "/api/orders/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const status =
        String(
          req.body?.status ||
            ""
        )
          .trim()
          .toLowerCase();

      const allowed = [
        "pending",
        "confirmed",
        "shipped",
        "delivered",
        "cancelled"
      ];

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
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
          error:
            "Invalid order status"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE orders
          SET status = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            status,
            id
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
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
        "Order status error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update order status"
      });
    }
  }
);

// =========================
// ADMIN SELLERS
// =========================

app.get(
  "/api/admin/sellers",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
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
            ON p.seller_id = s.id
          GROUP BY
            s.id,
            s.name,
            s.email,
            s.phone,
            s.status,
            s.created_at
          ORDER BY s.id DESC
          `
        );

      res.json(
        result.rows.map(
          seller => ({
            ...seller,

            product_count:
              Number(
                seller.product_count
              )
          })
        )
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

// =========================
// ADMIN SELLER STATUS
// =========================

app.put(
  "/api/admin/sellers/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      const status =
        String(
          req.body?.status ||
            ""
        )
          .trim()
          .toLowerCase();

      const allowed = [
        "active",
        "blocked"
      ];

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          error:
            "Invalid seller ID"
        });
      }

      if (
        !allowed.includes(
          status
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid seller status"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE sellers
          SET status = $1
          WHERE id = $2
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

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
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
        "Seller status error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update seller status"
      });
    }
  }
);

// =========================
// DASHBOARD
// =========================

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

      res.json({
        products:
          Number(
            products.rows[0]
              .count
          ),

        orders:
          Number(
            orders.rows[0]
              .count
          ),

        sellers:
          Number(
            sellers.rows[0]
              .count
          )
      });
    } catch (error) {
      console.error(
        "Dashboard error:",
        error
      );

      res.status(500).json({
        error:
          "Database error"
      });
    }
  }
);

// =========================
// DATABASE INITIALIZATION
// =========================

async function initializeDatabase() {

  // =======================
  // PRODUCTS
  // =======================

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
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock
    INTEGER NOT NULL DEFAULT 999999
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS discount_percent
    NUMERIC(5,2) NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS seller_id
    INTEGER
  `);

  // =======================
  // ORDERS
  // =======================

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      total NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_name TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_phone TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_address TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS items JSONB
  `);

  // =======================
  // SELLERS
  // =======================

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    ADD COLUMN IF NOT EXISTS status TEXT
    NOT NULL DEFAULT 'active'
  `);

  await pool.query(`
    UPDATE sellers
    SET status = 'active'
    WHERE status IS NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    sellers_email_unique_idx
    ON sellers (LOWER(email))
    WHERE email IS NOT NULL
  `);

  // =======================
  // CUSTOMERS
  // =======================

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    customers_email_unique_idx
    ON customers (LOWER(email))
  `);

  console.log(
    "SHRIVI database tables ready"
  );
}

// =========================
// DATABASE START
// =========================

async function startDatabase() {
  try {
    await pool.query(
      "SELECT NOW()"
    );

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
// SERVER START
// =========================

app.listen(
  PORT,
  () => {
    console.log(
      `SHRIVI server running on port ${PORT}`
    );
  }
);
