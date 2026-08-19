const fs = require('fs');
const Module = require('module');
const path = require('path');

const sourcePath = path.join(__dirname, 'server.js');
let source = fs.readFileSync(sourcePath, 'utf8');

const marker = '// =====================================================\n// API 404';
const upgrade = String.raw`
// =====================================================
// SHRIVI PRODUCTION CUSTOMER FEATURES
// =====================================================
async function ensureShriviUpgradeTables(){
  await pool.query(` + "`" + `
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'Home',
      full_name TEXT NOT NULL,
      phone TEXT,
      address_line TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pincode TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS product_reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      review_text TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(product_id, customer_id)
    );
    CREATE TABLE IF NOT EXISTS return_requests (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'return',
      status TEXT NOT NULL DEFAULT 'requested',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(order_id, customer_id)
    );
    CREATE TABLE IF NOT EXISTS customer_notifications (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      max_discount NUMERIC(12,2),
      min_order NUMERIC(12,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMPTZ,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_addresses_customer ON customer_addresses(customer_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id);
    CREATE INDEX IF NOT EXISTS idx_returns_customer ON return_requests(customer_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_customer ON customer_notifications(customer_id, created_at DESC);
  ` + "`" + `);
}

app.get('/api/customer/addresses', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const r=await pool.query('SELECT * FROM customer_addresses WHERE customer_id=$1 ORDER BY is_default DESC,id DESC',[req.session.customer.id]); res.json(r.rows); }
  catch(e){ res.status(500).json({error:safeError(e)}); }
});

app.post('/api/customer/addresses', requireCustomer, async (req,res)=>{
  try {
    await ensureShriviUpgradeTables();
    const b=req.body||{};
    const fullName=clean(b.full_name), address=clean(b.address_line), city=clean(b.city), state=clean(b.state), pincode=clean(b.pincode), phone=clean(b.phone), label=clean(b.label)||'Home';
    if(!fullName||!address||!city||!state||!/^[0-9]{6}$/.test(pincode)) return res.status(400).json({error:'Complete valid address is required'});
    const customerId=Number(req.session.customer.id);
    const client=await pool.connect();
    try { await client.query('BEGIN'); if(b.is_default) await client.query('UPDATE customer_addresses SET is_default=false WHERE customer_id=$1',[customerId]); const r=await client.query('INSERT INTO customer_addresses(customer_id,label,full_name,phone,address_line,city,state,pincode,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[customerId,label,fullName,phone||null,address,city,state,pincode,!!b.is_default]); await client.query('COMMIT'); res.status(201).json({ok:true,address:r.rows[0]}); } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
  } catch(e){res.status(400).json({error:safeError(e)});}
});

app.delete('/api/customer/addresses/:id', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const r=await pool.query('DELETE FROM customer_addresses WHERE id=$1 AND customer_id=$2 RETURNING id',[Number(req.params.id),Number(req.session.customer.id)]); if(!r.rows.length)return res.status(404).json({error:'Address not found'}); res.json({ok:true}); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

app.get('/api/products/:id/reviews', async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const r=await pool.query(` + "`" + `SELECT r.id,r.product_id,r.rating,r.review_text,r.image_url,r.created_at,c.name AS customer_name FROM product_reviews r JOIN customers c ON c.id=r.customer_id WHERE r.product_id=$1 ORDER BY r.id DESC` + "`" + `,[Number(req.params.id)]); const avg= r.rows.length ? r.rows.reduce((s,x)=>s+Number(x.rating),0)/r.rows.length : 0; res.json({reviews:r.rows,average:Math.round(avg*10)/10,count:r.rows.length}); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

app.post('/api/products/:id/reviews', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const productId=Number(req.params.id), rating=Number(req.body?.rating), text=clean(req.body?.review_text); if(!positiveInteger(productId)||rating<1||rating>5||!Number.isInteger(rating))return res.status(400).json({error:'Rating must be 1-5'}); const owned=await pool.query(` + "`" + `SELECT 1 FROM orders o WHERE o.customer_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(o.items,'[]'::jsonb)) i WHERE (i->>'product_id')::int=$2) LIMIT 1` + "`" + `,[Number(req.session.customer.id),productId]); if(!owned.rows.length)return res.status(403).json({error:'Purchase required before reviewing'}); const r=await pool.query(` + "`" + `INSERT INTO product_reviews(product_id,customer_id,rating,review_text,image_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id,customer_id) DO UPDATE SET rating=EXCLUDED.rating,review_text=EXCLUDED.review_text,image_url=EXCLUDED.image_url RETURNING *` + "`" + `,[productId,Number(req.session.customer.id),rating,text,clean(req.body?.image_url)||null]); res.status(201).json({ok:true,review:r.rows[0]}); }
  catch(e){res.status(400).json({error:safeError(e)});}
});

app.get('/api/customer/orders/:id/track', requireCustomer, async (req,res)=>{
  try { const r=await pool.query('SELECT id,status,created_at,payment_status FROM orders WHERE id=$1 AND customer_id=$2',[Number(req.params.id),Number(req.session.customer.id)]); if(!r.rows.length)return res.status(404).json({error:'Order not found'}); res.json({ok:true,order:r.rows[0],timeline:['pending','confirmed','shipped','delivered'].map(s=>({status:s,completed:['pending','confirmed','shipped','delivered'].indexOf(s)<=['pending','confirmed','shipped','delivered'].indexOf(r.rows[0].status)}))}); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

app.post('/api/customer/orders/:id/return', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const orderId=Number(req.params.id), customerId=Number(req.session.customer.id), reason=clean(req.body?.reason), type=clean(req.body?.type)||'return'; if(!positiveInteger(orderId)||!reason)return res.status(400).json({error:'Return reason is required'}); const o=await pool.query('SELECT id,status FROM orders WHERE id=$1 AND customer_id=$2',[orderId,customerId]); if(!o.rows.length)return res.status(404).json({error:'Order not found'}); if(!['delivered','confirmed'].includes(o.rows[0].status))return res.status(400).json({error:'Return is available after order confirmation/delivery'}); const r=await pool.query(` + "`" + `INSERT INTO return_requests(order_id,customer_id,reason,type) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,customer_id) DO UPDATE SET reason=EXCLUDED.reason,type=EXCLUDED.type,updated_at=NOW() RETURNING *` + "`" + `,[orderId,customerId,reason,type]); await pool.query('INSERT INTO customer_notifications(customer_id,title,message) VALUES($1,$2,$3)',[customerId,'Return request received',`Return request for order #${orderId} is now under review.`]); res.status(201).json({ok:true,request:r.rows[0]}); }
  catch(e){res.status(400).json({error:safeError(e)});}
});

