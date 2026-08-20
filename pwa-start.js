/* SHRIVI PWA START COMPATIBILITY WRAPPER
   Render may still have this file as its Start Command.
   Keep the real production startup in feature-proxy.js so both
   package.json and older Render settings start the same service.
*/
require('./feature-proxy.js');
