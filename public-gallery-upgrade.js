const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

function install(app){
  if(app.__shriviPublicGallery) return;
  app.__shriviPublicGallery=true;

  app.get('/api/products/:id/images', async (req,res)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<1) return res.status(400).json({error:'Invalid product ID'});

      const product=await pool.query('SELECT id,image FROM products WHERE id=$1 LIMIT 1',[id]);
      if(!product.rows.length) return res.status(404).json({error:'Product not found'});

      const gallery=await pool.query(
        'SELECT image_url,sort_order FROM product_images WHERE product_id=$1 ORDER BY sort_order ASC,id ASC',
        [id]
      );

      const images=gallery.rows.map(x=>x.image_url).filter(Boolean);
      const fallback=String(product.rows[0].image||'').trim();
      if(!images.length && fallback) images.push(fallback);

      res.set('Cache-Control','no-store');
      res.json({ok:true,images:[...new Set(images)].slice(0,8)});
    }catch(e){
      console.error('PUBLIC GALLERY:',e);
      res.status(500).json({error:'Unable to load product images'});
    }
  });

  const router=app.router||app._router;
  if(router?.stack){
    const layers=router.stack;
    const added=layers.pop();
    const target=layers.findIndex(l=>String(l?.handle||'').includes('API endpoint not found'));
    if(target>=0) layers.splice(target,0,added); else layers.push(added);
  }
}

const originalListen=require('express').application.listen;
require('express').application.listen=function(){
  install(this);
  return originalListen.apply(this,arguments);
};
