(() => {
  const MAX_IMAGES = 8;
  const originalOpenAdd = window.openAddProduct;
  const originalEdit = window.editProduct;
  let gallery = [];

  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
  function parseGallery(product){
    if(Array.isArray(product?.image_gallery)) return product.image_gallery.filter(Boolean);
    if(Array.isArray(product?.images)) return product.images.filter(Boolean);
    const raw=String(product?.image||'').trim();
    if(!raw) return [];
    try { const a=JSON.parse(raw); if(Array.isArray(a)) return a.filter(Boolean); } catch(e){}
    return [raw];
  }
  function ensureUI(){
    const input=$('productImageFile');
    if(!input || document.getElementById('multiImageGallery')) return;
    input.multiple=true;
    input.setAttribute('accept','image/jpeg,image/png,image/webp,image/gif');
    const box=input.closest('.image-upload-box');
    if(!box) return;
    const galleryBox=document.createElement('div');
    galleryBox.id='multiImageGallery';
    galleryBox.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;text-align:left';
    box.parentNode.insertBefore(galleryBox, $('productImagePreview'));
    const note=document.createElement('div');
    note.id='multiImageNote';
    note.textContent='Add up to 8 photos. The first photo will be your main listing image.';
    note.style.cssText='font-size:12px;color:#59636e;margin-top:8px';
    box.appendChild(note);
    input.onchange = handleMultiSelect;
  }
  function renderGallery(){
    const box=$('multiImageGallery');
    if(!box) return;
    box.innerHTML='';
    gallery.forEach((url,i)=>{
      const item=document.createElement('div');
      item.style.cssText='position:relative;border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#f7f8f8;aspect-ratio:1';
      item.innerHTML=`<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.opacity='.25'"><button type="button" data-index="${i}" style="position:absolute;top:4px;right:4px;width:26px;height:26px;border-radius:50%;background:#d13212;color:#fff;font-weight:900">×</button><div style="position:absolute;left:4px;bottom:4px;background:#111820dd;color:#fff;font-size:10px;padding:3px 5px;border-radius:4px">${i===0?'MAIN':'PHOTO '+(i+1)}</div>`;
      item.querySelector('button').onclick=()=>{ gallery.splice(i,1); renderGallery(); };
      box.appendChild(item);
    });
  }
  function handleMultiSelect(e){
    const files=[...(e.target.files||[])];
    if(files.length>MAX_IMAGES) return showError('Maximum 8 images allowed per product.');
    for(const f of files){
      if(!['image/jpeg','image/png','image/webp','image/gif'].includes(f.type)) return showError('Only JPG, PNG, WEBP or GIF images are allowed.');
      if(f.size>5*1024*1024) return showError('Each image must be 5MB or smaller.');
    }
    gallery=[];
    files.forEach(f=>{
      const r=new FileReader(); r.onload=ev=>{ gallery.push(ev.target.result); renderGallery(); }; r.readAsDataURL(f);
    });
    const name=$('selectedFileName'); if(name) name.textContent=files.length+' image(s) selected';
    const status=$('imageUploadStatus'); if(status) status.textContent='Ready to upload '+files.length+' image(s).';
  }
  function showError(msg){
    if(window.showMessage) window.showMessage('mainMessage',msg,'error'); else alert(msg);
    const input=$('productImageFile'); if(input) input.value='';
  }
  function resetGallery(images){
    gallery=parseGallery({image_gallery:images});
    renderGallery();
    const input=$('productImageFile'); if(input) input.value='';
    const name=$('selectedFileName'); if(name) name.textContent=gallery.length?gallery.length+' saved image(s)':'No image selected';
  }
  window.openAddProduct=function(){
    originalOpenAdd();
    ensureUI();
    gallery=[];
    renderGallery();
    const imageUrl=$('productImage'); if(imageUrl) imageUrl.value='';
  };
  window.editProduct=function(id){
    originalEdit(id);
    ensureUI();
    const product=(window.currentProducts||[]).find(p=>Number(p.id)===Number(id));
    resetGallery(parseGallery(product));
    const imageUrl=$('productImage'); if(imageUrl) imageUrl.value=gallery[0]||'';
  };
  window.saveProduct=async function(){
    const id=$('productId')?.value.trim();
    const name=$('productName')?.value.trim();
    const price=Number($('productPrice')?.value);
    const category=$('productCategory')?.value.trim();
    const description=$('productDescription')?.value.trim();
    const stock=Number($('productStock')?.value);
    const discount=Number($('productDiscount')?.value||0);
    const files=[...($('productImageFile')?.files||[])];
    if(!name)return alert('Product name is required.');
    if(!Number.isFinite(price)||price<0)return alert('Enter a valid product price.');
    if(!category)return alert('Product category is required.');
    if(!Number.isInteger(stock)||stock<0)return alert('Stock must be a whole number.');
    if(!Number.isFinite(discount)||discount<0||discount>=100)return alert('Discount must be between 0 and 99.99%.');
    if(files.length>MAX_IMAGES)return alert('Maximum 8 images allowed.');
    if(files.some(f=>f.size>5*1024*1024))return alert('Each image must be 5MB or smaller.');
    const btn=$('saveProductButton'); btn.disabled=true; btn.textContent='Saving...';
    try{
      let images=gallery.filter(u=>/^https?:\/\//i.test(u));
      if(files.length){
        const fd=new FormData(); files.forEach(f=>fd.append('images',f));
        const up=await fetch('/api/seller/upload/images',{method:'POST',credentials:'include',body:fd});
        const data=await up.json(); if(!up.ok)throw new Error(data.error||'Image upload failed');
        images=data.images||[];
      }
      if(!images.length){
        const url=$('productImage')?.value.trim();
        if(url) images=[url];
      }
      if(!images.length)return alert('Please add at least one product image.');
      const endpoint=id?'/api/seller/products/'+encodeURIComponent(id):'/api/seller/products';
      const method=id?'PUT':'POST';
      const response=await fetch(endpoint,{method,headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,price,category,image:images[0],images,description,stock,discount_percent:discount})});
      const data=await response.json(); if(!response.ok)throw new Error(data.error||'Unable to save product');
      closeProductModal();
      if(window.showMessage)showMessage('mainMessage',id?'Product updated successfully!':'Product added successfully!');
      await loadProducts(); await loadDashboard();
    }catch(e){ if(window.showMessage)showMessage('mainMessage',e.message||'Unable to save product.','error'); else alert(e.message); }
    finally{btn.disabled=false;btn.textContent='Save Product';}
  };
  function boot(){ ensureUI(); const modal=$('productModal'); if(modal){ const observer=new MutationObserver(()=>ensureUI()); observer.observe(modal,{childList:true,subtree:true}); } }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
