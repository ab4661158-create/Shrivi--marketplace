/* SHRIVI CUSTOMER-ONLY UI CLEANUP
   Keeps customer shopping features intact while removing seller navigation
   and the generic assistant panel from the customer storefront.
*/
(()=>{
  'use strict';
  const REMOVE_TEXT=['SHRIVI Assistant'];
  function clean(){
    document.querySelectorAll('button,a').forEach(el=>{
      const text=(el.textContent||'').trim().toLowerCase();
      const href=el.getAttribute('href')||'';
      if(text==='sell' || href==='/seller' || href.startsWith('/seller?')) el.remove();
    });
    document.querySelectorAll('body *').forEach(el=>{
      if(el.children.length) return;
      const text=(el.textContent||'').trim();
      if(!text) return;
      if(REMOVE_TEXT.some(x=>text.toLowerCase()===x.toLowerCase())){
        const target=el.closest('.card,.panel,.modal,section,aside,footer,div')||el;
        if(target!==document.body) target.remove();
      }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',clean);
  else clean();
  new MutationObserver(clean).observe(document.body,{childList:true,subtree:true});
})();
