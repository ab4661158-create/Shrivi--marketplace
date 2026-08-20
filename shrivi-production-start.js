/* SHRIVI ROBUST PRODUCTION START
   Loads optional upgrade layers safely so one broken enhancement cannot
   take the entire Render service down with a 502. The core server remains
   the final required startup.
*/
const path = require('path');

const optional = [
  'shrivi-db-upgrades.js',
  'image-upload-bootstrap.js',
  'seller-images-upgrade.js'
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
