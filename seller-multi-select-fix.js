(()=>{
'use strict';
const MAX=8;
function install(){
 const input=document.getElementById('productImageFile');
 if(!input)return;
 // Do not let the old single-file handler replace the multi-file behavior.
 input.type='file';
 input.multiple=true;
 input.setAttribute('multiple','multiple');
 input.removeAttribute('capture');
 input.accept='image/*';
 // Native Android picker needs a genuine file input with multiple enabled.
 if(input.dataset.multiFixInstalled==='1')return;
 input.dataset.multiFixInstalled='1';
 input.addEventListener('click',()=>{
   input.multiple=true;
   input.removeAttribute('capture');
 },true);
 input.addEventListener('change',(e)=>{
   const files=Array.from(e.target.files||[]);
   if(files.length>MAX){
     e.stopImmediatePropagation();
     alert(`Maximum ${MAX} photos allowed.`);
     input.value='';
   }
 },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();