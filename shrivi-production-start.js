/* SHRIVI ROBUST PRODUCTION START
   Loads optional upgrade layers safely so one broken enhancement cannot
   take the entire Render service down with a 502. The core server remains
   the final required startup.
*/
const path = require('path');

// Security: never allow production to start with the weak session-secret
// fallback that exists inside legacy server code. Render uses this launcher.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  console.error('[Shrivi] FATAL: SESSION_SECRET must be set and at least 32 characters long.');
  process.exit(1);
}

// seller-images-upgrade.js is the canonical Seller 1-8 image implementation.
// Do not load the older seller-save-repair layer as well: both register the
// same /api/seller/upload/images endpoint and duplicate route handlers can
// make routing order-dependent.
const optional = [
  'shrivi-db-upgrades.js',
  'image-upload-bootstrap.js',
  'seller-images-upgrade.js',
  'seller-center-api-fix.js'
];

for (const file of optional) {
  try {
    require(path.join(__dirname, file));
    console.log(`[Shrivi] loaded ${file}`);
  } catch (err) {
    console.error(`[Shrivi] optional startup layer failed: ${file}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

require(path.join(__dirname, 'server.js'));
