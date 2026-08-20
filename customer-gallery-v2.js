(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let activeImages=[];
let activeIndex=0;

function getProductFromCard(card){
  const name=card.querySelector('.product-name')?.textContent?.trim()||'';
  const list=Array.isArray(window.products)?window.products:[];
  return list.find(p=>String(p.name||'').trim()===name)||null;
}
function localImages(product){
  if(Array.isArray(product?.image_gallery))return product.image_gallery.filter(Boolean).slice(0,8);
  if(Array.isArray(product?.images))return product.images.filter(Boolean).slice(0,8);
  const x=String(product?.image||'').trim();
  if(!x)return[];
  try{const a=JSON.parse(x);if(Array.isArray(a))return a.filter(Boolean).slice(0,8)}catch(_){ }
  return[x];
}
async function fetchImages(product){
  const local=localImages(product);
  try{
    const r=await fetch('/api/products/'+encodeURIComponent(product.id)+'/images?_'+Date.now(),{credentials:'include',cache:'no-store'});
    if(r.ok){const d=await r.json();if(Array.isArray(d.images)&&d.images.length)return d.images.slice(0,8)}
  }catch(_){ }
  return local;
}
function ensureViewer(){
  if($('shriviCustomerImageViewer'))return;
  const m=document.createElement('div');m.id='shriviCustomerImageViewer';m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:99999;display:none;align-items:center;justify-content:center;padding:18px';
  m.innerHTML='<button id="scivClose" type="button" aria-label="Close" style="position:absolute;right:15px;top:15px;width:46px;height:46px;border:0;border-radius:50%;background:#fff;color:#111;font-size:28px;z-index:3">×</button><button id="scivPrev" type="button" aria-label="Previous" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:50px;height:50px;border:0;border-radius:50%;background:#fff;color:#111;font-size:32px;z-index:3">‹</button><img id="scivImg" alt="Product image" style="max-width:92vw;max-height:84vh;object-fit:contain;border-radius:10px"><button id="scivNext" type="button" aria-label="Next" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);width:50px;height:50px;border:0;border-radius:50%;background:#fff;color:#111;font-size:32px;z-index:3">›</button><div id="scivCount" style="position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:7px 13px;border-radius:20px;font-size:13px"></div>';
  document.body.appendChild(m);
  $('scivClose').onclick=()=>m.style.display='none';
  m.onclick=e=>{if(e.target===m)m.style.display='none'};
  $('scivPrev').onclick=e=>{e.stopPropagation();if(activeImages.length){activeIndex=(activeIndex-1+activeImages.length)%activeImages.length;draw()}};
  $('scivNext').onclick=e=>{e.stopPropagation();if(activeImages.length){activeIndex=(activeIndex+1)%activeImages.length;draw()}};
  document.addEventListener('keydown',e=>{if(m.style.display!=='flex')return;if(e.key==='Escape')m.style.display='none';if(e.key==='ArrowLeft')$('scivPrev').click();if(e.key==='ArrowRight')$('scivNext').click()});
}
function draw(){
  ensureViewer();
  $('scivImg').src=activeImages[activeIndex]||'';
  $('scivCount').textContent=`${activeIndex+1} / ${activeImages.length}`;
  $('scivPrev').style.display=activeImages.length>1?'block':'none';
  $('scivNext').style.display=activeImages.length>1?'block':'none';
}
async function openGallery(product){
  if(!product?.id)return;
  ensureViewer();
  $('scivImg').alt=String(product.name||'Product image');
  activeImages=await fetchImages(product);
  if(!activeImages.length)return;
  activeIndex=0;draw();$('shriviCustomerImageViewer').style.display='flex';
}
function bind(){
  document.querySelectorAll('.card .product-image').forEach(img=>{
    if(img.dataset.shriviGalleryBound)return;
    img.dataset.shriviGalleryBound='1';
    img.style.cursor='zoom-in';
    img.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openGallery(getProductFromCard(img.closest('.card')))});
  });
}
function boot(){ensureViewer();bind();new MutationObserver(()=>bind()).observe(document.body,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
