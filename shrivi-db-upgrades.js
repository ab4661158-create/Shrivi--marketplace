const { Pool } = require('pg');
const express = require('express');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

let installed = false;
async function ensureSchema() {
  if (installed) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL,
      label VARCHAR(60) NOT NULL DEFAULT 'Home',
      full_name VARCHAR(160) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      line1 VARCHAR(250) NOT NULL,
      line2 VARCHAR(250),
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      pincode VARCHAR(10) NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);
    CREATE TABLE IF NOT EXISTS product_reviews (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL,
      customer_id BIGINT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      review_text VARCHAR(1000) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, customer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id);
    CREATE TABLE IF NOT EXISTS customer_notifications (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      title VARCHAR(160) NOT NULL,
      message VARCHAR(1000) NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_customer_notifications_customer ON customer_notifications(customer_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS order_returns (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL,
      customer_id BIGINT NOT NULL,
      reason VARCHAR(500) NOT NULL,
      type VARCHAR(30) NOT NULL DEFAULT 'return',
      status VARCHAR(30) NOT NULL DEFAULT 'requested',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id, customer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_returns_customer ON order_returns(customer_id, created_at DESC);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(40) DEFAULT 'pending';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);
  installed = true;
}

function customer(req,res,next){
  if(!req.session?.customer) return res.status(401).json({error:'Customer login required'});
  next();
}
function clean(v){ return String(v ?? '').trim(); }
function positive(v){ const n=Number(v); return Number.isInteger(n)&&n>0; }

function install(app){
  if(app.__shriviDbUpgrades) return;
  app.__shriviDbUpgrades=true;
  app.use(async (req,res,next)=>{ try{ await ensureSchema(); next(); }catch(e){ console.error('SHRIVI UPGRADE DB:',e); next(); } });

  app.get('/api/customer/addresses', customer, async(req,res)=>{
    try{ const r=await pool.query(`SELECT * FROM customer_addresses WHERE customer_id=$1 ORDER BY is_default DESC,id DESC`,[req.session.customer.id]); res.json({ok:true,addresses:r.rows}); }
    catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/customer/addresses', customer, async(req,res)=>{
    try{
      const b=req.body||{};
      const required=['full_name','phone','line1','city','state','pincode'];
      if(required.some(k=>!clean(b[k]))) return res.status(400).json({error:'All address fields are required'});
      if(!/^\d{10}$/.test(clean(b.phone))) return res.status(400).json({error:'Phone must be 10 digits'});
      if(!/^\d{6}$/.test(clean(b.pincode))) return res.status(400).json({error:'Pincode must be 6 digits'});
      const client=await pool.connect();
      try{ await client.query('BEGIN');
        if(b.is_default) await client.query('UPDATE customer_addresses SET is_default=false WHERE customer_id=$1',[req.session.customer.id]);
        const r=await client.query(`INSERT INTO customer_addresses(customer_id,label,full_name,phone,line1,line2,city,state,pincode,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.session.customer.id,clean(b.label)||'Home',clean(b.full_name),clean(b.phone),clean(b.line1),clean(b.line2)||null,clean(b.city),clean(b.state),clean(b.pincode),!!b.is_default]);
        await client.query('COMMIT'); res.status(201).json({ok:true,address:r.rows[0]});
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }catch(e){res.status(400).json({error:e.message});}
  });

  app.delete('/api/customer/addresses/:id', customer, async(req,res)=>{
    try{const r=await pool.query(`DELETE FROM customer_addresses WHERE id=$1 AND customer_id=$2 RETURNING id`,[req.params.id,req.session.customer.id]);if(!r.rows.length)return res.status(404).json({error:'Address not found'});res.json({ok:true});}
    catch(e){res.status(500).json({error:e.message});}
  });

  app.get('/api/products/:id/reviews', async(req,res)=>{
    try{const r=await pool.query(`SELECT r.id,r.rating,r.review_text,r.created_at,c.name AS customer_name FROM product_reviews r LEFT JOIN customers c ON c.id=r.customer_id WHERE r.product_id=$1 ORDER BY r.created_at DESC`,[req.params.id]);const avg=r.rows.length?r.rows.reduce((s,x)=>s+Number(x.rating),0)/r.rows.length:0;res.json({ok:true,reviews:r.rows,average:Math.round(avg*10)/10,count:r.rows.length});}
    catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/products/:id/reviews', customer, async(req,res)=>{
    try{const rating=Number(req.body?.rating);if(!positive(req.params.id)||rating<1||rating>5)return res.status(400).json({error:'Rating must be between 1 and 5'});const text=clean(req.body?.review_text).slice(0,1000);const r=await pool.query(`INSERT INTO product_reviews(product_id,customer_id,rating,review_text) VALUES($1,$2,$3,$4) ON CONFLICT(product_id,customer_id) DO UPDATE SET rating=EXCLUDED.rating,review_text=EXCLUDED.review_text,created_at=NOW() RETURNING *`,[req.params.id,req.session.customer.id,rating,text]);res.status(201).json({ok:true,review:r.rows[0]});}
    catch(e){res.status(400).json({error:e.message});}
  });

  app.get('/api/customer/notifications', customer, async(req,res)=>{
    try{const r=await pool.query(`SELECT * FROM customer_notifications WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100`,[req.session.customer.id]);res.json({ok:true,notifications:r.rows});}
    catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/customer/notifications/:id/read', customer, async(req,res)=>{
    try{await pool.query(`UPDATE customer_notifications SET read_at=NOW() WHERE id=$1 AND customer_id=$2`,[req.params.id,req.session.customer.id]);res.json({ok:true});}
    catch(e){res.status(500).json({error:e.message});}
  });

  app.get('/api/customer/orders/:id/return', customer, async(req,res)=>{
    try{const r=await pool.query(`SELECT * FROM order_returns WHERE order_id=$1 AND customer_id=$2`,[req.params.id,req.session.customer.id]);res.json({ok:true,request:r.rows[0]||null});}
    catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/customer/orders/:id/return', customer, async(req,res)=>{
    try{const order=await pool.query(`SELECT id,status FROM orders WHERE id=$1 AND customer_id=$2`,[req.params.id,req.session.customer.id]);if(!order.rows.length)return res.status(404).json({error:'Order not found'});const reason=clean(req.body?.reason);if(!reason)return res.status(400).json({error:'Return reason is required'});const r=await pool.query(`INSERT INTO order_returns(order_id,customer_id,reason,type) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,customer_id) DO UPDATE SET reason=EXCLUDED.reason,type=EXCLUDED.type,status='requested',updated_at=NOW() RETURNING *`,[req.params.id,req.session.customer.id,reason,clean(req.body?.type)||'return']);await pool.query(`INSERT INTO customer_notifications(customer_id,type,title,message) VALUES($1,'return','Return requested',$2)`,[req.session.customer.id,`Return request for order #${req.params.id} has been submitted.`]);res.status(201).json({ok:true,request:r.rows[0]});}
    catch(e){res.status(400).json({error:e.message});}
  });

  app.get('/api/customer/orders/:id/tracking', customer, async(req,res)=>{
    try{const r=await pool.query(`SELECT id,status,tracking_status,updated_at,created_at FROM orders WHERE id=$1 AND customer_id=$2`,[req.params.id,req.session.customer.id]);if(!r.rows.length)return res.status(404).json({error:'Order not found'});res.json({ok:true,tracking:r.rows[0]});}
    catch(e){res.status(500).json({error:e.message});}
  });
}

const originalListen=express.application.listen;
express.application.listen=function(){ install(this); return originalListen.apply(this,arguments); };
