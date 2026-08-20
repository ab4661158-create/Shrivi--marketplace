/* SHRIVI SAFE PWA START
   Keeps the existing image-upload-bootstrap startup intact.
   Adds only the /service-worker.js response before the real server listens.
*/
const express = require('express');
const fs = require('fs');
const path = require('path');
const response = require('express/lib/response');

// Remove the Seller entry from the customer HTML at the server boundary.
// This protects /shop even if an older customer.html or PWA cache is deployed.
if (!response.__shriviCustomerSellRemoved) {
  const originalSendFile = response.sendFile;

  response.sendFile = function (filePath, options, callback) {
    const isCustomerPage =
      path.basename(String(filePath || '')).toLowerCase() === 'customer.html';

    if (!isCustomerPage) {
      return originalSendFile.call(this, filePath, options, callback);
    }

    const res = this;
    const done = typeof options === 'function' ? options : callback;

    fs.readFile(filePath, 'utf8', (error, html) => {
      if (error) {
        if (typeof done === 'function') return done(error);
        return res.status(500).send('Customer page unavailable');
      }

      const theme = `
<style id="shrivi-premium-theme">
:root{--cream:#fbf7ef;--cream2:#f4ecdf;--green:#123d2d;--green2:#1d5a43;--gold:#c49a52;--ink:#18201c;--muted:#747b75;--card:#fffdf9;--line:#e8dfd2}
html,body{background:var(--cream)!important;color:var(--ink)!important}
body{font-family:Inter,Arial,Helvetica,sans-serif!important}
.header{background:rgba(255,253,249,.96)!important;border-bottom:1px solid var(--line)!important;box-shadow:0 4px 18px rgba(18,61,45,.05)!important}
.header-inner{max-width:1280px!important;min-height:72px!important;padding:12px 20px!important}
.logo{font-family:Georgia,'Times New Roman',serif!important;font-size:30px!important;letter-spacing:0!important;color:var(--green)!important}
.search input{background:#fffdf9!important;border:1px solid #dcd2c4!important;color:var(--ink)!important;box-shadow:inset 0 1px 2px rgba(0,0,0,.02)!important}
.btn{background:var(--green)!important;color:#fff!important;border-radius:9px!important;box-shadow:0 5px 14px rgba(18,61,45,.12)!important}
.btn.light{background:#f1eadf!important;color:var(--green)!important;box-shadow:none!important}
.btn.green{background:var(--green2)!important}
.categories{background:var(--cream)!important;border-bottom:1px solid var(--line)!important}
.categories-inner{max-width:1280px!important;padding:11px 20px!important;gap:9px!important}
.category-btn{border:0!important;background:transparent!important;color:#4f5751!important;border-radius:22px!important;padding:9px 15px!important;font-weight:600!important}
.category-btn.active{background:var(--green)!important;color:#fff!important}
.hero{max-width:1280px!important;margin:20px auto!important;padding:52px 34px!important;border:1px solid var(--line)!important;border-radius:24px!important;background:linear-gradient(110deg,#f5ecdf 0%,#fffaf2 56%,#eadcc8 100%)!important;color:var(--green)!important;box-shadow:0 12px 35px rgba(18,61,45,.07)!important;position:relative!important;overflow:hidden!important}
.hero:after{content:'NEW\A ARRIVALS';white-space:pre;position:absolute;right:7%;top:25px;width:78px;height:78px;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;background:var(--gold);color:white;font-size:11px;font-weight:800;letter-spacing:1px;box-shadow:0 8px 20px rgba(196,154,82,.22)}
.hero h1{font-family:Georgia,'Times New Roman',serif!important;font-size:48px!important;line-height:1.05!important;max-width:520px!important;color:var(--green)!important}
.hero p{color:#5e665f!important;max-width:520px!important;font-size:16px!important}
.container{max-width:1280px!important}
.section-title{margin:28px 0 16px!important}
.section-title h2{font-family:Georgia,'Times New Roman',serif!important;color:var(--green)!important}
.products{gap:20px!important}
.card{background:var(--card)!important;border:1px solid var(--line)!important;border-radius:18px!important;box-shadow:0 7px 24px rgba(18,61,45,.06)!important;transition:transform .18s ease,box-shadow .18s ease!important}
.card:hover{transform:translateY(-3px)!important;box-shadow:0 12px 30px rgba(18,61,45,.1)!important}
.product-image{background:var(--cream2)!important}
.product-body{padding:15px!important}
.product-name{color:var(--green)!important}
.seller,.stock{color:var(--muted)!important}
.price{color:var(--green)!important}
.discount{color:#9a742d!important}
.old-price{color:#9b9b92!important}
.card .btn{background:var(--green)!important;border-radius:9px!important}
.overlay{background:rgba(9,27,19,.48)!important}
.panel,.modal{background:var(--card)!important;border:1px solid var(--line)!important}
.close{background:#eee7dc!important;color:var(--green)!important}
.payment-option{border-color:var(--line)!important;background:#fff!important}
.payment-option.selected{border-color:var(--green)!important}
.total-box{border-color:var(--line)!important}
.toast{background:var(--green)!important}
@media(max-width:700px){.header-inner{padding:10px 14px!important}.hero{margin:12px!important;padding:34px 22px!important}.hero h1{font-size:34px!important}.hero:after{right:18px;top:18px;width:62px;height:62px;font-size:9px}.products{gap:10px!important}.card{border-radius:14px!important}.product-image{height:190px!important}}
</style>`;

      const cleaned = html
        .replace(/<a\b[^>]*href\s*=\s*["']\/seller["'][^>]*>[\s\S]*?<\/a>/gi, '')
        .replace(/<button\b[^>]*(?:\/seller|sell)[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<a\b[^>]*>[\s\S]*?\bSell\b[\s\S]*?<\/a>/gi, '')
        .replace(/<\/head>/i, theme + '</head>');

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.type('html').send(cleaned);

      if (typeof done === 'function') done();
    });
  };

  response.__shriviCustomerSellRemoved = true;
}

const application = express.application;
const originalDescriptor = Object.getOwnPropertyDescriptor(application, 'listen');

if (originalDescriptor && typeof originalDescriptor.value === 'function') {
  let assignedListen = originalDescriptor.value;

  Object.defineProperty(application, 'listen', {
    configurable: true,
    get() {
      return assignedListen;
    },
    set(fn) {
      assignedListen = function (...args) {
        const app = this;

        if (!app.__shriviPwaRouteInstalled) {
          app.__shriviPwaRouteInstalled = true;
          app.get('/service-worker.js', (req, res) => {
            try {
              const file = path.join(__dirname, 'service-worker.js');
              res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
              res.type('application/javascript').send(fs.readFileSync(file, 'utf8'));
            } catch (error) {
              console.error('SHRIVI service worker route error:', error);
              res.status(404).type('text/plain').send('Service worker not found');
            }
          });
        }

        return fn.apply(app, args);
      };
    }
  });
}

require('./image-upload-bootstrap.js');
