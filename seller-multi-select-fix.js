(()=>{
'use strict';
const MAX=8;
let files=[];
function el(id){return document.getElementById(id)}
function render(){
 const input=el('productImageFile'); if(!input)return;
 input.multiple=true; input.removeAttribute('capture'); input.accept='image/*';
 const box=input.closest('.image-upload-box'); if(!box)return;
 let add=el('shriviAddMorePhotos');
 if(!add){
   add=document.createElement('button'); add.type='button'; add.id='shriviAddMorePhotos'; add.className='btn primary'; add.style.cssText='margin-top:10px;width:100%'; add.textContent='📷 Add More Photos';
   add.onclick=()=>{input.value='';input.click()};
   box.appendChild(add);
 }
 let gallery=el('shriviSelectedGallery');
 if(!gallery){gallery=document.createElement('div');gallery.id='shriviSelectedGallery';gallery.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px';box.appendChild(gallery)}
 gallery.innerHTML='';
 files.forEach((f,i)=>{const wrap=document.createElement('div');wrap.style='position:relative';const img=document.createElement('img');img.src=URL.createObjectURL(f);img.style='width:100%;height:80px;object-fit:cover;border-radius:6px';const b=document.createElement('button');b.type='button';b.textContent='×';b.style='position:absolute;right:2px;top:2px;width:24px;height:24px;border-radius:50%;background:#d13212;color:#fff';b.onclick=()=>{files.splice(i,1);render()};wrap.append(img,b);gallery.appendChild(wrap)});
 const name=el('selectedFileName'); if(name)name.textContent=files.length?`${files.length} photo${files.length>1?'s':''} selected`:'No image selected';
}
function install(){
 const input=el('productImageFile'); if(!input)return;
 if(input.dataset.reliableGallery==='1'){render();return}
 input.dataset.reliableGallery='1'; input.type='file'; input.multiple=true; input.accept='image/*'; input.removeAttribute('capture');
 input.onchange=null; // remove the old single-image inline handler
 input.addEventListener('change',e=>{
   const selected=Array.from(e.target.files||[]);
   for(const f of selected){if(files.length>=MAX)break;if(f.type.startsWith('image/')&&f.size<=5*1024*1024)files.push(f)}
   input.value=''; render();
 },false);
 render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();