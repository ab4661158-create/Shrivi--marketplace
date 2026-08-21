/* SHRIVI ROBUST PRODUCTION START
   Canonical startup: database upgrades + one seller API + automatic verification.
   Legacy image repair layers are intentionally not loaded here so multiple
   competing upload routes cannot override the canonical seller image flow.
*/
const path = require('path');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  console.error('[Shrivi] FATAL: SESSION_SECRET must be set and at least 32 characters long.');
  process.exit(1);
}

const required = [
  'shrivi-db-upgrades.js',
  'seller-canonical-api.js',
  'seller-image-system-verification.js'
];

for (const file of required) {
  try {
    require(path.join(__dirname, file));
    console.log(`[Shrivi] loaded ${file}`);
  } catch (err) {
    console.error(`[Shrivi] required startup layer failed: ${file}`);
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

require(path.join(__dirname, 'server.js'));
