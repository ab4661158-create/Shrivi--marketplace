(()=>{
'use strict';
const MAX=8;
let busy=false;
function install(){
 const old=document.getElementById('productImageFile');
 if(!old||busy)return;
 if(old.dataset.nativeMulti==='1')return;
 busy=true;
 try{
  const input=old.cloneNode(false);
  input.type='file';
  input.multiple=true;
  input.setAttribute('multiple','multiple');
  input.removeAttribute('capture');
  input.accept='image/jpeg,image/png,image/webp,image/gif';
  input.removeAttribute('onchange');
  input.dataset.nativeMulti='1';
  old.replaceWith(input);
  // seller-gallery-v2 assigns its real choose() handler to this fresh input.
 }finally{busy=false}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
new MutationObserver(()=>install()).observe(document.documentElement,{childList:true,subtree:true});
})();