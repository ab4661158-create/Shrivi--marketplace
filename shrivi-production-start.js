/* SHRIVI ROBUST PRODUCTION START
   Canonical startup: security hardening → database upgrades → one seller API 
   → automatic verification → marketplace server.
   Legacy image repair layers are intentionally not loaded here so multiple
   competing upload routes cannot override the canonical seller image flow.
*/
const path = require('path');

// First: Security hardening (validates environment before anything else)
require(path.join(__dirname, 'shrivi-security-hardening.js'));

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
