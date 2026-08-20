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
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 8, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP and GIF images are allowed.'));
    cb(null, true);
  }
});

function clean(v){ return String(v ?? '').trim(); }
function seller(req,res,next){
  if(!req.session?.seller) return res.status(401).json({error:'Seller login required'});
  next();
}
function moneyNumber(v){ const n=Number(v); return Number.isFinite(n) ? n : 0; }
function salePrice(price,discount){
  return Math.round((moneyNumber(price) - moneyNumber(price)*moneyNumber(discount)/100)*100)/100;
}
function uploadOne(file){
  return new Promise((resolve,reject)=>{
    const stream=cloudinary.uploader.upload_stream({folder:'shrivi/products'},(err,result)=>{
      if(err) return reject(err);
      resolve(result.secure_url || result.url);
    });
    stream.end(file.buffer);
  });
}
async function ensureTables(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id,sort_order);
  `);
}
async function gallery(productId, fallbackImage){
  const r=await pool.query('SELECT image_url,sort_order,is_primary FROM product_images WHERE product_id=$1 ORDER BY is_primary DESC,sort_order ASC,id ASC',[productId]);
  const urls=r.rows.map(x=>x.image_url).filter(Boolean);
  if(!urls.length && fallbackImage) return [fallbackImage];
  return urls;
}
async function replaceGallery(productId, urls){
  await pool.query('DELETE FROM product_images WHERE product_id=$1',[productId]);
  for(let i=0;i<urls.length;i++){
    await pool.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',[productId,urls[i],i,i===0]);
  }
}
function productPayload(b){
  const name=clean(b.name), category=clean(b.category), description=clean(b.description);
  const price=moneyNumber(b.price), stock=Number(b.stock), discount=moneyNumber(b.discount_percent);
  if(!name) throw new Error('Product name is required');
  if(name.length>250) throw new Error('Product name is too long');
  if(price<0 || price>100000000) throw new Error('Valid product price is required');
  if(!Number.isInteger(stock) || stock<0) throw new Error('Stock must be a whole number 0 or greater');
  if(discount<0 || discount>99.99) throw new Error('Discount must be between 0 and 99.99');
  return {name,category:category||null,description:description||null,price,stock,discount_percent:discount};
}
async function install(app){
  if(app.__shriviSellerImages) return;
  app.__shriviSellerImages=true;
  await ensureTables();

  app.post('/api/seller/upload/images',seller,(req,res,next)=>{
    upload.array('images',8)(req,res,async err=>{
      if(err) return res.status(400).json({error:err.message});
      try{
        const files=req.files||[];
        if(!files.length) return res.status(400).json({error:'Select at least one product image.'});
        if(files.length>8) return res.status(400).json({error:'Maximum 8 images allowed per product.'});
        if(!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET){
          return res.status(500).json({error:'Image service is not configured. Please contact Shrivi support.'});
        }
        const urls=await Promise.all(files.map(uploadOne));
        res.json({ok:true,images:urls});
      }catch(e){res.status(500).json({error:e?.message||'Image upload failed'});}
    });
  });

  app.get('/api/seller/products',seller,async(req,res)=>{
    try{
      const r=await pool.query(`SELECT p.*,s.name AS seller_name FROM products p LEFT JOIN sellers s ON s.id=p.seller_id WHERE p.seller_id=$1 ORDER BY p.id DESC`,[Number(req.session.seller.id)]);
      const out=[];
      for(const p of r.rows){
        const images=await gallery(p.id,p.image);
        out.push({...p,price:moneyNumber(p.price),original_price:moneyNumber(p.price),discount_percent:moneyNumber(p.discount_percent),sale_price:salePrice(p.price,p.discount_percent),stock:Math.max(0,Number(p.stock)||0),images,image_gallery:images});
      }
      res.json(out);
    }catch(e){res.status(500).json({error:e?.message||'Unable to load products'});}
  });

  app.post('/api/seller/products',seller,async(req,res)=>{
    const client=await pool.connect();
    try{
      const p=productPayload(req.body||{});
      let images=Array.isArray(req.body?.images)?req.body.images.map(clean).filter(Boolean).slice(0,8):[];
      const legacy=clean(req.body?.image);
      if(!images.length && legacy) images=[legacy];
      if(!images.length) return res.status(400).json({error:'Add at least one product image.'});
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO products(name,price,category,image,description,stock,discount_percent,seller_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[p.name,p.price,p.category,images[0],p.description,p.stock,p.discount_percent,Number(req.session.seller.id)]);
      const product=r.rows[0];
      await client.query('DELETE FROM product_images WHERE product_id=$1',[product.id]);
      for(let i=0;i<images.length;i++) await client.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',[product.id,images[i],i,i===0]);
      await client.query('COMMIT');
      res.status(201).json({ok:true,product:{...product,images,image_gallery:images,sale_price:salePrice(product.price,product.discount_percent)}});
    }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e?.message||'Unable to create product'});}finally{client.release();}
  });

  app.put('/api/seller/products/:id',seller,async(req,res)=>{
    const client=await pool.connect();
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<1) return res.status(400).json({error:'Invalid product ID'});
      const own=await client.query('SELECT id,image FROM products WHERE id=$1 AND seller_id=$2',[id,Number(req.session.seller.id)]);
      if(!own.rows.length) return res.status(404).json({error:'Product not found'});
      const p=productPayload(req.body||{});
      let images=Array.isArray(req.body?.images)?req.body.images.map(clean).filter(Boolean).slice(0,8):[];
      const legacy=clean(req.body?.image);
      if(!images.length && legacy) images=[legacy];
      if(!images.length){ images=await gallery(id,own.rows[0].image); }
      if(!images.length) return res.status(400).json({error:'Add at least one product image.'});
      await client.query('BEGIN');
      const r=await client.query(`UPDATE products SET name=$1,price=$2,category=$3,image=$4,description=$5,stock=$6,discount_percent=$7 WHERE id=$8 AND seller_id=$9 RETURNING *`,[p.name,p.price,p.category,images[0],p.description,p.stock,p.discount_percent,id,Number(req.session.seller.id)]);
      await client.query('DELETE FROM product_images WHERE product_id=$1',[id]);
      for(let i=0;i<images.length;i++) await client.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',[id,images[i],i,i===0]);
      await client.query('COMMIT');
      res.json({ok:true,product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(r.rows[0].price,r.rows[0].discount_percent)}});
    }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e?.message||'Unable to update product'});}finally{client.release();}
  });

  app.get('/api/seller/products/:id/images',seller,async(req,res)=>{
    try{
      const id=Number(req.params.id);
      const own=await pool.query('SELECT id,image FROM products WHERE id=$1 AND seller_id=$2',[id,Number(req.session.seller.id)]);
      if(!own.rows.length)return res.status(404).json({error:'Product not found'});
      res.json({ok:true,images:await gallery(id,own.rows[0].image)});
    }catch(e){res.status(500).json({error:e?.message||'Unable to load images'});}
  });

  const router=app.router||app._router;
  if(router?.stack){
    const newLayers=[];
    const paths=new Set(['/api/seller/products','/api/seller/products/:id','/api/seller/upload/image']);
    for(let i=router.stack.length-1;i>=0;i--){
      const layer=router.stack[i];
      const path=layer?.route?.path;
      if(paths.has(path)) router.stack.splice(i,1);
    }
    const target=router.stack.findIndex(l=>String(l?.handle||'').includes('API endpoint not found'));
    // Re-registering above places the routes at the end; move all seller image/product routes before the API 404.
    const start=Math.max(0,(target<0?router.stack.length:target)-8);
    const tail=router.stack.splice(start);
    router.stack.push(...tail);
  }
}

const originalListen=express.application.listen;
express.application.listen=function(){
  const app=this;
  install(app).catch(e=>console.error('SHRIVI SELLER IMAGE UPGRADE:',e));
  return originalListen.apply(this,arguments);
};
