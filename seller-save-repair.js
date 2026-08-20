/* SHRIVI SELLER SAVE REPAIR
   The current Seller Center sends multiple photos to
   POST /api/seller/upload/images with field name "images".
   Keep the existing singular endpoint untouched and add the
   missing plural endpoint for 1-8 photos.
*/
const express = require("express");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");

const originalListen = express.application.listen;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 8
  },
  fileFilter(req, file, cb) {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, WEBP and GIF images are allowed."));
    }
    cb(null, true);
  }
});

function configured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "shrivi/products",
        resource_type: "image"
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result || !result.secure_url) {
          return reject(new Error("Cloudinary returned no image URL."));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(file.buffer);
  });
}

if (!express.application.__shriviSellerSaveRepairV1) {
  express.application.__shriviSellerSaveRepairV1 = true;

  express.application.listen = function (...args) {
    const app = this;

    if (!app.__shriviSellerMultiUploadRouteV1) {
      app.__shriviSellerMultiUploadRouteV1 = true;

      app.post(
        "/api/seller/upload/images",
        upload.array("images", 8),
        async (req, res) => {
          try {
            const sellerId = Number(req.session?.seller?.id);
            if (!Number.isInteger(sellerId) || sellerId <= 0) {
              return res.status(401).json({
                ok: false,
                error: "Seller login required"
              });
            }

            if (!configured()) {
              return res.status(503).json({
                ok: false,
                error: "Cloudinary is not configured."
              });
            }

            const files = Array.isArray(req.files) ? req.files : [];
            if (!files.length) {
              return res.status(400).json({
                ok: false,
                error: "Please select at least one image."
              });
            }

            if (files.length > 8) {
              return res.status(400).json({
                ok: false,
                error: "Maximum 8 photos allowed."
              });
            }

            cloudinary.config({
              cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
              api_key: process.env.CLOUDINARY_API_KEY,
              api_secret: process.env.CLOUDINARY_API_SECRET,
              secure: true
            });

            const images = await Promise.all(files.map(uploadOne));

            return res.json({
              ok: true,
              success: true,
              images,
              urls: images
            });
          } catch (error) {
            console.error("SHRIVI multi-image upload error:", error);
            return res.status(500).json({
              ok: false,
              success: false,
              error: error?.message || "Image upload failed"
            });
          }
        }
      );
    }

    return originalListen.apply(app, args);
  };
}
