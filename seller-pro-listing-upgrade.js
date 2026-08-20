const { Pool } = require('pg');
const express = require('express');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

function clean(v){ return String(v ?? '').trim(); }
function seller(req,res,next){
  if(!req.session?.seller) return res.status(401).json({error:'Seller login required'});
  next();
}
function parseArray(v, max=20){
  if(Array.isArray(v)) return v.map(clean).filter(Boolean).slice(0,max);
  return clean(v).split(/\n|,/).map(x=>x.trim()).filter(Boolean).slice(0,max);
}
function normalizeVariants(v){
  if(!Array.isArray(v)) return [];
  return v.slice(0,50).map(x=>({
    sku:clean(x?.sku).slice(0,80),
    size:clean(x?.size).slice(0,50),
    color:clean(x?.color).slice(0,50),
    price:Number(x?.price)||0,
    stock:Number.isInteger(Number(x?.stock))?Number(x.stock):0,
    image:clean(x?.image).slice(0,1000)
  })).filter(x=>x.sku||x.size||x.color);
}

async function ensureTables(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seller_listing_details (
      product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      seller_id BIGINT NOT NULL,
      brand TEXT,
      sku TEXT,
      barcode TEXT,
      hsn TEXT,
      tax_percent NUMERIC(5,2) DEFAULT 0,
      highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
      specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      search_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
      color TEXT,
      size TEXT,
      material TEXT,
      pattern TEXT,
      occasion TEXT,
      gender TEXT,
      age_group TEXT,
      country_of_origin TEXT DEFAULT 'India',
      manufacturer TEXT,
      model_number TEXT,
      warranty TEXT,
      dispatch_days INTEGER DEFAULT 2,
      return_days INTEGER DEFAULT 7,
      returnable BOOLEAN DEFAULT TRUE,
      replacement_available BOOLEAN DEFAULT FALSE,
      cod_available BOOLEAN DEFAULT TRUE,
      shipping_charge NUMERIC(10,2) DEFAULT 0,
      package_length NUMERIC(10,2),
      package_width NUMERIC(10,2),
      package_height NUMERIC(10,2),
      package_weight NUMERIC(10,3),
      listing_status TEXT NOT NULL DEFAULT 'active',
      variants JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_seller_listing_seller ON seller_listing_details(seller_id);
    CREATE INDEX IF NOT EXISTS idx_seller_listing_sku ON seller_listing_details(sku);
  `);
}

function normalizeBody(body){
  const b=body||{};
  const tax=Number(b.tax_percent||0);
  const shipping=Number(b.shipping_charge||0);
  const dispatch=Math.max(0,Math.min(30,parseInt(b.dispatch_days,10)||0));
  const returns=Math.max(0,Math.min(90,parseInt(b.return_days,10)||0));
  const details={
    brand:clean(b.brand).slice(0,120), sku:clean(b.sku).slice(0,80), barcode:clean(b.barcode).slice(0,80),
    hsn:clean(b.hsn).slice(0,20), tax_percent:Number.isFinite(tax)?Math.max(0,Math.min(100,tax)):0,
    highlights:parseArray(b.highlights,10), specifications:typeof b.specifications==='object'&&!Array.isArray(b.specifications)?b.specifications:{},
    tags:parseArray(b.tags,20), search_terms:parseArray(b.search_terms,20), color:clean(b.color).slice(0,80),
    size:clean(b.size).slice(0,80), material:clean(b.material).slice(0,120), pattern:clean(b.pattern).slice(0,120),
    occasion:clean(b.occasion).slice(0,120), gender:clean(b.gender).slice(0,40), age_group:clean(b.age_group).slice(0,40),
    country_of_origin:clean(b.country_of_origin).slice(0,80)||'India', manufacturer:clean(b.manufacturer).slice(0,150),
    model_number:clean(b.model_number).slice(0,100), warranty:clean(b.warranty).slice(0,150), dispatch_days:dispatch||2,
    return_days:returns||7, returnable:b.returnable!==false, replacement_available:Boolean(b.replacement_available),
    cod_available:b.cod_available!==false, shipping_charge:Number.isFinite(shipping)?Math.max(0,shipping):0,
    package_length:Number(b.package_length)||null, package_width:Number(b.package_width)||null, package_height:Number(b.package_height)||null,
    package_weight:Number(b.package_weight)||null, listing_status:['active','draft','inactive'].includes(b.listing_status)?b.listing_status:'active',
    variants:normalizeVariants(b.variants)
  };
  if(details.sku.length>0 && !/^[A-Za-z0-9._-]+$/.test(details.sku)) throw new Error('SKU may contain only letters, numbers, dot, underscore and hyphen.');
  if(details.highlights.length>10) throw new Error('Maximum 10 highlights allowed.');
  return details;
}

async function install(app){
  if(app.__shriviSellerPro) return;
  app.__shriviSellerPro=true;
  await ensureTables();

  app.get('/api/seller/listing/:id',seller,async(req,res)=>{
    try{
      const id=Number(req.params.id);
      const own=await pool.query('SELECT id FROM products WHERE id=$1 AND seller_id=$2',[id,Number(req.session.seller.id)]);
      if(!own.rows.length) return res.status(404).json({error:'Product not found'});
      const r=await pool.query('SELECT * FROM seller_listing_details WHERE product_id=$1 AND seller_id=$2',[id,Number(req.session.seller.id)]);
      res.json(r.rows[0]||{product_id:id,listing_status:'active',highlights:[],specifications:{},tags:[],search_terms:[],variants:[]});
    }catch(e){res.status(500).json({error:e.message||'Unable to load listing details'});}
  });

  app.put('/api/seller/listing/:id',seller,async(req,res)=>{
    const client=await pool.connect();
    try{
      const id=Number(req.params.id), sellerId=Number(req.session.seller.id);
      if(!Number.isInteger(id)||id<1) return res.status(400).json({error:'Invalid product ID'});
      const own=await client.query('SELECT id FROM products WHERE id=$1 AND seller_id=$2',[id,sellerId]);
      if(!own.rows.length) return res.status(404).json({error:'Product not found'});
      const d=normalizeBody(req.body);
      await client.query(`INSERT INTO seller_listing_details (product_id,seller_id,brand,sku,barcode,hsn,tax_percent,highlights,specifications,tags,search_terms,color,size,material,pattern,occasion,gender,age_group,country_of_origin,manufacturer,model_number,warranty,dispatch_days,return_days,returnable,replacement_available,cod_available,shipping_charge,package_length,package_width,package_height,package_weight,listing_status,variants,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb,NOW()) ON CONFLICT(product_id) DO UPDATE SET seller_id=EXCLUDED.seller_id,brand=EXCLUDED.brand,sku=EXCLUDED.sku,barcode=EXCLUDED.barcode,hsn=EXCLUDED.hsn,tax_percent=EXCLUDED.tax_percent,highlights=EXCLUDED.highlights,specifications=EXCLUDED.specifications,tags=EXCLUDED.tags,search_terms=EXCLUDED.search_terms,color=EXCLUDED.color,size=EXCLUDED.size,material=EXCLUDED.material,pattern=EXCLUDED.pattern,occasion=EXCLUDED.occasion,gender=EXCLUDED.gender,age_group=EXCLUDED.age_group,country_of_origin=EXCLUDED.country_of_origin,manufacturer=EXCLUDED.manufacturer,model_number=EXCLUDED.model_number,warranty=EXCLUDED.warranty,dispatch_days=EXCLUDED.dispatch_days,return_days=EXCLUDED.return_days,returnable=EXCLUDED.returnable,replacement_available=EXCLUDED.replacement_available,cod_available=EXCLUDED.cod_available,shipping_charge=EXCLUDED.shipping_charge,package_length=EXCLUDED.package_length,package_width=EXCLUDED.package_width,package_height=EXCLUDED.package_height,package_weight=EXCLUDED.package_weight,listing_status=EXCLUDED.listing_status,variants=EXCLUDED.variants,updated_at=NOW() RETURNING *`,[
        id,sellerId,d.brand,d.sku||null,d.barcode||null,d.hsn||null,d.tax_percent,JSON.stringify(d.highlights),JSON.stringify(d.specifications),JSON.stringify(d.tags),JSON.stringify(d.search_terms),d.color||null,d.size||null,d.material||null,d.pattern||null,d.occasion||null,d.gender||null,d.age_group||null,d.country_of_origin,d.manufacturer||null,d.model_number||null,d.warranty||null,d.dispatch_days,d.return_days,d.returnable,d.replacement_available,d.cod_available,d.shipping_charge,d.package_length,d.package_width,d.package_height,d.package_weight,d.listing_status,JSON.stringify(d.variants)
      ]);
      res.json({ok:true,listing:d});
    }catch(e){res.status(400).json({error:e.message||'Unable to save listing details'});}finally{client.release();}
  });

  app.post('/api/seller/listing/:id/status',seller,async(req,res)=>{
    try{
      const id=Number(req.params.id), sellerId=Number(req.session.seller.id), status=req.body?.status;
      if(!['active','draft','inactive'].includes(status)) return res.status(400).json({error:'Invalid listing status'});
      const r=await pool.query('UPDATE seller_listing_details SET listing_status=$1,updated_at=NOW() WHERE product_id=$2 AND seller_id=$3 RETURNING listing_status',[status,id,sellerId]);
      if(!r.rows.length) return res.status(404).json({error:'Listing details not found. Save listing first.'});
      res.json({ok:true,status:r.rows[0].listing_status});
    }catch(e){res.status(500).json({error:e.message||'Unable to update status'});}
  });

  const previousListen=express.application.listen;
  if(!express.application.__shriviProListen){
    express.application.__shriviProListen=true;
    express.application.listen=function(){
      const a=this;
      setTimeout(()=>install(a).catch(e=>console.error('Seller Pro install:',e)),300);
      return previousListen.apply(this,arguments);
    };
  }
}

// When preloaded with -r, patch Express before server.js calls listen().
const previousListen=express.application.listen;
express.application.listen=function(){
  const a=this;
  setTimeout(()=>install(a).catch(e=>console.error('Seller Pro install:',e)),250);
  return previousListen.apply(this,arguments);
};
