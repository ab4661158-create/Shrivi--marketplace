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

const clean = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const seller = (req,res,next) => req.session?.seller ? next() : res.status(401).json({error:'Seller login required'});
const salePrice = (p,d) => Math.round((num(p)-num(p)*num(d)/100)*100)/100;

let tableReady;
function ensureTables(){
  if(!tableReady){
    tableReady=pool.query(`CREATE TABLE IF NOT EXISTS product_images(id BIGSERIAL PRIMARY KEY,product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,image_url TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,is_primary BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id,sort_order);`).catch(e=>{tableReady=null;throw e});
  }
  return tableReady;
}

function uploadOne(file){
  return new Promise((resolve,reject)=>{
    if(!process.env.CLOUDINARY_CLOUD_NAME||!process.env.CLOUDINARY_API_KEY||!process.env.CLOUDINARY_API_SECRET)return reject(new Error('Cloudinary is not configured.'));
    let done=false;
    const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(v)};
    const timer=setTimeout(()=>finish(new Error('Image upload timed out. Please try again.')),11000);
    try{
      const stream=cloudinary.uploader.upload_stream({folder:'shrivi/products',resource_type:'image'},(e,r)=>{
        if(e)return finish(e);
        if(!r?.secure_url)return finish(new Error('Image upload returned no URL.'));
        finish(null,r.secure_url);
      });
      stream.on('error',e=>finish(e));
      stream.end(file.buffer);
    }catch(e){finish(e)}
  });
}

function payload(b){
  const name=clean(b?.name),category=clean(b?.category),description=clean(b?.description),price=num(b?.price),stock=Number(b?.stock),discount=num(b?.discount_percent);
  if(!name)throw Error('Product name is required');
  if(price<0||price>100000000)throw Error('Valid product price is required');
  if(!Number.isInteger(stock)||stock<0)throw Error('Stock must be a whole number 0 or greater');
  if(discount<0||discount>99.99)throw Error('Discount must be between 0 and 99.99');
  return{name,category:category||null,description:description||null,price,stock,discount_percent:discount};
}
function getImages(b){
  let a=Array.isArray(b?.images)?b.images.map(clean).filter(Boolean).slice(0,8):[];
  if(!a.length&&clean(b?.image))a=[clean(b.image)];
  return a;
}
async function gallery(client,id,fallback){
  const r=await client.query('SELECT image_url FROM product_images WHERE product_id=$1 ORDER BY is_primary DESC,sort_order ASC,id ASC',[id]);
  const a=r.rows.map(x=>x.image_url).filter(Boolean);
  return a.length?a:(fallback?[fallback]:[]);
}

function install(){
  const previous=express.application.listen;
  express.application.listen=function(){
    const app=this;
    if(!app.__shriviRuntimeGallery){
      app.__shriviRuntimeGallery=true;
      const router=express.Router();
      router.post('/api/seller/upload/image',seller,(req,res)=>upload.single('image')(req,res,async e=>{try{if(e)return res.status(400).json({error:e.message||'Invalid image'});if(!req.file)return res.status(400).json({error:'Image file is required'});const url=await uploadOne(req.file);res.json({ok:true,image:url,url,secure_url:url,imageUrl:url})}catch(x){console.error('Runtime seller image upload:',x);res.status(500).json({error:x.message||'Image upload failed'})}}));
      router.post('/api/seller/upload/images',seller,(req,res)=>upload.array('images',8)(req,res,async e=>{try{if(e)return res.status(400).json({error:e.message||'Invalid images'});const files=req.files||[];if(!files.length)return res.status(400).json({error:'Select at least one image'});const urls=await Promise.all(files.map(uploadOne));res.json({ok:true,images:urls})}catch(x){console.error('Runtime seller gallery upload:',x);res.status(500).json({error:x.message||'Image upload failed'})}}));
      router.get('/api/seller/products',seller,async(req,res)=>{try{await ensureTables();const r=await pool.query('SELECT p.*,s.name AS seller_name FROM products p LEFT JOIN sellers s ON s.id=p.seller_id WHERE p.seller_id=$1 ORDER BY p.id DESC',[Number(req.session.seller.id)]);const out=[];for(const p of r.rows){const images=await gallery(pool,p.id,p.image);out.push({...p,price:num(p.price),original_price:num(p.price),discount_percent:num(p.discount_percent),sale_price:salePrice(p.price,p.discount_percent),stock:Math.max(0,Number(p.stock)||0),images,image_gallery:images})}res.json(out)}catch(e){console.error('Runtime seller products load:',e);res.status(500).json({error:e.message||'Unable to load products'})}});
      router.post('/api/seller/products',seller,async(req,res)=>{const c=await pool.connect();try{await ensureTables();const p=payload(req.body||{}),images=getImages(req.body||{});if(!images.length)return res.status(400).json({error:'Add at least one product image.'});await c.query('BEGIN');const r=await c.query('INSERT INTO products(name,price,category,image,description,stock,discount_percent,seller_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[p.name,p.price,p.category,images[0],p.description,p.stock,p.discount_percent,Number(req.session.seller.id)]);for(let i=0;i<images.length;i++)await c.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',[r.rows[0].id,images[i],i,i===0]);await c.query('COMMIT');res.status(201).json({ok:true,product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(p.price,p.discount_percent)}})}catch(e){try{await c.query('ROLLBACK')}catch{}console.error('Runtime seller product create:',e);res.status(400).json({error:e.message||'Unable to create product'})}finally{c.release()}});
      router.put('/api/seller/products/:id',seller,async(req,res)=>{const c=await pool.connect();try{await ensureTables();const id=Number(req.params.id);const own=await c.query('SELECT id,image FROM products WHERE id=$1 AND seller_id=$2',[id,Number(req.session.seller.id)]);if(!own.rows.length)return res.status(404).json({error:'Product not found'});const p=payload(req.body||{});let images=getImages(req.body||{});if(!images.length)images=await gallery(c,id,own.rows[0].image);if(!images.length)return res.status(400).json({error:'Add at least one product image.'});await c.query('BEGIN');const r=await c.query('UPDATE products SET name=$1,price=$2,category=$3,image=$4,description=$5,stock=$6,discount_percent=$7 WHERE id=$8 AND seller_id=$9 RETURNING *',[p.name,p.price,p.category,images[0],p.description,p.stock,p.discount_percent,id,Number(req.session.seller.id)]);await c.query('DELETE FROM product_images WHERE product_id=$1',[id]);for(let i=0;i<images.length;i++)await c.query('INSERT INTO product_images(product_id,image_url,sort_order,is_primary) VALUES($1,$2,$3,$4)',[id,images[i],i,i===0]);await c.query('COMMIT');res.json({ok:true,product:{...r.rows[0],images,image_gallery:images,sale_price:salePrice(p.price,p.discount_percent)}})}catch(e){try{await c.query('ROLLBACK')}catch{}console.error('Runtime seller product update:',e);res.status(400).json({error:e.message||'Unable to update product'})}finally{c.release()}});
      app.use(router);
      const stack=app.router?.stack||app._router?.stack;
      if(stack?.length){const layer=stack.pop();stack.unshift(layer);}
      ensureTables().catch(e=>console.error('Runtime gallery table:',e));
    }
    return previous.apply(this,arguments);
  };
}
install();
