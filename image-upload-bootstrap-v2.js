const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPG, PNG and WEBP images are allowed"));
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cloudinaryConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function signature(params, secret) {
  const text = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(text + secret).digest("hex");
}

async function uploadToCloudinary(file, productId) {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary is not configured");

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "shrivi/products";
  const publicId = `product-${productId}-${Date.now()}`;
  const params = { folder, public_id: publicId, timestamp };
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append("api_key", process.env.CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("signature", signature(params, process.env.CLOUDINARY_API_SECRET));

  const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(process.env.CLOUDINARY_CLOUD_NAME)}/image/upload`, {
    method: "POST",
    body: form
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.secure_url) throw new Error(data.error?.message || "Cloudinary upload failed");
  return data.secure_url;
}

// IMPORTANT: inject the upload UI directly into every HTML page sent with sendFile.
const originalSendFile = express.response.sendFile;
express.response.sendFile = function(filePath, options, callback) {
  const res = this;
  const done = typeof options === "function" ? options : callback;
  const absolute = path.resolve(filePath);

  fs.readFile(absolute, "utf8", (err, html) => {
    if (err) {
      if (typeof done === "function") return done(err);
      return res.status(500).send("Failed to load page");
    }

    const script = '<script src="/image-upload-ui.js?v=100"></script>';
    const output = /<\/body>/i.test(html)
      ? html.replace(/<\/body>/i, script + "</body>")
      : html + script;

    res.status(200).type("html").send(output);
  });
};

// Add the actual product-image endpoints before server.js starts listening.
const originalListen = express.application.listen;
express.application.listen = function(...args) {
  const app = this;
  if (!app.__shriviImageUploadRoutes) {
    app.__shriviImageUploadRoutes = true;

    app.post("/api/admin/products/:id/image", upload.single("image"), async (req, res) => {
      try {
        if (!req.session?.admin) return res.status(401).json({ error: "Admin login required" });
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid product id" });
        if (!req.file) return res.status(400).json({ error: "Image file is required" });

        const exists = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [id]);
        if (!exists.rows.length) return res.status(404).json({ error: "Product not found" });

        const url = await uploadToCloudinary(req.file, id);
        const result = await pool.query("UPDATE products SET image=$1 WHERE id=$2 RETURNING id,image", [url, id]);
        res.json({ ok: true, url, product: result.rows[0] });
      } catch (e) {
        console.error("Admin product image upload:", e);
        res.status(500).json({ error: e.message || "Image upload failed" });
      }
    });

    app.post("/api/seller/products/:id/image", upload.single("image"), async (req, res) => {
      try {
        if (!req.session?.seller) return res.status(401).json({ error: "Seller login required" });
        const id = Number(req.params.id);
        const sellerId = Number(req.session.seller.id);
        if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(sellerId) || sellerId <= 0) return res.status(400).json({ error: "Invalid product or seller" });
        if (!req.file) return res.status(400).json({ error: "Image file is required" });

        const exists = await pool.query("SELECT id FROM products WHERE id=$1 AND seller_id=$2 LIMIT 1", [id, sellerId]);
        if (!exists.rows.length) return res.status(404).json({ error: "Seller product not found" });

        const url = await uploadToCloudinary(req.file, id);
        const result = await pool.query("UPDATE products SET image=$1 WHERE id=$2 AND seller_id=$3 RETURNING id,image", [url, id, sellerId]);
        res.json({ ok: true, url, product: result.rows[0] });
      } catch (e) {
        console.error("Seller product image upload:", e);
        res.status(500).json({ error: e.message || "Image upload failed" });
      }
    });
  }
  return originalListen.apply(this, args);
};

require("./server.js");
