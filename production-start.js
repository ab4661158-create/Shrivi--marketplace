/* SHRIVI UNIFIED PRODUCTION STARTUP */
require('./shrivi-db-upgrades.js');
const express=require('express');
const fs=require('fs');
const path=require('path');
const originalSendFile=express.response.sendFile;
const featureFiles=['shrivi-features.js','shrivi-upgrade-suite.js','amazon-style-upgrade.js','shrivi-production-upgrade.js','shrivi-customer-backend.js','seller-multi-images.js','seller-pro-listing-ui.js','seller-gallery-force.js'];
const featureTags=featureFiles.map(file=>`<script src="/${file}?v=9"></script>`).join('\n');
express.response.sendFile=function(filePath,...args){
 const normalized=String(filePath||'').replace(/\\/g,'/');
 const target=normalized.endsWith('/customer.html')||normalized.endsWith('/shop.html')||normalized.endsWith('/seller.html')||normalized.endsWith('/admin.html');
 if(!target)return originalSendFile.call(this,filePath,...args);
 const callback=typeof args[args.length-1]==='function'?args[args.length-1]:null;
 fs.readFile(filePath,'utf8',(err,html)=>{if(err){if(callback)return callback(err);return this.status(500).send('Page load error')}
  const clean=html.replace(/<script[^>]+(?:shrivi-features|shrivi-upgrade-suite|amazon-style-upgrade|shrivi-production-upgrade|shrivi-customer-backend|seller-multi-images|seller-pro-listing-ui|seller-gallery-force)[^>]*><\/script>/gi,'');
  const finalHtml=/<\/body>/i.test(clean)?clean.replace(/<\/body>/i,`${featureTags}\n</body>`):`${clean}\n${featureTags}`;
  this.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');this.type('html').send(finalHtml);if(callback)callback();
 });
};
const originalListen=express.application.listen;
express.application.listen=function(...args){const app=this;for(const file of featureFiles){const route='/'+file;if(!app.__shriviFeatureRoutes)app.__shriviFeatureRoutes=new Set();if(app.__shriviFeatureRoutes.has(route))continue;app.__shriviFeatureRoutes.add(route);app.get(route,(req,res)=>{try{res.set('Cache-Control','no-store');res.type('application/javascript').send(fs.readFileSync(path.join(__dirname,file),'utf8'))}catch(e){res.status(404).type('text/plain').send('Feature asset not found')}})}return originalListen.apply(app,args)};
require('./image-upload-bootstrap.js');
