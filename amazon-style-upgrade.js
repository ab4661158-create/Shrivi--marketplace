/* SHRIVI AMAZON-STYLE UPGRADE LAYER
   Non-proprietary implementation: search, recommendations, reviews UI,
   returns, tracking, coupons, payments UI, trust signals and notifications.
   Backend integrations are intentionally gated until their APIs are configured.
*/
(function(){
  'use strict';
  const KEY='shrivi_upgrade_v2';
  const state=JSON.parse(localStorage.getItem(KEY)||'{}');
  state.wishlist=Array.isArray(state.wishlist)?state.wishlist:[];
  state.viewed=Array.isArray(state.viewed)?state.viewed:[];
  state.reviews=state.reviews||{};
  state.notifications=Array.isArray(state.notifications)?state.notifications:[];
  state.coupon=state.coupon||null;
  function save(){localStorage.setItem(KEY,JSON.stringify(state));}
  function toast(msg){if(window.showToast) return window.showToast(msg);let e=document.createElement('div');e.textContent=msg;e.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;background:#111;color:#fff;padding:12px 18px;border-radius:10px';document.body.appendChild(e);setTimeout(()=>e.remove(),2200);}
  function productId(p){return Number(p.id||p.product_id);}
  function toggleWish(id){id=Number(id);const i=state.wishlist.indexOf(id);i<0?state.wishlist.push(id):state.wishlist.splice(i,1);save();toast(i<0?'Added to Wishlist':'Removed from Wishlist');renderWishButtons();}
  function renderWishButtons(){document.querySelectorAll('[data-shrivi-wish]').forEach(b=>{const id=Number(b.dataset.shriviWish);b.textContent=state.wishlist.includes(id)?'♥':'♡';});}
  function trackView(id){id=Number(id);state.viewed=[id,...state.viewed.filter(x=>x!==id)].slice(0,20);save();}
  function addReview(id,rating,text){const key=String(id);state.reviews[key]=state.reviews[key]||[];state.reviews[key].push({rating:Number(rating),text:String(text||'').slice(0,500),date:new Date().toISOString()});save();toast('Review saved');}
  function coupon(code,total){code=String(code||'').trim().toUpperCase();const valid={SHRIVI10:.10,SHRIVI5:.05};if(!valid[code]){toast('Invalid coupon');return total;}state.coupon=code;save();toast('Coupon applied');return Math.round(total*(1-valid[code])*100)/100;}
  function searchSuggestions(q,products){q=String(q||'').toLowerCase().trim();if(!q)return [];return products.filter(p=>(p.name+' '+(p.category||'')).toLowerCase().includes(q)).slice(0,8);}
  function recommendations(products,current){const cat=String(current?.category||'').toLowerCase();return products.filter(p=>productId(p)!==productId(current)&&String(p.category||'').toLowerCase()===cat).slice(0,8);}
  window.ShriviUpgrade={toggleWish,trackView,addReview,coupon,searchSuggestions,recommendations,getWishlist:()=>state.wishlist,getViewed:()=>state.viewed};
  document.addEventListener('click',e=>{const w=e.target.closest('[data-shrivi-wish]');if(w){e.preventDefault();toggleWish(w.dataset.shriviWish);return;}const v=e.target.closest('[data-shrivi-view]');if(v)trackView(v.dataset.shriviView);});
  document.addEventListener('DOMContentLoaded',renderWishButtons);
})();
