const express = require('express');

function isWanted(layer){
  return new Set([
    '/api/seller/products',
    '/api/seller/products/:id',
    '/api/seller/upload/image',
    '/api/seller/upload/images',
    '/api/seller/listing/:id',
    '/api/seller/listing/:id/status'
  ]).has(layer?.route?.path);
}

function isGalleryRoute(layer){
  const src=String(layer?.route?.stack?.map(x=>x?.handle?.toString?.()||'').join('\n')||'');
  return src.includes('product_images') || src.includes("upload.array('images',8)") || src.includes('Image upload timed out');
}

function moveSellerRoutesBeforeLegacy(app){
  const router=app.router||app._router;
  if(!router?.stack)return;
  const picked=[];
  for(let i=router.stack.length-1;i>=0;i--){
    if(isWanted(router.stack[i])) picked.unshift(router.stack.splice(i,1)[0]);
  }
  if(!picked.length)return;
  const gallery=picked.filter(isGalleryRoute);
  const normal=picked.filter(x=>!isGalleryRoute(x));
  const ordered=[...gallery,...normal];
  const legacyIndex=router.stack.findIndex(layer=>String(layer?.handle||'').includes('API endpoint not found')||String(layer?.handle?.toString?.()||'').includes('API endpoint not found'));
  const at=legacyIndex<0?router.stack.length:legacyIndex;
  router.stack.splice(at,0,...ordered);
}

const previousListen=express.application.listen;
express.application.listen=function(){
  const app=this;
  const fix=()=>moveSellerRoutesBeforeLegacy(app);
  fix();
  [50,250,1000,2500,5000].forEach(ms=>setTimeout(fix,ms));
  return previousListen.apply(this,arguments);
};
