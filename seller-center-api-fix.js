/* SHRIVI SELLER CENTER API FIX
   Restores the Seller Center endpoints used by seller.html.
   Core server/product/image code is left untouched.
*/
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const seller = (req, res, next) => {
  if (!req.session?.seller) return res.status(401).json({ error: 'Seller login required' });
  next();
};

const toNumber = value => Number(value) || 0;

function sellerItems(items, sellerId) {
  let list = items;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(item => Number(item?.seller_id) === Number(sellerId));
}

async function install(app) {
  if (app.__shriviSellerCenterApiFix) return;
  app.__shriviSellerCenterApiFix = true;

  app.get('/api/seller/dashboard', seller, async (req, res) => {
    try {
      const sellerId = Number(req.session.seller.id);
      const products = await pool.query(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(stock),0)::int AS stock FROM products WHERE seller_id=$1',
        [sellerId]
      );
      const orders = await pool.query('SELECT items,total,status FROM orders ORDER BY id DESC');
      let orderCount = 0;
      let revenue = 0;
      for (const row of orders.rows) {
        const items = sellerItems(row.items, sellerId);
        if (!items.length) continue;
        orderCount++;
        revenue += items.reduce((sum, item) => sum + toNumber(item.item_total), 0);
      }
      res.json({
        products: Number(products.rows[0]?.count || 0),
        stock: Number(products.rows[0]?.stock || 0),
        orders: orderCount,
        revenue: Math.round(revenue * 100) / 100
      });
    } catch (error) {
      console.error('Seller dashboard:', error);
      res.status(500).json({ error: error.message || 'Unable to load seller dashboard' });
    }
  });

  app.get('/api/seller/orders', seller, async (req, res) => {
    try {
      const sellerId = Number(req.session.seller.id);
      const result = await pool.query(`
        SELECT id,customer_name,customer_phone,customer_address,items,total,status,created_at
        FROM orders
        ORDER BY id DESC
      `);
      const out = [];
      for (const row of result.rows) {
        const items = sellerItems(row.items, sellerId);
        if (!items.length) continue;
        const sellerTotal = Math.round(items.reduce((sum, item) => sum + toNumber(item.item_total), 0) * 100) / 100;
        out.push({
          id: Number(row.id),
          customer_name: row.customer_name || '',
          customer_phone: row.customer_phone || '',
          customer_address: row.customer_address || '',
          items,
          total: toNumber(row.total),
          seller_total: sellerTotal,
          status: row.status || 'pending',
          created_at: row.created_at
        });
      }
      res.json(out);
    } catch (error) {
      console.error('Seller orders:', error);
      res.status(500).json({ error: error.message || 'Unable to load seller orders' });
    }
  });

  app.put('/api/seller/orders/:id/status', seller, async (req, res) => {
    try {
      const sellerId = Number(req.session.seller.id);
      const orderId = Number(req.params.id);
      const status = String(req.body?.status || '').trim().toLowerCase();
      const allowed = new Set(['confirmed', 'shipped', 'delivered', 'cancelled']);
      if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'Invalid order ID' });
      if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid order status' });

      const result = await pool.query(
        `UPDATE orders
         SET status=$1
         WHERE id=$2
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(items) item
           WHERE (item->>'seller_id')::bigint=$3
         )
         RETURNING id,status`,
        [status, orderId, sellerId]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Order not found for this seller' });
      res.json({ ok: true, order: result.rows[0] });
    } catch (error) {
      console.error('Seller order status:', error);
      res.status(500).json({ error: error.message || 'Unable to update order status' });
    }
  });

  console.log('SHRIVI seller center API endpoints ready');
}

const oldListen = require('express').application.listen;
require('express').application.listen = function () {
  install(this).catch(error => console.error('SHRIVI SELLER CENTER API FIX:', error));
  return oldListen.apply(this, arguments);
};
