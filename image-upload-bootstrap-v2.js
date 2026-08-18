const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const { Pool } = require("pg");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
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

const originalGet = express.application.get;
express.application.get = function (...args) {
  const route = args[0];
  const handlers = args.slice(1);
  if (route === "/" || route === "/seller") {
    const wrapped = handlers.map(handler => {
      if (typeof handler !== "function") return handler;
      return function (req, res, next) {
        const originalSendFile = res.sendFile.bind(res);
        res.sendFile = function (filePath, options, callback) {
          const done = typeof options === "function" ? options : callback;
          fs.readFile(filePath, "utf8", (error, html) => {
            if (error) {
              if (typeof done === "function") done(error); else next(error);
              return;
            }
            const script = '<script src="/image-upload-ui.js?v=5"></script>';
            const output = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, script + "</body>") : html + script;
            res.type("html").send(output);
          });
        };
        return handler(req, res, next);
      };
    });
    return originalGet.call(this, route, ...wrapped);
  }
  return originalGet.apply(this, args);
};

function installRoutes(app) {
  if (app.__shriviImageRoutesV5) return;
  app.__shriviImageRoutesV5 = true;

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
    } catch (error) {
      console.error("Admin image upload:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Image upload failed" });
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
    } catch (error) {
      console.error("Seller image upload:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Image upload failed" });
    }
  });
}

const originalListen = express.application.listen;
express.application.listen = function (...args) {
  installRoutes(this);
  return originalListen.apply(this, args);
};

require("./server.js");
