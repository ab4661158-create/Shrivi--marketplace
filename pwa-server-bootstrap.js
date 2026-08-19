const express = require("express");
const path = require("path");
const fs = require("fs");

// Add only the PWA wiring before the existing production bootstrap starts
// listening. Existing marketplace routes, APIs and application logic remain unchanged.
const originalListen = express.application.listen;

express.application.listen = function (...args) {
  const app = this;

  if (!app.__shriviPwaServiceWorkerRoute) {
    app.get("/service-worker.js", (req, res) => {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.type("application/javascript");
      res.sendFile(path.join(__dirname, "service-worker.js"));
    });

    app.__shriviPwaServiceWorkerRoute = true;
  }

  if (!app.__shriviPwaCustomerPwaInjection) {
    app.use((req, res, next) => {
      const originalSendFile = res.sendFile.bind(res);

      res.sendFile = (filePath, options, callback) => {
        const isCustomerPage =
          path.basename(String(filePath)) === "customer.html";

        if (!isCustomerPage) {
          return originalSendFile(filePath, options, callback);
        }

        try {
          let html = fs.readFileSync(filePath, "utf8");

          if (!html.includes("/pwa-register.js")) {
            const injection =
              '\n<script src="/pwa-register.js" defer></script>\n';

            if (html.includes("</head>")) {
              html = html.replace("</head>", injection + "</head>");
            }
          }

          res.type("html");
          return res.send(html);
        } catch (error) {
          console.error("SHRIVI PWA page injection error:", error);
          return originalSendFile(filePath, options, callback);
        }
      };

      next();
    });

    app.__shriviPwaCustomerPwaInjection = true;
  }

  return originalListen.apply(app, args);
};

require("./image-upload-bootstrap.js");
