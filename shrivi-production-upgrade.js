/* SHRIVI PRODUCTION UPGRADE
   Safe, non-proprietary marketplace feature layer.
   Persistent customer actions that require authenticated server/database APIs
   should be wired through the existing customer session endpoints; this file
   provides the complete client-side contract and graceful fallbacks.
*/
(function(){
'use strict';
const S='shrivi_production_v1';
const load=()=>{try{return JSON.parse(localStorage.getItem(S)||'{}')}catch{return {}}};
const save=x=>localStorage.setItem(S,JSON.stringify(x));
const state=load();
state.wishlist=Array.isArray(state.wishlist)?state.wishlist:[];
state.viewed=Array.isArray(state.viewed)?state.viewed:[];
state.notifications=Array.isArray(state.notifications)?state.notifications:[];
state.addresses=Array.isArray(state.addresses)?state.addresses:[];
state.reviews=state.reviews||{};
state.returnRequests=Array.isArray(state.returnRequests)?state.returnRequests:[];
state.coupons=state.coupons||{};
save(state);
function toast(m){if(typeof window.showToast==='function')return window.showToast(m);const e=document.createElement('div');e.textContent=m;e.style.cssText='position:fixed;z-index:999999;bottom:20px;left:50%;transform:translateX(-50%);padding:12px 18px;border-radius:10px;background:#111;color:#fff;font:14px sans-serif';document.body.appendChild(e);setTimeout(()=>e.remove(),2200)}
function id(v){return Number(v)}
function wish(v){v=id(v);const i=state.wishlist.indexOf(v);if(i<0){state.wishlist.push(v);toast('Added to Wishlist')}else{state.wishlist.splice(i,1);toast('Removed from Wishlist')}save(state);paintWish()}
function paintWish(){document.querySelectorAll('[data-shrivi-wish]').forEach(x=>x.textContent=state.wishlist.includes(id(x.dataset.shriviWish))?'♥':'♡')}
function viewed(v){v=id(v);if(!v)return;state.viewed=[v,...state.viewed.filter(x=>x!==v)].slice(0,30);save(state)}
function addAddress(a){if(!a||!a.name||!a.phone||!a.line1||!a.city||!a.pincode)throw Error('Complete address required');state.addresses.push({...a,id:Date.now()});save(state);return true}
function addReview(productId,rating,text){productId=id(productId);rating=id(rating);if(rating<1||rating>5)throw Error('Rating must be 1-5');const k=String(productId);state.reviews[k]=state.reviews[k]||[];state.reviews[k].push({rating,text:String(text||'').slice(0,1000),created_at:new Date().toISOString()});save(state);toast('Review submitted');return true}
function requestReturn(orderId,reason,type){if(!orderId||!reason)throw Error('Order and reason are required');state.returnRequests.push({order_id:String(orderId),reason:String(reason).slice(0,500),type:type||'return',status:'requested',created_at:new Date().toISOString()});save(state);toast('Return request submitted');return true}
function applyCoupon(code,subtotal){const c=String(code||'').trim().toUpperCase();const rules={SHRIVI10:{percent:10,min:499},SHRIVI5:{percent:5,min:199}};const r=rules[c];if(!r||Number(subtotal)<r.min)return {ok:false,discount:0,message:'Coupon not applicable'};const d=Math.round(Number(subtotal)*r.percent)/100;state.coupons[c]={used_at:new Date().toISOString()};save(state);return {ok:true,discount:d,message:`${c} applied`}}
function notify(message){state.notifications.unshift({message:String(message),read:false,created_at:new Date().toISOString()});state.notifications=state.notifications.slice(0,50);save(state)}
function recommend(products,current){const c=String(current?.category||'').toLowerCase();const recent=new Set(state.viewed);return (products||[]).filter(p=>id(p.id)!==id(current?.id)).sort((a,b)=>{const ar=String(a.category||'').toLowerCase()===c?1:0;const br=String(b.category||'').toLowerCase()===c?1:0;return (br-ar)+(recent.has(id(b.id))?-.1:0)-(recent.has(id(a.id))?-.1:0)}).slice(0,12)}
function suggestions(q,products){q=String(q||'').trim().toLowerCase();if(!q)return [];return (products||[]).filter(p=>(String(p.name||'')+' '+String(p.category||'')+' '+String(p.description||'')).toLowerCase().includes(q)).slice(0,10)}
window.ShriviProduction={wish,viewed,addAddress,addReview,requestReturn,applyCoupon,notify,recommend,suggestions,getState:()=>load()};
document.addEventListener('click',e=>{const w=e.target.closest('[data-shrivi-wish]');if(w){e.preventDefault();wish(w.dataset.shriviWish);return}const v=e.target.closest('[data-shrivi-view]');if(v)viewed(v.dataset.shriviView)});
document.addEventListener('DOMContentLoaded',paintWish);
})();
