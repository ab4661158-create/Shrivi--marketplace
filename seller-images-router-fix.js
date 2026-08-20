const express = require('express');

function moveSellerRoutesBeforeLegacy(app){
  const router=app.router||app._router;
  if(!router?.stack)return;
  const layers=[];
  for(let i=router.stack.length-1;i>=0;i--){
    const layer=router.stack[i];
    const p=layer?.route?.path;
    if(p==='/api/seller/products'||p==='/api/seller/products/:id'||p==='/api/seller/upload/images'||p==='/api/seller/listing/:id'||p==='/api/seller/listing/:id/status') layers.unshift(router.stack.splice(i,1)[0]);
  }
  if(!layers.length)return;
  let at=router.stack.findIndex(l=>String(l?.handle||'').includes('API endpoint not found'));
  if(at<0)at=router.stack.length;
  router.stack.splice(at,0,...layers);
}

const previousListen=express.application.listen;
express.application.listen=function(){
  const app=this;
  setTimeout(()=>moveSellerRoutesBeforeLegacy(app),250);
  setTimeout(()=>moveSellerRoutesBeforeLegacy(app),1500);
  setTimeout(()=>moveSellerRoutesBeforeLegacy(app),3000);
  return previousListen.apply(this,arguments);
};
