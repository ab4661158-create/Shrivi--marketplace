(()=>{
'use strict';
const MAX_IMAGES=8,MAX_SIZE=5*1024*1024;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
let gallery=[];
const originalOpenAdd=window.openAddProduct;
const originalEdit=window.editProduct;
const originalRender=window.renderProducts;
function msg(text,type='success'){if(typeof window.showMessage==='function')window.showMessage('mainMessage',text,type);else alert(text)}
function parseGallery(product){
  if(Array.isArray(product?.image_gallery))return product.image_gallery.filter(Boolean).slice(0,MAX_IMAGES);
  if(Array.isArray(product?.images))return product.images.filter(Boolean).slice(0,MAX_IMAGES);
  const raw=String(product?.image||'').trim();
  if(!raw)return[];
  try{const a=JSON.parse(raw);if(Array.isArray(a))return a.filter(Boolean).slice(0,MAX_IMAGES)}catch(_){ }
  return[raw];
}
function ensureUI(){
  const input=$('productImageFile');if(!input)return;
  input.multiple=true;
  input.setAttribute('multiple','multiple');
  input.setAttribute('accept','image/jpeg,image/png,image/webp,image/gif');
  input.onchange=handleSelect;
  const box=input.closest('.image-upload-box');if(!box)return;
  if(!$('multiImageNote')){
    const n=document.createElement('div');n.id='multiImageNote';n.innerHTML='📸 <b>Up to 8 photos</b> • You can select multiple photos together, or use <b>Add More Photos</b> one-by-one.';n.style.cssText='font-size:12px;color:#59636e;margin-top:9px;text-align:left';box.appendChild(n);
  }
  if(!$('addMoreImagesBtn')){
    const b=document.createElement('button');b.id='addMoreImagesBtn';b.type='button';b.textContent='＋ Add More Photos';b.className='btn secondary';b.style.cssText='margin-top:10px;width:100%;border-color:#ff9900;color:#111;background:#fffaf0';
    b.onclick=()=>{
      if(gallery.length>=MAX_IMAGES){msg(`Maximum ${MAX_IMAGES} photos allowed per product.`,'error');return;}
      input.multiple=true;
      input.click();
    };
    box.appendChild(b);
  }
  if(!$('multiImageGallery')){
    const g=document.createElement('div');g.id='multiImageGallery';g.style.cssText='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px;text-align:left';
    const preview=$('productImagePreview');
    if(preview?.parentNode)preview.parentNode.insertBefore(g,preview);else box.parentNode.appendChild(g);
  }
  renderGallery();
}
function revokeBlob(x){if(x?.preview&&x.preview.startsWith('blob:'))try{URL.revokeObjectURL(x.preview)}catch(_){} }
function renderGallery(){
  const wrap=$('multiImageGallery');if(!wrap)return;
  wrap.innerHTML='';
  gallery.forEach((item,index)=>{
    const url=item.preview||item.url;if(!url)return;
    const d=document.createElement('div');
    d.style.cssText='position:relative;border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#f7f8f8;aspect-ratio:1;cursor:zoom-in';
    d.innerHTML=`<img src="${esc(url)}" alt="Product photo ${index+1}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.opacity='.25'"><button type="button" data-remove="1" style="position:absolute;top:4px;right:4px;width:28px;height:28px;border-radius:50%;background:#d13212;color:#fff;font-weight:900;font-size:18px;line-height:28px">×</button><div style="position:absolute;left:4px;bottom:4px;background:#111820dd;color:#fff;font-size:10px;padding:3px 6px;border-radius:4px">${index===0?'MAIN':'PHOTO '+(index+1)}</div>`;
    d.addEventListener('click',e=>{if(e.target.closest('[data-remove]'))return;openImageViewer(index)});
    d.querySelector('[data-remove]').addEventListener('click',e=>{e.stopPropagation();const removed=gallery.splice(index,1)[0];revokeBlob(removed);renderGallery()});
    wrap.appendChild(d);
  });
  updateFileLabel();
}
function updateFileLabel(){
  if($('selectedFileName'))$('selectedFileName').textContent=gallery.length?`${gallery.length} photo(s) selected / saved`:'No image selected';
  if($('imageUploadStatus'))$('imageUploadStatus').textContent=gallery.length?`${gallery.length} photo(s) ready. Save product to upload changes.`:'';
  const main=gallery[0]?.url||gallery[0]?.preview;
  const preview=$('productImagePreview');
  if(preview&&main){preview.src=main;preview.style.display='block'}
  else if(preview){preview.style.display='none';preview.removeAttribute('src')}
}
function handleSelect(e){
  const files=[...(e.target.files||[])];
  e.target.value='';
  if(!files.length)return;
  if(gallery.length+files.length>MAX_IMAGES){msg(`Maximum ${MAX_IMAGES} photos allowed per product.`,'error');return;}
  for(const file of files){
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){msg('Only JPG, PNG, WEBP or GIF images are allowed.','error');return}
    if(file.size>MAX_SIZE){msg('Each image must be 5MB or smaller.','error');return}
  }
  files.forEach(file=>gallery.push({file,preview:URL.createObjectURL(file),url:''}));
  renderGallery();
}
function resetGallery(images=[]){
  gallery.forEach(revokeBlob);
  gallery=images.filter(Boolean).slice(0,MAX_IMAGES).map(url=>({url,preview:url,file:null}));
  if($('productImageFile'))$('productImageFile').value='';
  if($('productImage'))$('productImage').value=gallery[0]?.url||'';
  renderGallery();
}
async function getJSON(response){let data={};try{data=await response.json()}catch(_){}if(!response.ok)throw new Error(data.error||'Image upload failed');return data}
async function uploadFiles(files){
  if(!files.length)return[];
  const multi=new FormData();files.forEach(file=>multi.append('images',file));
  const multiResponse=await fetch('/api/seller/upload/images',{method:'POST',credentials:'include',body:multi});
  if(multiResponse.ok){const data=await multiResponse.json().catch(()=>({}));if(Array.isArray(data.images)&&data.images.length===files.length)return data.images;}
  const urls=[];
  for(const file of files){
    const form=new FormData();form.append('image',file);
    const response=await fetch('/api/seller/upload/image',{method:'POST',credentials:'include',body:form});
    const data=await getJSON(response);
    const url=data.image||data.url||data.imageUrl||data.secure_url||data.data?.image||data.data?.url;
    if(!url)throw new Error('Image uploaded but no image URL was returned.');
    urls.push(url);
  }
  return urls;
}
async function saveProduct(){
  const id=$('productId')?.value.trim()||'';
  const name=$('productName')?.value.trim()||'';
  const price=Number($('productPrice')?.value);
  const category=$('productCategory')?.value.trim()||'';
  const description=$('productDescription')?.value.trim()||'';
  const stock=Number($('productStock')?.value);
  const discount=Number($('productDiscount')?.value||0);
  if(!name)return alert('Product name is required.');
  if(!Number.isFinite(price)||price<0)return alert('Enter a valid product price.');
  if(!category)return alert('Product category is required.');
  if(!Number.isInteger(stock)||stock<0)return alert('Stock must be a whole number.');
  if(!Number.isFinite(discount)||discount<0||discount>=100)return alert('Discount must be between 0 and 99.99%.');
  if(gallery.length>MAX_IMAGES)return alert(`Maximum ${MAX_IMAGES} photos allowed.`);
  const button=$('saveProductButton');button.disabled=true;button.textContent='Saving...';
  try{
    const files=gallery.filter(x=>x.file).map(x=>x.file);
    if(files.length){
      if($('imageUploadStatus'))$('imageUploadStatus').textContent=`Uploading ${files.length} photo(s)...`;
      const uploaded=await uploadFiles(files);let n=0;
      gallery=gallery.map(item=>item.file?{url:uploaded[n],preview:uploaded[n++],file:null}:item);
    }
    let images=gallery.map(x=>x.url||x.preview).filter(Boolean).filter(u=>/^https?:\/\//i.test(String(u)));
    if(!images.length){const legacy=$('productImage')?.value.trim();if(legacy)images=[legacy]}
    if(!images.length)return alert('Please add at least one product image.');
    images=images.slice(0,MAX_IMAGES);
    const endpoint=id?'/api/seller/products/'+encodeURIComponent(id):'/api/seller/products';
    const response=await fetch(endpoint,{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,price,category,image:images[0],images,description,stock,discount_percent:discount})});
    const data=await getJSON(response);
    closeProductModal();
    msg(id?'Product updated successfully!':'Product added successfully!');
    if(typeof window.loadProducts==='function')await window.loadProducts();
    if(typeof window.loadDashboard==='function')await window.loadDashboard();
    return data;
  }catch(error){msg(error.message||'Unable to save product.','error');throw error}
  finally{button.disabled=false;button.textContent='Save Product'}
}
function openImageViewer(index,imagesOverride){
  const images=(imagesOverride||gallery.map(x=>x.url||x.preview).filter(Boolean)).slice(0,MAX_IMAGES);
  if(!images[index])return;
  let modal=$('sellerImageViewer');
  if(!modal){
    modal=document.createElement('div');modal.id='sellerImageViewer';modal.style.cssText='position:fixed;inset:0;background:#000e;z-index:2000;display:flex;align-items:center;justify-content:center;padding:18px';
    modal.innerHTML='<button id="sellerViewerClose" type="button" style="position:absolute;right:15px;top:15px;width:44px;height:44px;border-radius:50%;background:#fff;color:#111;font-size:27px;z-index:3">×</button><button id="sellerViewerPrev" type="button" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;background:#fff;color:#111;font-size:27px;z-index:3">‹</button><img id="sellerViewerImage" alt="Product image" style="max-width:94vw;max-height:86vh;object-fit:contain;border-radius:10px;background:#fff"><button id="sellerViewerNext" type="button" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;background:#fff;color:#111;font-size:27px;z-index:3">›</button><div id="sellerViewerCount" style="position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:7px 12px;border-radius:20px;font-size:13px"></div>';
    document.body.appendChild(modal);
    $('sellerViewerClose').onclick=()=>modal.remove();
    modal.onclick=e=>{if(e.target===modal)modal.remove()};
    document.addEventListener('keydown',function viewerKeys(e){if(!$('sellerImageViewer'))return;if(e.key==='Escape'){$('sellerImageViewer').remove();document.removeEventListener('keydown',viewerKeys)}if(e.key==='ArrowLeft')$('sellerViewerPrev')?.click();if(e.key==='ArrowRight')$('sellerViewerNext')?.click()});
  }
  let current=index;
  const render=()=>{$('sellerViewerImage').src=images[current];$('sellerViewerCount').textContent=`${current+1} / ${images.length}`;$('sellerViewerPrev').style.display=images.length>1?'block':'none';$('sellerViewerNext').style.display=images.length>1?'block':'none'};
  $('sellerViewerPrev').onclick=e=>{e.stopPropagation();current=(current-1+images.length)%images.length;render()};
  $('sellerViewerNext').onclick=e=>{e.stopPropagation();current=(current+1)%images.length;render()};
  render();
}
function findProductForCard(card){
  const edit=card.querySelector('button[onclick*="editProduct"]');
  const match=edit?.getAttribute('onclick')?.match(/editProduct\((\d+)\)/);
  if(match&&Array.isArray(window.currentProducts))return window.currentProducts.find(p=>Number(p.id)===Number(match[1]));
  const title=card.querySelector('.product-title')?.textContent?.trim();
  if(Array.isArray(window.currentProducts))return window.currentProducts.find(p=>String(p.name||'').trim()===title);
  return null;
}
function enhanceProductCards(){
  document.querySelectorAll('.product-card').forEach(card=>{
    const img=card.querySelector('.product-image');if(!img||img.dataset.viewerBound)return;
    img.dataset.viewerBound='1';img.style.cursor='zoom-in';
    img.addEventListener('click',()=>{const product=findProductForCard(card);const images=parseGallery(product);openImageViewer(0,images.length?images:[img.currentSrc||img.src])});
  });
}
function hook(){
  window.openAddProduct=function(){originalOpenAdd?.apply(this,arguments);ensureUI();resetGallery([])};
  window.editProduct=function(id){originalEdit?.apply(this,arguments);ensureUI();setTimeout(async()=>{try{const response=await fetch('/api/seller/products',{credentials:'include',cache:'no-store'});const data=await response.json();const product=(Array.isArray(data)?data:[]).find(p=>Number(p.id)===Number(id));resetGallery(parseGallery(product))}catch(_){resetGallery([])}},120)};
  window.saveProduct=saveProduct;
  if(typeof originalRender==='function')window.renderProducts=function(){originalRender.apply(this,arguments);setTimeout(enhanceProductCards,30)};
  setTimeout(enhanceProductCards,300);
}
function boot(){ensureUI();hook();enhanceProductCards();const modal=$('productModal');if(modal&&!modal.dataset.galleryObserver){modal.dataset.galleryObserver='1';new MutationObserver(ensureUI).observe(modal,{childList:true,subtree:true})}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();