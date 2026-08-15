const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let ADMIN_HASH = null;

(async () => {
  if (!ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD environment variable is missing");
    return;
  }

  ADMIN_HASH = await bcrypt.hash(ADMIN_PASSWORD, 10);
})();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

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

    res.status(401).json({
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
// PRODUCT HELPERS
// =========================

function calculateSalePrice(price, discountPercent) {
  const originalPrice = Number(price) || 0;
  const discount = Number(discountPercent) || 0;

  const salePrice =
    originalPrice -
    (originalPrice * discount) / 100;

  return Math.round(salePrice * 100) / 100;
}

function validDiscount(value) {
  const discount = Number(value);

  return (
    Number.isFinite(discount) &&
    discount >= 0 &&
    discount <= 100
  );
}

function validStock(value) {
  const stock = Number(value);

  return (
    Number.isInteger(stock) &&
    stock >= 0
  );
}

// =========================
// PRODUCTS - PUBLIC
// =========================

app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        price,
        category,
        image,
        description,
        stock,
        discount_percent,
        created_at
      FROM products
      ORDER BY id DESC
    `);

    const products = result.rows.map((product) => {
      const originalPrice = Number(product.price) || 0;
      const discountPercent =
        Number(product.discount_percent) || 0;

      return {
        ...product,
        price: originalPrice,
        original_price: originalPrice,
        discount_percent: discountPercent,
        sale_price: calculateSalePrice(
          originalPrice,
          discountPercent
        ),
        stock: Number(product.stock) || 0
      };
    });

    res.json(products);

  } catch (error) {
    console.error("Products fetch error:", error);

    res.status(500).json({
      error: "Failed to fetch products"
    });
  }
});

// =========================
// ADD PRODUCT - ADMIN
// =========================

app.post("/api/products", requireAdmin, async (req, res) => {
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

    const numericPrice = Number(price);

    const numericStock =
      stock === undefined ||
      stock === ""
        ? 999999
        : Number(stock);

    const numericDiscount =
      discount_percent === undefined ||
      discount_percent === ""
        ? 0
        : Number(discount_percent);

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Product name is required"
      });
    }

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice < 0
    ) {
      return res.status(400).json({
        error: "Valid product price is required"
      });
    }

    if (!validStock(numericStock)) {
      return res.status(400).json({
        error: "Stock must be a whole number 0 or greater"
      });
    }

    if (!validDiscount(numericDiscount)) {
      return res.status(400).json({
        error: "Discount must be between 0 and 100"
      });
    }

    const result = await pool.query(
      `INSERT INTO products
       (
         name,
         price,
         category,
         image,
         description,
         stock,
         discount_percent
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name.trim(),
        numericPrice,
        category || null,
        image || null,
        description || null,
        numericStock,
        numericDiscount
      ]
    );

    const product = result.rows[0];

    res.status(201).json({
      ok: true,
      product: {
        ...product,
        sale_price: calculateSalePrice(
          product.price,
          product.discount_percent
        )
      }
    });

  } catch (error) {
    console.error("Product add error:", error);

    res.status(500).json({
      error: "Failed to add product"
    });
  }
});

// =========================
// CREATE ORDER - SECURE
// =========================

app.post("/api/orders", async (req, res) => {
  const client = await pool.connect();

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
      items.length === 0
    ) {
      return res.status(400).json({
        error: "Customer details and cart items are required"
      });
    }

    const name = String(customer_name).trim();
    const phone = String(customer_phone).trim();
    const address = String(customer_address).trim();

    if (!name) {
      return res.status(400).json({
        error: "Customer name is required"
      });
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({
        error: "Valid 10-digit mobile number is required"
      });
    }

    if (!address) {
      return res.status(400).json({
        error: "Delivery address is required"
      });
    }

    // Combine duplicate product IDs safely
    const quantityMap = new Map();

    for (const item of items) {
      const id = Number(item && item.id);
      const quantity = Number(item && item.quantity);

      if (
        !Number.isInteger(id) ||
        id <= 0 ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        quantity > 999
      ) {
        return res.status(400).json({
          error: "Invalid cart item"
        });
      }

      quantityMap.set(
        id,
        (quantityMap.get(id) || 0) + quantity
      );
    }

    const productIds =
      Array.from(quantityMap.keys());

    await client.query("BEGIN");

    // Lock products while checking stock.
    const productResult = await client.query(
      `SELECT
         id,
         name,
         price,
         category,
         image,
         description,
         stock,
         discount_percent
       FROM products
       WHERE id = ANY($1::int[])
       FOR UPDATE`,
      [productIds]
    );

    if (
      productResult.rows.length !==
      productIds.length
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "One or more products are no longer available"
      });
    }

    const productsById = new Map();

    for (const product of productResult.rows) {
      productsById.set(
        Number(product.id),
        product
      );
    }

    let finalTotal = 0;
    const verifiedItems = [];

    for (const id of productIds) {
      const product =
        productsById.get(id);

      const quantity =
        quantityMap.get(id);

      const stock =
        Number(product.stock) || 0;

      if (stock < quantity) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error:
            `${product.name} has only ${stock} item(s) available`
        });
      }

      const originalPrice =
        Number(product.price) || 0;

      const discountPercent =
        Number(product.discount_percent) || 0;

      const salePrice =
        calculateSalePrice(
          originalPrice,
          discountPercent
        );

      const itemTotal =
        Math.round(
          salePrice * quantity * 100
        ) / 100;

      finalTotal += itemTotal;

      verifiedItems.push({
        id: Number(product.id),
        name: product.name,
        category: product.category || "",
        image: product.image || "",
        quantity,
        original_price: originalPrice,
        discount_percent: discountPercent,
        price: salePrice,
        item_total: itemTotal
      });
    }

    finalTotal =
      Math.round(finalTotal * 100) / 100;

    // Reduce stock only after every item passed validation.
    for (const id of productIds) {
      const quantity =
        quantityMap.get(id);

      await client.query(
        `UPDATE products
         SET stock = stock - $1
         WHERE id = $2`,
        [quantity, id]
      );
    }

    const orderResult = await client.query(
      `INSERT INTO orders
       (
         customer_name,
         customer_phone,
         customer_address,
         items,
         total,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        phone,
        address,
        JSON.stringify(verifiedItems),
        finalTotal,
        "pending"
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      ok: true,
      order: orderResult.rows[0]
    });

  } catch (error) {

    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Rollback error:",
        rollbackError
      );
    }

    console.error(
      "Order create error:",
      error
    );

    res.status(500).json({
      error: "Failed to create order"
    });

  } finally {
    client.release();
  }
});

// =========================
// ADMIN ORDERS
// =========================

app.get("/api/orders", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY id DESC"
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Orders fetch error:", error);

    res.status(500).json({
      error: "Failed to fetch orders"
    });
  }
});

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

  // Safe migration for existing products
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 999999
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      total NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Safe updates for existing orders table

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log(
    "SHRIVI database tables ready"
  );
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

    res.json({
      products:
        Number(products.rows[0].count),

      orders:
        Number(orders.rows[0].count),

      sellers:
        Number(sellers.rows[0].count)
    });

  } catch (error) {

    console.error(
      "Dashboard error:",
      error
    );

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
