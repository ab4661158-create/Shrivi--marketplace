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

      const cleaned = html
        .replace(/<a\b[^>]*href\s*=\s*["']\/seller["'][^>]*>[\s\S]*?<\/a>/gi, '')
        .replace(/<button\b[^>]*(?:\/seller|sell)[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<a\b[^>]*>[\s\S]*?\bSell\b[\s\S]*?<\/a>/gi, '');

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
