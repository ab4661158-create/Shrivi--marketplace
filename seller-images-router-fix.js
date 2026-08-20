const express = require('express');

function moveSellerRoutesBeforeLegacy(app){
  const router=app.router||app._router;
  if(!router?.stack)return;
  const wanted=new Set(['/api/seller/products','/api/seller/products/:id','/api/seller/upload/image','/api/seller/upload/images','/api/seller/listing/:id','/api/seller/listing/:id/status']);
  const layers=[];
  for(let i=router.stack.length-1;i>=0;i--){
    const layer=router.stack[i];
    if(wanted.has(layer?.route?.path)) layers.unshift(router.stack.splice(i,1)[0]);
  }
  if(!layers.length)return;
  const legacyIndex=router.stack.findIndex(layer=>String(layer?.handle||'').includes('API endpoint not found')||String(layer?.handle?.toString?.()||'').includes('API endpoint not found'));
  const at=legacyIndex<0?router.stack.length:legacyIndex;
  router.stack.splice(at,0,...layers);
}

const previousListen=express.application.listen;
express.application.listen=function(){
  const app=this;
  const fix=()=>moveSellerRoutesBeforeLegacy(app);
  fix();
  setTimeout(fix,50);
  setTimeout(fix,250);
  setTimeout(fix,1000);
  setTimeout(fix,2500);
  setTimeout(fix,5000);
  return previousListen.apply(this,arguments);
};
