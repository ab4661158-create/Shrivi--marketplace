const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { Pool } = require("pg");
const { v2: cloudinary } = require("cloudinary");

const originalListen = express.application.listen;
const originalSendFile = express.response.sendFile;

// ======================================================
// IMAGE UPLOAD UI INJECTION
// ======================================================
express.response.sendFile = function (filePath, ...args) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const isTargetPage = normalized.endsWith("/admin.html") || normalized.endsWith("/seller.html");

  if (!isTargetPage) return originalSendFile.call(this, filePath, ...args);

  const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;

  fs.readFile(filePath, "utf8", (error, html) => {
    if (error) {
      if (callback) return callback(error);
      return this.status(500).send("Page load error");
    }

    if (!html.includes("/image-upload-ui.js")) {
      html = html.replace(/<\/body>/i, '<script src="/image-upload-ui.js?v=400"></script></body>');
    }

    this.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    this.type("html").send(html);
    if (callback) callback();
  });
};

// ======================================================
// MULTER
// ======================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Only JPG, PNG and WEBP images are allowed"));
    }
    cb(null, true);
  }
});

// ======================================================
// DATABASE
// ======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cloudinaryConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  if (!cloudinaryConfigured()) return false;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });

  return true;
}

async function uploadToCloudinary(file, productId) {
  if (!configureCloudinary()) {
    const error = new Error("Cloudinary is not configured on the server");
    error.statusCode = 503;
    throw error;
  }

  return await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "shrivi/products",
        public_id: `product-${productId}-${Date.now()}`,
        resource_type: "image"
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error("Cloudinary returned no image URL"));
        resolve(result.secure_url);
      }
    );

    stream.end(file.buffer);
  });
}

// ======================================================
// ROUTES
// ======================================================
function installImageRoutes(app) {
  if (app.__shriviImageRoutesInstalledV4) return;
  app.__shriviImageRoutesInstalledV4 = true;

  app.post("/api/seller/products/:id/image", upload.single("image"), async (req, res) => {
    try {
      const sellerId = positiveInt(req.session?.seller?.id);
      if (!sellerId) {
        return res.status(401).json({ ok: false, error: "Seller login required" });
      }

      const productId = positiveInt(req.params.id);
      if (!productId) {
        return res.status(400).json({ ok: false, error: "Invalid product id" });
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Image file is required" });
      }

      const owner = await pool.query(
        `SELECT p.id
         FROM products p
         JOIN sellers s ON s.id = p.seller_id
         WHERE p.id = $1 AND p.seller_id = $2 AND s.status = 'active'
         LIMIT 1`,
        [productId, sellerId]
      );

      if (!owner.rows.length) {
        return res.status(404).json({ ok: false, error: "Seller product not found" });
      }

      const imageUrl = await uploadToCloudinary(req.file, productId);

      const saved = await pool.query(
        `UPDATE products
         SET image = $1
         WHERE id = $2 AND seller_id = $3
         RETURNING id, image`,
        [imageUrl, productId, sellerId]
      );

      return res.json({ ok: true, url: imageUrl, product: saved.rows[0] });
    } catch (error) {
      console.error("Seller product image upload:", error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || "Image upload failed"
      });
    }
  });

  app.post("/api/admin/products/:id/image", upload.single("image"), async (req, res) => {
    try {
      if (!req.session?.admin) {
        return res.status(401).json({ ok: false, error: "Admin login required" });
      }

      const productId = positiveInt(req.params.id);
      if (!productId) {
        return res.status(400).json({ ok: false, error: "Invalid product id" });
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, error: "Image file is required" });
      }

      const exists = await pool.query("SELECT id FROM products WHERE id = $1 LIMIT 1", [productId]);
      if (!exists.rows.length) {
        return res.status(404).json({ ok: false, error: "Product not found" });
      }

      const imageUrl = await uploadToCloudinary(req.file, productId);
      const saved = await pool.query(
        "UPDATE products SET image = $1 WHERE id = $2 RETURNING id, image",
        [imageUrl, productId]
      );

      return res.json({ ok: true, url: imageUrl, product: saved.rows[0] });
    } catch (error) {
      console.error("Admin product image upload:", error);
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || "Image upload failed"
      });
    }
  });

  app.use((error, req, res, next) => {
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ ok: false, error: "Image must be 5MB or smaller" });
    }

    if (error?.message === "Only JPG, PNG and WEBP images are allowed") {
      return res.status(400).json({ ok: false, error: error.message });
    }

    next(error);
  });
}

// The existing server registers its generic API-404 handler before listen().
// Promote our upload routes ahead of that handler so they can actually match.
function promoteImageRoutes(app) {
  const stack = app?._router?.stack;
  if (!Array.isArray(stack)) return;

  const routeLayers = [];
  const remaining = [];

  for (const layer of stack) {
    const path = layer?.route?.path;
    if (
      path === "/api/seller/products/:id/image" ||
      path === "/api/admin/products/:id/image"
    ) {
      routeLayers.push(layer);
    } else {
      remaining.push(layer);
    }
  }

  if (!routeLayers.length) return;

  let insertAt = remaining.findIndex(layer => {
    if (layer?.route) return false;
    const source = String(layer?.handle || "");
    return source.includes("API endpoint not found");
  });

  if (insertAt < 0) {
    insertAt = remaining.length;
  }

  remaining.splice(insertAt, 0, ...routeLayers);
  app._router.stack = remaining;
}

// Install routes immediately before the existing server starts listening.
express.application.listen = function (...args) {
  installImageRoutes(this);
  promoteImageRoutes(this);
  return originalListen.apply(this, args);
};

require("./server.js");
