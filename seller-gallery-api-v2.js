const express = require('express');
const multer = require('multer');
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 8, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype))
});

const seller = (req, res, next) => req.session?.seller ? next() : res.status(401).json({ error: 'Seller login required' });
const clean = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const salePrice = (p,d) => Math.round((num(p) - num(p) * num(d) / 100) * 100) / 100;

let ready;
function ensureTables() {
  if (!ready) ready = pool.query(`
    CREATE TABLE IF NOT EXISTS product_images(
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);
  `).catch(e => { ready = null; throw e; });
  return ready;
}

function parseProduct(body) {
  const name = clean(body?.name), category = clean(body?.category), description = clean(body?.description);
  const price = Number(body?.price), stock = Number(body?.stock), discount = Number(body?.discount_percent ?? 0);
  if (!name) throw Error('Product name is required.');
  if (!Number.isFinite(price) || price < 0) throw Error('Valid product price is required.');
  if (!Number.isInteger(stock) || stock < 0) throw Error('Stock must be a whole number 0 or greater.');
  if (!Number.isFinite(discount) || discount < 0 || discount > 99.99) throw Error('Discount must be between 0 and 99.99.');
  return { name, category: category || null, description: description || null, price, stock, discount_percent: discount };
}

function imageList(body) {
  let images = Array.isArray(body?.images) ? body.images.map(clean).filter(Boolean).slice(0, 8) : [];
  if (!images.length && clean(body?.image)) images = [clean(body.image)];
  return images;
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return reject(Error('Image service is not configured.'));
    let done = false;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
    const timer = setTimeout(() => finish(Error('Image upload timed out. Please try again.')), 11000);
    try {
      const stream = cloudinary.uploader.upload_stream({ folder: 'shrivi/products', resource_type: 'image' }, (err, result) => {
        if (err) return finish(err);
        if (!result?.secure_url) return finish(Error('Image upload returned no URL.'));
        finish(null, result.secure_url);
      });
      stream.on('error', finish);
      stream.end(file.buffer);
    } catch (e) { finish(e); }
  });
}

function install() {
  const previousListen = express.application.listen;
  express.application.listen = function() {
    const app = this;
    if (!app.__shriviGalleryApiV2) {
      app.__shriviGalleryApiV2 = true;
      const router = express.Router();

      router.post('/api/seller/gallery-upload', seller, (req, res) => upload.array('images', 8)(req, res, async err => {
        try {
          if (err) return res.status(400).json({ error: err.message || 'Invalid image upload.' });
          const files = req.files || [];
          if (!files.length) return res.status(400).json({ error: 'Select at least one image.' });
          const urls = await Promise.all(files.map(uploadOne));
          res.json({ ok: true, images: urls });
        } catch (e) {
          console.error('Shrivi gallery upload v2:', e);
          res.status(500).json({ error: e.message || 'Image upload failed.' });
        }
      }));

      router.post('/api/seller/gallery-products', seller, async (req, res) => {
        const client = await pool.connect();
        try {
          await ensureTables();
          const p = parseProduct(req.body || {}), images = imageList(req.body || {});
          if (!images.length) return res.status(400).json({ error: 'Add at least one product image.' });
          await client.query('BEGIN');
          const r = await client.query(
            'INSERT INTO products(name,price,category,image,description,stock,discount_percent,seller_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [p.name,p.price,p.category,images[0],p.description,p.stock,p.discount_percent,Number(req.session.seller.id)]
          );
          for (let i=0;i<images.length;i++) await client.query(
            'INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',
            [r.rows[0].id,images[i],i,i===0]
          );
          await client.query('COMMIT');
          res.status(201).json({ ok:true, product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(p.price,p.discount_percent)} });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          console.error('Shrivi gallery create v2:', e);
          res.status(400).json({ error:e.message || 'Unable to save product.' });
        } finally { client.release(); }
      });

      router.put('/api/seller/gallery-products/:id', seller, async (req, res) => {
        const client = await pool.connect();
        try {
          await ensureTables();
          const id = Number(req.params.id);
          if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error:'Invalid product ID.' });
          const own = await client.query('SELECT id FROM products WHERE id=$1 AND seller_id=$2',[id,Number(req.session.seller.id)]);
          if (!own.rows.length) return res.status(404).json({ error:'Product not found.' });
          const p = parseProduct(req.body || {}), images = imageList(req.body || {});
          if (!images.length) return res.status(400).json({ error:'Add at least one product image.' });
          await client.query('BEGIN');
          const r = await client.query(
            'UPDATE products SET name=$1,price=$2,category=$3,image=$4,description=$5,stock=$6,discount_percent=$7 WHERE id=$8 AND seller_id=$9 RETURNING *',
            [p.name,p.price,p.category,images[0],p.description,p.stock,p.discount_percent,id,Number(req.session.seller.id)]
          );
          await client.query('DELETE FROM product_images WHERE product_id=$1',[id]);
          for (let i=0;i<images.length;i++) await client.query(
            'INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',
            [id,images[i],i,i===0]
          );
          await client.query('COMMIT');
          res.json({ ok:true, product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(p.price,p.discount_percent)} });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          console.error('Shrivi gallery update v2:', e);
          res.status(400).json({ error:e.message || 'Unable to update product.' });
        } finally { client.release(); }
      });

      app.use(router);
      const stack = app.router?.stack || app._router?.stack;
      if (stack?.length) stack.unshift(stack.pop());
      ensureTables().catch(e => console.error('Shrivi gallery table v2:', e));
    }
    return previousListen.apply(this, arguments);
  };
}
install();
