const express = require("express");
const path = require("path");

// Add only the PWA service-worker route before the existing production
// bootstrap starts listening. All existing routes and application logic
// remain unchanged.
const originalListen = express.application.listen;

express.application.listen = function (...args) {
  if (!this.__shriviPwaServiceWorkerRoute) {
    this.get("/service-worker.js", (req, res) => {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.type("application/javascript");
      res.sendFile(path.join(__dirname, "service-worker.js"));
    });
    this.__shriviPwaServiceWorkerRoute = true;
  }

  return originalListen.apply(this, args);
};

require("./image-upload-bootstrap.js");
