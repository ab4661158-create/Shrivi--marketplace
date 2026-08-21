const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'seller-canonical-api.js',
  'seller.html',
  'feature-proxy.js',
  'shrivi-production-start.js',
  'seller-image-system-verification.js'
];

let failed = false;
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`[VERIFY] missing ${file}`);
    failed = true;
  }
}

const seller = fs.readFileSync(path.join(root, 'seller.html'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'feature-proxy.js'), 'utf8');
const start = fs.readFileSync(path.join(root, 'shrivi-production-start.js'), 'utf8');
const canonical = fs.readFileSync(path.join(root, 'seller-canonical-api.js'), 'utf8');

const checks = [
  ['seller uses plural upload endpoint', seller.includes('/api/seller/upload/images')],
  ['seller sends images array when saving', seller.includes('images,')],
  ['seller includes credentials on upload', seller.includes('credentials:"include"')],
  ['canonical API handles plural upload', canonical.includes("/api/seller/upload/images")],
  ['canonical API saves product_images', canonical.includes('INSERT INTO product_images')],
  ['canonical API uses transaction', canonical.includes("await client.query('BEGIN')") && canonical.includes("await client.query('COMMIT')")],
  ['feature proxy preloads canonical seller API', proxy.includes("'seller-canonical-api.js'")],
  ['production start has canonical seller API', start.includes("'seller-canonical-api.js'")],
  ['automatic verifier is loaded', start.includes("'seller-image-system-verification.js'")],
  ['legacy seller image repair layers are not loaded by production start', !start.includes("'seller-images-upgrade.js'") && !start.includes("'seller-save-repair.js'")]
];

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log('SELLER IMAGE SYSTEM STATIC VERIFICATION PASSED');
