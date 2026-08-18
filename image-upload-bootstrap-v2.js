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

// The existing server already serves the working Admin/Seller HTML.
// Inject the upload UI at response level so it works whether a page is
// delivered with res.sendFile(), express.static(), or res.send().
const originalSend = express.response.send;
express.response.send = function(body) {
  try {
    const req = this.req;
    const isHtmlPage = req && (req.path === "/" || req.path === "/seller" || req.path === "/admin");
    if (isHtmlPage && typeof body === "string" && /<\/body>/i.test(body) && !body.includes("/image-upload-ui.js")) {
      body = body.replace(/<\/body>/i, '<script src="/image-upload-ui.js?v=200"></script></body>');
      this.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  } catch (e) {
    console.error("Shrivi image UI injection warning:", e.message);
  }
  return originalSend.call(this, body);
};

// sendFile ultimately uses response.send in Express, but this fallback also
// handles Buffer/string HTML responses explicitly.
const originalSendFile = express.response.sendFile;
express.response.sendFile = function(filePath, options, callback) {
  const res = this;
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(options && options.root ? options.root : process.cwd(), filePath);
  fs.readFile(absolute, "utf8", (err, html) => {
    if (err) {
      if (typeof options === "function") return options(err);
      if (typeof callback === "function") return callback(err);
      return res.status(500).send("Failed to load page");
    }
    if (/<html[\s>]/i.test(html) && !html.includes("/image-upload-ui.js")) {
      html = html.replace(/<\/body>/i, '<script src="/image-upload-ui.js?v=200"></script></body>');
    }
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.type("html").send(html);
  });
};

const originalListen = express.application.listen;
express.application.listen = function(...args) {
  const app = this;
  if (!app.__shriviImageUploadRoutes) {
    app.__shriviImageUploadRoutes = true;

    const adminCheck = (req) => !!(req.session?.admin || req.session?.isAdmin || req.session?.adminUser || req.session?.user?.isAdmin);
    const sellerIdFromSession = (req) => Number(req.session?.seller?.id || req.session?.sellerId || req.session?.seller_id || 0);

    app.post("/api/admin/products/:id/image", upload.single("image"), async (req, res) => {
      try {
        if (!adminCheck(req)) return res.status(401).json({ error: "Admin login required" });
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid product id" });
        if (!req.file) return res.status(400).json({ error: "Image file is required" });
        const exists = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [id]);
        if (!exists.rows.length) return res.status(404).json({ error: "Product not found" });
        const url = await uploadToCloudinary(req.file, id);
        const result = await pool.query("UPDATE products SET image=$1 WHERE id=$2 RETURNING id,image", [url, id]);
        res.json({ ok: true, url, product: result.rows[0] });
      } catch (e) {
        console.error("Admin image upload:", e);
        res.status(500).json({ error: e.message || "Image upload failed" });
      }
    });

    app.post("/api/seller/products/:id/image", upload.single("image"), async (req, res) => {
      try {
        const sellerId = sellerIdFromSession(req);
        if (!sellerId) return res.status(401).json({ error: "Seller login required" });
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid product id" });
        if (!req.file) return res.status(400).json({ error: "Image file is required" });
        const exists = await pool.query("SELECT id FROM products WHERE id=$1 AND seller_id=$2 LIMIT 1", [id, sellerId]);
        if (!exists.rows.length) return res.status(404).json({ error: "Seller product not found" });
        const url = await uploadToCloudinary(req.file, id);
        const result = await pool.query("UPDATE products SET image=$1 WHERE id=$2 AND seller_id=$3 RETURNING id,image", [url, id, sellerId]);
        res.json({ ok: true, url, product: result.rows[0] });
      } catch (e) {
        console.error("Seller image upload:", e);
        res.status(500).json({ error: e.message || "Image upload failed" });
      }
    });
  }
  return originalListen.apply(this, args);
};

require("./server.js");
