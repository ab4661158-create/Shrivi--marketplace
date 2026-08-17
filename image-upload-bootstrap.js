const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const { Pool } = require("pg");

const originalListen = express.application.listen;
const originalSendFile = express.response.sendFile;

express.response.sendFile = function (filePath, ...args) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const isTargetPage = normalized.endsWith("/admin.html") || normalized.endsWith("/seller.html");

  if (!isTargetPage) {
    return originalSendFile.call(this, filePath, ...args);
  }

  const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
  const options = callback ? args[0] : args[0];

  fs.readFile(filePath, "utf8", (error, html) => {
    if (error) {
      if (callback) return callback(error);
      return this.status(500).send("Page load error");
    }

    const injected = html.replace(
      /<\\/body>/i,
      '<script src="/image-upload-ui.js"></script></body>'
    );

    this.type("html").send(injected);
    if (callback) callback();
  });
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp"
    ]);

    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Only JPG, PNG and WEBP images are allowed"));
    }

    cb(null, true);
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cloudinarySignature(params, apiSecret) {
  const canonical = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(canonical + apiSecret)
    .digest("hex");
}

async function uploadToCloudinary(file, productId) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("Image storage is not configured");
    error.statusCode = 503;
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `product-${productId}-${Date.now()}`;
  const folder = "shrivi/products";

  const signedParams = {
    folder,
    public_id: publicId,
    timestamp
  };

  const signature = cloudinarySignature(signedParams, apiSecret);

  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    {
      method: "POST",
      body: form
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.secure_url) {
    console.error("Cloudinary upload failed:", data);
    const error = new Error("Image upload failed");
    error.statusCode = 502;
    throw error;
  }

  return data.secure_url;
}

async function requireAdminSession(req, res) {
  if (!req.session || !req.session.admin) {
    res.status(401).json({ error: "Admin login required" });
    return false;
  }
  return true;
}

async function requireSellerProduct(req, res, productId) {
  if (!req.session || !req.session.seller) {
    res.status(401).json({ error: "Seller login required" });
    return null;
  }

  const sellerId = positiveInt(req.session.seller.id);
  if (!sellerId) {
    res.status(401).json({ error: "Invalid seller session" });
    return null;
  }

  const result = await pool.query(
    `
    SELECT p.id
    FROM products p
    JOIN sellers s ON s.id = p.seller_id
    WHERE p.id = $1
      AND p.seller_id = $2
      AND s.status = 'active'
    LIMIT 1
    `,
    [productId, sellerId]
  );

  if (!result.rows.length) {
    res.status(404).json({ error: "Seller product not found" });
    return null;
  }

  return sellerId;
}

function installImageRoutes(app) {
  if (app.__shriviImageRoutesInstalled) return;
  app.__shriviImageRoutesInstalled = true;

  app.post(
    "/api/admin/products/:id/image",
    upload.single("image"),
    async (req, res) => {
      try {
        if (!(await requireAdminSession(req, res))) return;

        const productId = positiveInt(req.params.id);
        if (!productId) return res.status(400).json({ error: "Invalid product id" });
        if (!req.file) return res.status(400).json({ error: "Image file is required" });

        const existing = await pool.query(
          "SELECT id FROM products WHERE id = $1 LIMIT 1",
          [productId]
        );

        if (!existing.rows.length) {
          return res.status(404).json({ error: "Product not found" });
        }

        const imageUrl = await uploadToCloudinary(req.file, productId);

        const result = await pool.query(
          `UPDATE products SET image = $1 WHERE id = $2 RETURNING id, image`,
          [imageUrl, productId]
        );

        return res.json({ ok: true, product: result.rows[0] });
      } catch (error) {
        console.error("Admin product image upload:", error);
        return res.status(error.statusCode || 500).json({
          error: error.message || "Image upload failed"
        });
      }
    }
  );

  app.post(
    "/api/seller/products/:id/image",
    upload.single("image"),
    async (req, res) => {
      try {
        const productId = positiveInt(req.params.id);
        if (!productId) return res.status(400).json({ error: "Invalid product id" });

        const sellerId = await requireSellerProduct(req, res, productId);
        if (!sellerId) return;
        if (!req.file) return res.status(400).json({ error: "Image file is required" });

        const imageUrl = await uploadToCloudinary(req.file, productId);

        const result = await pool.query(
          `
          UPDATE products
          SET image = $1
          WHERE id = $2 AND seller_id = $3
          RETURNING id, image
          `,
          [imageUrl, productId, sellerId]
        );

        if (!result.rows.length) {
          return res.status(404).json({ error: "Seller product not found" });
        }

        return res.json({ ok: true, product: result.rows[0] });
      } catch (error) {
        console.error("Seller product image upload:", error);
        return res.status(error.statusCode || 500).json({
          error: error.message || "Image upload failed"
        });
      }
    }
  );

  app.use((error, req, res, next) => {
    if (error && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Image must be 5MB or smaller" });
    }

    if (error && error.message === "Only JPG, PNG and WEBP images are allowed") {
      return res.status(400).json({ error: error.message });
    }

    next(error);
  });
}

express.application.listen = function (...args) {
  installImageRoutes(this);
  return originalListen.apply(this, args);
};

require("./server.js");
