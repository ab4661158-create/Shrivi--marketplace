const express=require('express');
const previousListen=express.application.listen;
function moveRoutes(app){
  const router=app.router||app._router;
  if(!router?.stack)return;
  const wanted=new Set(['/api/seller/listing/:id','/api/seller/listing/:id/status']);
  const layers=[];
  for(let i=router.stack.length-1;i>=0;i--){
    const p=router.stack[i]?.route?.path;
    if(wanted.has(p))layers.unshift(router.stack.splice(i,1)[0]);
  }
  if(!layers.length)return;
  let at=router.stack.findIndex(l=>String(l?.handle||'').includes('API endpoint not found'));
  if(at<0)at=router.stack.length;
  router.stack.splice(at,0,...layers);
}
express.application.listen=function(){
  const app=this;
  setTimeout(()=>moveRoutes(app),700);
  setTimeout(()=>moveRoutes(app),2000);
  return previousListen.apply(this,arguments);
};
