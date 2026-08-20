const { Pool } = require('pg');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const express = require('express');

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 8, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype))
});

const clean = value => String(value ?? '').trim();
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const seller = (req, res, next) => req.session?.seller ? next() : res.status(401).json({ error: 'Seller login required' });
const salePrice = (price, discount) => Math.round((num(price) - num(price) * num(discount) / 100) * 100) / 100;

let tableReady;
function ensureTables() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id BIGSERIAL PRIMARY KEY,
        product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);
    `).catch(error => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return reject(new Error('Cloudinary is not configured.'));
    }
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Image upload timed out. Please try again.')), 12000);
    try {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'shrivi/products', resource_type: 'image' },
        (error, result) => {
          if (error) return finish(error);
          if (!result?.secure_url) return finish(new Error('Cloudinary returned no image URL'));
          finish(null, result.secure_url);
        }
      );
      stream.on('error', finish);
      stream.end(file.buffer);
    } catch (error) {
      finish(error);
    }
  });
}

async function gallery(client, id, fallback) {
  const result = await client.query(
    'SELECT image_url FROM product_images WHERE product_id=$1 ORDER BY is_primary DESC, sort_order ASC, id ASC',
    [id]
  );
  const images = result.rows.map(row => row.image_url).filter(Boolean);
  return images.length ? images : (fallback ? [fallback] : []);
}

function payload(body) {
  const name = clean(body?.name);
  const category = clean(body?.category);
  const description = clean(body?.description);
  const price = num(body?.price);
  const stock = Number(body?.stock);
  const discount = num(body?.discount_percent);
  if (!name) throw Error('Product name is required');
  if (price < 0 || price > 100000000) throw Error('Valid product price is required');
  if (!Number.isInteger(stock) || stock < 0) throw Error('Stock must be a whole number 0 or greater');
  if (discount < 0 || discount > 99.99) throw Error('Discount must be between 0 and 99.99');
  return { name, category: category || null, description: description || null, price, stock, discount_percent: discount };
}

function getImages(body) {
  let images = Array.isArray(body?.images) ? body.images.map(clean).filter(Boolean).slice(0, 8) : [];
  if (!images.length && clean(body?.image)) images = [clean(body.image)];
  return images;
}

function moveGalleryRoutesFirst(app) {
  const router = app.router || app._router;
  if (!router?.stack) return;
  const wanted = new Set([
    '/api/seller/upload/image',
    '/api/seller/upload/images',
    '/api/seller/products',
    '/api/seller/products/:id'
  ]);
  const picked = [];
  for (let i = router.stack.length - 1; i >= 0; i--) {
    const layer = router.stack[i];
    if (wanted.has(layer?.route?.path)) picked.unshift(router.stack.splice(i, 1)[0]);
  }
  if (!picked.length) return;
  const legacyIndex = router.stack.findIndex(layer => {
    const text = String(layer?.handle || '') + String(layer?.handle?.toString?.() || '');
    return text.includes('API endpoint not found');
  });
  const at = legacyIndex < 0 ? 0 : legacyIndex;
  router.stack.splice(at, 0, ...picked);
}

async function install(app) {
  if (app.__shriviSellerImages) return;
  app.__shriviSellerImages = true;

  // Register immediately, then move these routes ahead of the legacy routes.
  // This removes the startup/order race that caused Save Product to hang.
  app.post('/api/seller/upload/image', seller, (req, res) => {
    upload.single('image')(req, res, async error => {
      try {
        if (error) return res.status(400).json({ error: error.message || 'Invalid image' });
        if (!req.file) return res.status(400).json({ error: 'Image file is required' });
        const url = await uploadOne(req.file);
        res.json({ ok: true, image: url, url, secure_url: url, imageUrl: url });
      } catch (e) {
        console.error('Seller image upload:', e);
        res.status(500).json({ error: e.message || 'Image upload failed' });
      }
    });
  });

  app.post('/api/seller/upload/images', seller, (req, res) => {
    upload.array('images', 8)(req, res, async error => {
      try {
        if (error) return res.status(400).json({ error: error.message || 'Invalid images' });
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: 'Select at least one image' });
        const urls = await Promise.all(files.map(uploadOne));
        res.json({ ok: true, images: urls });
      } catch (e) {
        console.error('Seller gallery upload:', e);
        res.status(500).json({ error: e.message || 'Image upload failed' });
      }
    });
  });

  app.get('/api/seller/products', seller, async (req, res) => {
    try {
      await ensureTables();
      const result = await pool.query(
        'SELECT p.*, s.name AS seller_name FROM products p LEFT JOIN sellers s ON s.id=p.seller_id WHERE p.seller_id=$1 ORDER BY p.id DESC',
        [Number(req.session.seller.id)]
      );
      const out = [];
      for (const product of result.rows) {
        const images = await gallery(pool, product.id, product.image);
        out.push({ ...product, price: num(product.price), original_price: num(product.price), discount_percent: num(product.discount_percent), sale_price: salePrice(product.price, product.discount_percent), stock: Math.max(0, Number(product.stock) || 0), images, image_gallery: images });
      }
      res.json(out);
    } catch (e) {
      console.error('Seller products load:', e);
      res.status(500).json({ error: e.message || 'Unable to load products' });
    }
  });

  app.post('/api/seller/products', seller, async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureTables();
      const product = payload(req.body || {});
      const images = getImages(req.body || {});
      if (!images.length) return res.status(400).json({ error: 'Add at least one product image.' });
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO products(name,price,category,image,description,stock,discount_percent,seller_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [product.name, product.price, product.category, images[0], product.description, product.stock, product.discount_percent, Number(req.session.seller.id)]
      );
      const productId = result.rows[0].id;
      for (let i = 0; i < images.length; i++) {
        await client.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)', [productId, images[i], i, i === 0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ ok: true, product: { ...result.rows[0], images, image_gallery: images, sale_price: salePrice(product.price, product.discount_percent) } });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      console.error('Seller product create:', e);
      res.status(400).json({ error: e.message || 'Unable to create product' });
    } finally { client.release(); }
  });

  app.put('/api/seller/products/:id', seller, async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureTables();
      const id = Number(req.params.id);
      const owner = await client.query('SELECT id,image FROM products WHERE id=$1 AND seller_id=$2', [id, Number(req.session.seller.id)]);
      if (!owner.rows.length) return res.status(404).json({ error: 'Product not found' });
      const product = payload(req.body || {});
      let images = getImages(req.body || {});
      if (!images.length) images = await gallery(client, id, owner.rows[0].image);
      if (!images.length) return res.status(400).json({ error: 'Add at least one product image.' });
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE products SET name=$1,price=$2,category=$3,image=$4,description=$5,stock=$6,discount_percent=$7 WHERE id=$8 AND seller_id=$9 RETURNING *`,
        [product.name, product.price, product.category, images[0], product.description, product.stock, product.discount_percent, id, Number(req.session.seller.id)]
      );
      await client.query('DELETE FROM product_images WHERE product_id=$1', [id]);
      for (let i = 0; i < images.length; i++) {
        await client.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)', [id, images[i], i, i === 0]);
      }
      await client.query('COMMIT');
      res.json({ ok: true, product: { ...result.rows[0], images, image_gallery: images, sale_price: salePrice(product.price, product.discount_percent) } });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      console.error('Seller product update:', e);
      res.status(400).json({ error: e.message || 'Unable to update product' });
    } finally { client.release(); }
  });

  moveGalleryRoutesFirst(app);
  ensureTables().catch(error => console.error('SHRIVI gallery table:', error));
}

const oldListen = express.application.listen;
express.application.listen = function () {
  const app = this;
  install(app).catch(error => console.error('SHRIVI SELLER IMAGE UPGRADE:', error));
  return oldListen.apply(this, arguments);
};
