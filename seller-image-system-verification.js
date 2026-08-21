/* SHRIVI SELLER IMAGE SYSTEM
   Single-source verification + repair guard for the canonical seller image flow.
   This does not replace the existing marketplace server; it verifies the pieces
   that must agree: Cloudinary configuration, product.image and product_images.
*/
const express = require('express');
const { Pool } = require('pg');
const { v2: cloudinary } = require('cloudinary');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

async function ensure() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product
      ON product_images(product_id, sort_order);
  `);
}

function configured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

async function verifySellerImageSystem() {
  const report = {
    ok: true,
    cloudinary: configured(),
    database: false,
    gallery_table: false,
    products_checked: 0,
    products_with_images: 0,
    products_repaired: 0,
    errors: []
  };

  try {
    await pool.query('SELECT 1');
    report.database = true;
    await ensure();
    report.gallery_table = true;

    const result = await pool.query(`
      SELECT p.id, p.image,
        COALESCE(array_agg(pi.image_url ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.id ASC)
          FILTER (WHERE pi.image_url IS NOT NULL), ARRAY[]::text[]) AS gallery
      FROM products p
      WHERE p.seller_id IS NOT NULL
      GROUP BY p.id
      ORDER BY p.id DESC
    `);

    report.products_checked = result.rowCount;
    for (const row of result.rows) {
      let gallery = row.gallery || [];
      if (!gallery.length && row.image) {
        await pool.query(
          `INSERT INTO product_images(product_id,image_url,sort_order,is_primary)
           VALUES($1,$2,0,true)`,
          [row.id, row.image]
        );
        gallery = [row.image];
        report.products_repaired++;
      }
      if (gallery.length) report.products_with_images++;
    }

    if (!report.cloudinary) report.errors.push('Cloudinary environment variables are missing.');
    report.ok = report.database && report.gallery_table && report.errors.length === 0;
  } catch (error) {
    report.ok = false;
    report.errors.push(error.message || 'Verification failed.');
  }

  return report;
}

async function install(app) {
  if (app.__shriviSellerImageVerification) return;
  app.__shriviSellerImageVerification = true;

  app.get('/api/seller/image-system-health', async (req, res) => {
    try {
      const report = await verifySellerImageSystem();
      res.status(report.ok ? 200 : 503).json(report);
    } catch (error) {
      res.status(503).json({ ok: false, errors: [error.message || 'Verification failed.'] });
    }
  });

  try {
    const report = await verifySellerImageSystem();
    console.log('[Shrivi] Seller image system verification:', JSON.stringify(report));
  } catch (error) {
    console.error('[Shrivi] Seller image verification startup failed:', error);
  }
}

const oldListen = express.application.listen;
express.application.listen = function () {
  install(this).catch(error => console.error('[Shrivi] image verification install:', error));
  return oldListen.apply(this, arguments);
};
