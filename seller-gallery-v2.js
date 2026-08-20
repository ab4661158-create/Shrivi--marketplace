(()=>{
'use strict';
const MAX=8, MAX_SIZE=5*1024*1024;
const $=id=>document.getElementById(id);
let selected=[];
let cache=[];
const original={
 add:window.openAddProduct,
 edit:window.editProduct,
 save:window.saveProduct,
 load:window.loadProducts
};
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
const notify=(m,t='success')=>typeof window.showMessage==='function'?window.showMessage('mainMessage',m,t):alert(m);
function urls(p){
 if(Array.isArray(p?.image_gallery))return p.image_gallery.filter(Boolean).slice(0,MAX);
 if(Array.isArray(p?.images))return p.images.filter(Boolean).slice(0,MAX);
 const x=String(p?.image||'').trim();
 if(!x)return[];
 try{const a=JSON.parse(x);if(Array.isArray(a))return a.filter(Boolean).slice(0,MAX)}catch{}
 return[x];
}
function revoke(x){if(x?.blob)try{URL.revokeObjectURL(x.blob)}catch{}}
function reset(arr=[]){selected.forEach(revoke);selected=arr.filter(Boolean).slice(0,MAX).map(u=>({url:u,file:null,blob:u}));if($('productImageFile'))$('productImageFile').value='';render();}
function render(){
 const input=$('productImageFile');if(!input)return;
 input.multiple=true;input.accept='image/jpeg,image/png,image/webp,image/gif';
 const box=input.closest('.image-upload-box');if(!box)return;
 let note=$('galleryV2Note');if(!note){note=document.createElement('div');note.id='galleryV2Note';note.style.cssText='margin-top:10px;padding:10px;border:1px solid #f3d18a;border-radius:8px;background:#fffaf0;font-size:12px;color:#59636e';note.innerHTML='<b>📸 Product Gallery</b><br>Up to 8 photos. Select several together or tap <b>Add More Photos</b>. First photo is the main image.';box.appendChild(note)}
 let more=$('galleryV2More');if(!more){more=document.createElement('button');more.id='galleryV2More';more.type='button';more.className='btn secondary';more.style.cssText='width:100%;margin-top:9px;border-color:#ff9900;color:#111;background:#fffaf0';more.textContent='＋ Add More Photos';more.onclick=()=>{if(selected.length>=MAX)return notify('Maximum 8 photos allowed.','error');input.click()};box.appendChild(more)}
 input.onchange=choose;
 let g=$('galleryV2Grid');if(!g){g=document.createElement('div');g.id='galleryV2Grid';g.style.cssText='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px';box.appendChild(g)}
 g.innerHTML=selected.map((x,i)=>`<div style="position:relative;aspect-ratio:1;border:2px solid ${i===0?'#ff9900':'#ddd'};border-radius:8px;overflow:hidden;background:#f7f8f8"><img src="${esc(x.url||x.blob)}" style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in"><button type="button" data-remove="${i}" style="position:absolute;right:3px;top:3px;width:27px;height:27px;border-radius:50%;background:#d13212;color:#fff;font-size:18px;line-height:27px">×</button><span style="position:absolute;left:3px;bottom:3px;background:#131921dd;color:#fff;padding:3px 5px;border-radius:4px;font-size:10px">${i===0?'MAIN':'PHOTO '+(i+1)}</span></div>`).join('');
 g.querySelectorAll('[data-remove]').forEach(b=>b.onclick=e=>{e.stopPropagation();const i=Number(b.dataset.remove);revoke(selected[i]);selected.splice(i,1);render()});
 g.querySelectorAll('img').forEach((img,i)=>img.onclick=()=>viewer(i,selected.map(x=>x.url||x.blob)));
 if($('selectedFileName'))$('selectedFileName').textContent=selected.length?`${selected.length} photo(s) ready`:'No image selected';
 if($('imageUploadStatus'))$('imageUploadStatus').textContent=selected.length?`${selected.length} photo(s) ready • Save Product to upload`:'Add product photos';
 const p=$('productImagePreview');const main=selected[0]?.url||selected[0]?.blob;if(p&&main){p.src=main;p.style.display='block'}else if(p){p.style.display='none';p.removeAttribute('src')}
}
function choose(e){
 const files=[...(e.target.files||[])];e.target.value='';if(!files.length)return;
 if(selected.length+files.length>MAX)return notify('Maximum 8 photos allowed.','error');
 for(const f of files){if(!['image/jpeg','image/png','image/webp','image/gif'].includes(f.type))return notify('Only JPG, PNG, WEBP or GIF images are allowed.','error');if(f.size>MAX_SIZE)return notify('Each image must be 5MB or smaller.','error')}
 files.forEach(file=>selected.push({file,blob:URL.createObjectURL(file),url:''}));render();
}
async function json(r){let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||'Request failed');return d}
async function upload(files){
 const f=new FormData();files.forEach(x=>f.append('images',x));
 const r=await fetch('/api/seller/upload/images',{method:'POST',credentials:'include',body:f});
 if(r.ok){const d=await r.json().catch(()=>({}));if(Array.isArray(d.images)&&d.images.length===files.length)return d.images}
 const out=[];for(const file of files){const one=new FormData();one.append('image',file);const rr=await fetch('/api/seller/upload/image',{method:'POST',credentials:'include',body:one});const d=await json(rr);const u=d.image||d.url||d.secure_url||d.imageUrl||d.data?.url||d.data?.image;if(!u)throw Error('Image URL was not returned');out.push(u)}return out;
}
async function save(){
 const id=$('productId')?.value.trim()||'',name=$('productName')?.value.trim()||'',price=Number($('productPrice')?.value),category=$('productCategory')?.value.trim()||'',description=$('productDescription')?.value.trim()||'',stock=Number($('productStock')?.value),discount=Number($('productDiscount')?.value||0);
 if(!name)return alert('Product name is required.');if(!Number.isFinite(price)||price<0)return alert('Enter a valid product price.');if(!category)return alert('Product category is required.');if(!Number.isInteger(stock)||stock<0)return alert('Stock must be a whole number.');if(!Number.isFinite(discount)||discount<0||discount>=100)return alert('Discount must be between 0 and 99.99%.');
 const btn=$('saveProductButton');btn.disabled=true;btn.textContent='Saving...';
 try{
  const files=selected.filter(x=>x.file).map(x=>x.file);
  if(files.length){$('imageUploadStatus').textContent=`Uploading ${files.length} photo(s)...`;const uploaded=await upload(files);let n=0;selected=selected.map(x=>x.file?{url:uploaded[n++],file:null,blob:uploaded[n-1]}:x);}
  let images=selected.map(x=>x.url||x.blob).filter(x=>/^https?:\/\//i.test(String(x))).slice(0,MAX);
  const legacy=$('productImage')?.value.trim();if(!images.length&&legacy)images=[legacy];
  if(!images.length)return alert('Please add at least one product image.');
  const r=await fetch(id?`/api/seller/products/${encodeURIComponent(id)}`:'/api/seller/products',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,price,category,image:images[0],images,description,stock,discount_percent:discount})});
  await json(r);closeProductModal();notify(id?'Product updated successfully!':'Product added successfully!');await refreshCache();
 }catch(e){notify(e.message||'Unable to save product.','error')}finally{btn.disabled=false;btn.textContent='Save Product'}
}
async function refreshCache(){if(original.load)await original.load.apply(this,arguments);try{const r=await fetch('/api/seller/products?gallery_v2='+Date.now(),{credentials:'include',cache:'no-store'});cache=await r.json();}catch{cache=[]}bindCards()}
function productForCard(card){const b=card.querySelector('button[onclick*="editProduct"]');const m=b?.getAttribute('onclick')?.match(/editProduct\((\d+)\)/);if(m)return cache.find(p=>Number(p.id)===Number(m[1]));return null}
function bindCards(){document.querySelectorAll('.product-card .product-image').forEach(img=>{if(img.dataset.v2)return;img.dataset.v2='1';img.style.cursor='zoom-in';img.onclick=()=>{const p=productForCard(img.closest('.product-card'));const a=urls(p);viewer(0,a.length?a:[img.currentSrc||img.src])}})}
function viewer(start,arr){if(!arr.length)return;let m=$('galleryV2Viewer');if(!m){m=document.createElement('div');m.id='galleryV2Viewer';m.style.cssText='position:fixed;inset:0;background:#000e;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px';m.innerHTML='<button id="gv2x" style="position:absolute;right:14px;top:14px;width:44px;height:44px;border-radius:50%;background:#fff;font-size:26px">×</button><button id="gv2p" style="position:absolute;left:12px;top:50%;width:46px;height:46px;border-radius:50%;background:#fff;font-size:28px">‹</button><img id="gv2img" style="max-width:94vw;max-height:86vh;object-fit:contain;border-radius:10px"><button id="gv2n" style="position:absolute;right:12px;top:50%;width:46px;height:46px;border-radius:50%;background:#fff;font-size:28px">›</button><div id="gv2c" style="position:absolute;bottom:16px;background:#111;color:#fff;padding:6px 12px;border-radius:20px"></div>';document.body.appendChild(m);$('gv2x').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()}}
 let i=start;const draw=()=>{$('gv2img').src=arr[i];$('gv2c').textContent=`${i+1} / ${arr.length}`;$('gv2p').style.display=arr.length>1?'block':'none';$('gv2n').style.display=arr.length>1?'block':'none'};$('gv2p').onclick=()=>{i=(i-1+arr.length)%arr.length;draw()};$('gv2n').onclick=()=>{i=(i+1)%arr.length;draw()};draw();}
function hook(){
 window.openAddProduct=function(){original.add?.apply(this,arguments);setTimeout(()=>{reset();render()},40)};
 window.editProduct=function(id){original.edit?.apply(this,arguments);setTimeout(()=>{const p=cache.find(x=>Number(x.id)===Number(id));reset(urls(p));render()},120)};
 window.saveProduct=save;
 window.loadProducts=refreshCache;
}
function boot(){hook();render();refreshCache();setInterval(()=>{if($('productModal')&&!$('productModal').classList.contains('hidden'))render();bindCards()},1200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();