app.get('/api/customer/notifications', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const r=await pool.query('SELECT * FROM customer_notifications WHERE customer_id=$1 ORDER BY id DESC LIMIT 50',[Number(req.session.customer.id)]); res.json(r.rows); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

app.put('/api/customer/notifications/:id/read', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const r=await pool.query('UPDATE customer_notifications SET read_at=NOW() WHERE id=$1 AND customer_id=$2 RETURNING *',[Number(req.params.id),Number(req.session.customer.id)]); if(!r.rows.length)return res.status(404).json({error:'Notification not found'}); res.json({ok:true,notification:r.rows[0]}); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

app.post('/api/coupons/validate', async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const code=clean(req.body?.code).toUpperCase(), subtotal=Number(req.body?.subtotal); if(!code||!Number.isFinite(subtotal)||subtotal<0)return res.status(400).json({error:'Invalid coupon request'}); const r=await pool.query(` + "`" + `SELECT * FROM coupons WHERE code=$1 AND active=true AND (expires_at IS NULL OR expires_at>NOW()) AND (usage_limit IS NULL OR used_count<usage_limit) LIMIT 1` + "`" + `,[code]); if(!r.rows.length)return res.status(404).json({error:'Coupon not found or expired'}); const c=r.rows[0]; if(subtotal<Number(c.min_order))return res.status(400).json({error:`Minimum order ₹${c.min_order} required`}); let discount=subtotal*Number(c.discount_percent)/100; if(c.max_discount!=null)discount=Math.min(discount,Number(c.max_discount)); discount=Math.round(discount*100)/100; res.json({ok:true,code,discount,final_total:Math.max(0,Math.round((subtotal-discount)*100)/100)}); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

app.get('/api/customer/returns', requireCustomer, async (req,res)=>{
  try { await ensureShriviUpgradeTables(); const r=await pool.query('SELECT * FROM return_requests WHERE customer_id=$1 ORDER BY id DESC',[Number(req.session.customer.id)]); res.json(r.rows); }
  catch(e){res.status(500).json({error:safeError(e)});}
});

`;

if (source.includes(marker) && !source.includes('SHRIVI PRODUCTION CUSTOMER FEATURES')) {
  source = source.replace(marker, upgrade + marker);
}

const m = new Module(sourcePath, module);
m.filename = sourcePath;
m.paths = Module._nodeModulePaths(__dirname);
m._compile(source, sourcePath);
