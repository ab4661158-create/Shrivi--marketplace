(()=>{
'use strict';
function fix(){
 const input=document.getElementById('productImageFile');
 if(!input)return;
 input.multiple=true;
 input.setAttribute('multiple','multiple');
 input.accept='image/jpeg,image/png,image/webp,image/gif';
 input.removeAttribute('capture');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fix);else fix();
new MutationObserver(fix).observe(document.documentElement,{childList:true,subtree:true});
setInterval(fix,500);
})();
