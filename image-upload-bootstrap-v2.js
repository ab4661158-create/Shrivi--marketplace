const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// IMPORTANT: server.js uses express.static(). Patch static BEFORE loading server.js
// so admin.html and seller.html always receive the upload UI script.
const originalStatic = express.static;
express.static = function (root, options) {
  const staticHandler = originalStatic.call(express, root, options);
  return function (req, res, next) {
    const pathname = String(req.path || "").toLowerCase();
    if (pathname === "/admin.html" || pathname === "/seller.html") {
      const filePath = path.join(root, pathname.slice(1));
      return fs.readFile(filePath, "utf8", (err, html) => {
        if (err) return next(err);
        const script = '<script src="/image-upload-ui.js?v=2"></script>';
        const output = /<\/body>/i.test(html)
          ? html.replace(/<\/body>/i, script + "</body>")
          : html + script;
        res.type("html").send(output);
      });
    }
    return staticHandler(req, res, next);
  };
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
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

function sign(params, secret) {
  const text = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(text + secret).digest("hex");
}

async function cloudinaryUpload(file, productId) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) throw Object.assign(new Error("Image storage is not configured"), { statusCode: 503 });

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `product-${productId}-${Date.now()}`;
  const folder = "shrivi/products";
  const signature = sign({ folder, public_id: publicId, timestamp }, secret);
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append("api_key", key);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.secure_url) throw Object.assign(new Error(data.error?.message || "Image upload failed"), { statusCode: 502 });
  return data.secure_url;
}

function installRoutes(app) {
  if (app.__shriviImageRoutesV2) return;
  app.__shriviImageRoutesV2 = true;

  app.post("/api/admin/products/:id/image", upload.single("image"), async (req, res) => {
    try {
      if (!req.session?.admin) return res.status(401).json({ error: "Admin login required" });
      const id = positiveInt(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid product id" });
      if (!req.file) return res.status(400).json({ error: "Image file is required" });
      const exists = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [id]);
      if (!exists.rows.length) return res.status(404).json({ error: "Product not found" });
      const url = await cloudinaryUpload(req.file, id);
      const result = await pool.query("UPDATE products SET image=$1 WHERE id=$2 RETURNING id,image", [url, id]);
      res.json({ ok: true, product: result.rows[0] });
    } catch (e) {
      console.error("Admin image upload:", e);
      res.status(e.statusCode || 500).json({ error: e.message || "Image upload failed" });
    }
  });

  app.post("/api/seller/products/:id/image", upload.single("image"), async (req, res) => {
    try {
      if (!req.session?.seller) return res.status(401).json({ error: "Seller login required" });
      const id = positiveInt(req.params.id);
      const sellerId = positiveInt(req.session.seller.id);
      if (!id || !sellerId) return res.status(400).json({ error: "Invalid product or seller" });
      if (!req.file) return res.status(400).json({ error: "Image file is required" });
      const exists = await pool.query("SELECT id FROM products WHERE id=$1 AND seller_id=$2 LIMIT 1", [id, sellerId]);
      if (!exists.rows.length) return res.status(404).json({ error: "Seller product not found" });
      const url = await cloudinaryUpload(req.file, id);
      const result = await pool.query("UPDATE products SET image=$1 WHERE id=$2 AND seller_id=$3 RETURNING id,image", [url, id, sellerId]);
      res.json({ ok: true, product: result.rows[0] });
    } catch (e) {
      console.error("Seller image upload:", e);
      res.status(e.statusCode || 500).json({ error: e.message || "Image upload failed" });
    }
  });
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  installRoutes(this);
  return originalListen.apply(this, args);
};

require("./server.js");
