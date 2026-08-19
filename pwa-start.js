/* SHRIVI SAFE PWA START
   Keeps the existing image-upload-bootstrap startup intact.
   Adds only the /service-worker.js response before the real server listens.
*/
const express = require('express');
const fs = require('fs');
const path = require('path');

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
