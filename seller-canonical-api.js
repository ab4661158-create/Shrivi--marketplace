const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { v2: cloudinary } = require('cloudinary');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
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

const clean = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const salePrice = (p, d) => Math.round((num(p) - num(p) * num(d) / 100) * 100) / 100;
const sellerOnly = (req, res, next) => req.session?.seller ? next() : res.status(401).json({ error: 'Seller login required' });

let tablePromise;
function ensureGalleryTable() {
  if (!tablePromise) {
    tablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id BIGSERIAL PRIMARY KEY,
        product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);
    `).catch(e => { tablePromise = null; throw e; });
  }
  return tablePromise;
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const x = JSON.parse(value); return Array.isArray(x) ? x : []; } catch { return []; } }
  return [];
}

function validateProduct(body) {
  const name = clean(body?.name);
  const price = Number(body?.price);
  const stock = Number(body?.stock);
  const discount = body?.discount_percent === '' || body?.discount_percent == null ? 0 : Number(body.discount_percent);
  if (!name) throw new Error('Product name is required');
  if (!Number.isFinite(price) || price < 0) throw new Error('Valid product price is required');
  if (!Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a whole number 0 or greater');
  if (!Number.isFinite(discount) || discount < 0 || discount > 99.99) throw new Error('Discount must be between 0 and 99.99');
  return { name, price, stock, discount, category: clean(body?.category) || null, description: clean(body?.description) || null };
}

function requestedImages(body) {
  const images = Array.isArray(body?.images) ? body.images.map(clean).filter(Boolean).slice(0, 8) : [];
  if (images.length) return images;
  const image = clean(body?.image);
  return image ? [image] : [];
}

async function gallery(productId, fallback) {
  await ensureGalleryTable();
  const r = await pool.query('SELECT image_url FROM product_images WHERE product_id=$1 ORDER BY is_primary DESC, sort_order ASC, id ASC', [productId]);
  const images = r.rows.map(x => x.image_url).filter(Boolean);
  return images.length ? images : (fallback ? [fallback] : []);
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return reject(new Error('Cloudinary is not configured.'));
    let settled = false;
    const finish = (e, v) => { if (settled) return; settled = true; clearTimeout(timer); e ? reject(e) : resolve(v); };
    const timer = setTimeout(() => finish(new Error('Image upload timed out. Please try again.')), 15000);
    try {
      const stream = cloudinary.uploader.upload_stream({ folder: 'shrivi/products', resource_type: 'image' }, (e, result) => {
        if (e) return finish(e);
        if (!result?.secure_url) return finish(new Error('Cloudinary returned no image URL'));
        finish(null, result.secure_url);
      });
      stream.on('error', finish);
      stream.end(file.buffer);
    } catch (e) { finish(e); }
  });
}

function moveRoutesFirst(app) {
  const router = app.router || app._router;
  if (!router?.stack) return;
  const wanted = new Set([
    '/api/seller/dashboard', '/api/seller/orders', '/api/seller/orders/:id/status',
    '/api/seller/products', '/api/seller/products/:id',
    '/api/seller/upload/image', '/api/seller/upload/images'
  ]);
  const picked = [];
  for (let i = router.stack.length - 1; i >= 0; i--) {
    const layer = router.stack[i];
    if (wanted.has(layer?.route?.path)) picked.unshift(router.stack.splice(i, 1)[0]);
  }
  if (picked.length) router.stack.unshift(...picked);
}

async function install(app) {
  if (app.__shriviCanonicalSellerApi) return;
  app.__shriviCanonicalSellerApi = true;

  app.get('/api/seller/dashboard', sellerOnly, async (req, res) => {
    try {
      const sellerId = Number(req.session.seller.id);
      const p = await pool.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(stock),0)::int AS stock FROM products WHERE seller_id=$1', [sellerId]);
      const o = await pool.query('SELECT items,status FROM orders ORDER BY id DESC');
      let orders = 0, revenue = 0;
      for (const row of o.rows) {
        const items = parseItems(row.items).filter(x => Number(x?.seller_id) === sellerId);
        if (!items.length) continue;
        orders++;
        revenue += items.reduce((s, x) => s + num(x.item_total), 0);
      }
      res.json({ products: Number(p.rows[0]?.count || 0), stock: Number(p.rows[0]?.stock || 0), orders, revenue: Math.round(revenue * 100) / 100 });
    } catch (e) { console.error('Canonical seller dashboard:', e); res.status(500).json({ error: e.message || 'Unable to load seller dashboard' }); }
  });

  app.get('/api/seller/products', sellerOnly, async (req, res) => {
    try {
      const sellerId = Number(req.session.seller.id);
      const result = await pool.query('SELECT p.*, s.name AS seller_name FROM products p LEFT JOIN sellers s ON s.id=p.seller_id WHERE p.seller_id=$1 ORDER BY p.id DESC', [sellerId]);
      const out = [];
      for (const p of result.rows) {
        const images = await gallery(p.id, p.image);
        out.push({ ...p, id: Number(p.id), price: num(p.price), original_price: num(p.price), discount_percent: num(p.discount_percent), sale_price: salePrice(p.price, p.discount_percent), stock: Math.max(0, Number(p.stock) || 0), images, image_gallery: images });
      }
      res.json(out);
    } catch (e) { console.error('Canonical seller products:', e); res.status(500).json({ error: e.message || 'Unable to load products' }); }
  });

  app.post('/api/seller/upload/images', sellerOnly, (req, res) => upload.array('images', 8)(req, res, async e => {
    try {
      if (e) return res.status(400).json({ error: e.message || 'Invalid images' });
      if (!req.files?.length) return res.status(400).json({ error: 'Select at least one image' });
      const images = await Promise.all(req.files.map(uploadOne));
      res.json({ ok: true, images });
    } catch (x) { console.error('Canonical seller gallery upload:', x); res.status(500).json({ error: x.message || 'Image upload failed' }); }
  }));

  app.post('/api/seller/upload/image', sellerOnly, (req, res) => upload.single('image')(req, res, async e => {
    try {
      if (e) return res.status(400).json({ error: e.message || 'Invalid image' });
      if (!req.file) return res.status(400).json({ error: 'Image file is required' });
      const url = await uploadOne(req.file);
      res.json({ ok: true, image: url, url, secure_url: url, imageUrl: url });
    } catch (x) { console.error('Canonical seller image upload:', x); res.status(500).json({ error: x.message || 'Image upload failed' }); }
  }));

  app.post('/api/seller/products', sellerOnly, async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureGalleryTable();
      const p = validateProduct(req.body || {});
      const images = requestedImages(req.body || {});
      if (!images.length) return res.status(400).json({ error: 'Add at least one product image.' });
      await client.query('BEGIN');
      const r = await client.query('INSERT INTO products(name,price,category,image,description,stock,discount_percent,seller_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [p.name,p.price,p.category,images[0],p.description,p.stock,p.discount,Number(req.session.seller.id)]);
      for (let i=0;i<images.length;i++) await client.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)', [r.rows[0].id,images[i],i,i===0]);
      await client.query('COMMIT');
      res.status(201).json({ ok:true, product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(p.price,p.discount)} });
    } catch(e) { try { await client.query('ROLLBACK'); } catch {} console.error('Canonical seller create:',e); res.status(400).json({error:e.message||'Unable to create product'}); } finally { client.release(); }
  });

  app.put('/api/seller/products/:id', sellerOnly, async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureGalleryTable();
      const id = Number(req.params.id), sellerId = Number(req.session.seller.id);
      const owner = await client.query('SELECT id,image FROM products WHERE id=$1 AND seller_id=$2', [id,sellerId]);
      if (!owner.rows.length) return res.status(404).json({error:'Product not found'});
      const p = validateProduct(req.body || {});
      let images = requestedImages(req.body || {});
      if (!images.length) images = await gallery(id, owner.rows[0].image);
      if (!images.length) return res.status(400).json({error:'Add at least one product image.'});
      await client.query('BEGIN');
      const r = await client.query('UPDATE products SET name=$1,price=$2,category=$3,image=$4,description=$5,stock=$6,discount_percent=$7 WHERE id=$8 AND seller_id=$9 RETURNING *', [p.name,p.price,p.category,images[0],p.description,p.stock,p.discount,id,sellerId]);
      await client.query('DELETE FROM product_images WHERE product_id=$1',[id]);
      for (let i=0;i<images.length;i++) await client.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',[id,images[i],i,i===0]);
      await client.query('COMMIT');
      res.json({ok:true,product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(p.price,p.discount)}});
    } catch(e) { try { await client.query('ROLLBACK'); } catch {} console.error('Canonical seller update:',e); res.status(400).json({error:e.message||'Unable to update product'}); } finally { client.release(); }
  });

  app.delete('/api/seller/products/:id', sellerOnly, async (req,res) => {
    try {
      const id=Number(req.params.id), sellerId=Number(req.session.seller.id);
      const r=await pool.query('DELETE FROM products WHERE id=$1 AND seller_id=$2 RETURNING id',[id,sellerId]);
      if(!r.rows.length) return res.status(404).json({error:'Product not found'});
      res.json({ok:true,id});
    } catch(e) { console.error('Canonical seller delete:',e); res.status(500).json({error:e.message||'Unable to delete product'}); }
  });

  app.get('/api/seller/orders', sellerOnly, async (req,res) => {
    try {
      const sellerId=Number(req.session.seller.id);
      const result=await pool.query('SELECT id,customer_name,customer_phone,customer_address,items,total,status,created_at FROM orders ORDER BY id DESC');
      const out=[];
      for(const row of result.rows){
        const items=parseItems(row.items).filter(x=>Number(x?.seller_id)===sellerId);
        if(!items.length) continue;
        out.push({id:Number(row.id),customer_name:row.customer_name||'',customer_phone:row.customer_phone||'',customer_address:row.customer_address||'',items,total:num(row.total),seller_total:Math.round(items.reduce((s,x)=>s+num(x.item_total),0)*100)/100,status:row.status||'pending',created_at:row.created_at});
      }
      res.json(out);
    } catch(e) { console.error('Canonical seller orders:',e); res.status(500).json({error:e.message||'Unable to load seller orders'}); }
  });

  app.put('/api/seller/orders/:id/status', sellerOnly, async (req,res) => {
    try {
      const id=Number(req.params.id), sellerId=Number(req.session.seller.id), status=clean(req.body?.status).toLowerCase();
      if(!Number.isInteger(id)||id<=0) return res.status(400).json({error:'Invalid order ID'});
      if(!['confirmed','shipped','delivered','cancelled'].includes(status)) return res.status(400).json({error:'Invalid order status'});
      const r=await pool.query(`UPDATE orders SET status=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) item WHERE (item->>'seller_id')::bigint=$3) RETURNING id,status`,[status,id,sellerId]);
      if(!r.rows.length) return res.status(404).json({error:'Order not found for this seller'});
      res.json({ok:true,order:r.rows[0]});
    } catch(e) { console.error('Canonical seller order status:',e); res.status(500).json({error:e.message||'Unable to update order status'}); }
  });

  moveRoutesFirst(app);
  ensureGalleryTable().catch(e=>console.error('Canonical gallery table:',e));
  console.log('SHRIVI CANONICAL SELLER API READY');
}

const oldListen = express.application.listen;
express.application.listen = function(){ install(this).catch(e=>console.error('Canonical Seller API:',e)); return oldListen.apply(this,arguments); };
