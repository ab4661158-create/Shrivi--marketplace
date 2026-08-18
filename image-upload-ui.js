(() => {
  const seller = location.pathname === '/seller';
  const base = seller ? '/api/seller/products/' : '/api/admin/products/';
  let products = [], pending = null, pendingStatus = null, adminHook = false, sellerHook = false;

  const idOf = d => d?.id || d?.product?.id || d?.data?.id || d?.data?.product?.id || null;

  function box(labelText, onFile) {
    const w = document.createElement('div');
    w.className = 'shrivi-image-upload-box';
    w.style.cssText = 'margin-top:10px;padding:12px;border:1px solid #d1d5db;border-radius:9px;background:#f9fafb;display:block';
    const l = document.createElement('label');
    l.textContent = labelText;
    l.style.cssText = 'display:block;font-weight:bold;margin-bottom:8px';
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp';
    i.style.cssText = 'display:block;width:100%;padding:8px;background:#fff;border:1px solid #d1d5db;border-radius:7px';
    const s = document.createElement('div');
    s.style.cssText = 'margin-top:8px;font-size:13px';
    i.onchange = () => {
      const f = i.files?.[0]; if (!f) return;
      if (f.size > 5*1024*1024) { i.value=''; s.textContent='Image must be 5MB or smaller.'; return; }
      if (!['image/jpeg','image/png','image/webp'].includes(f.type)) { i.value=''; s.textContent='Only JPG, PNG and WEBP images are allowed.'; return; }
      onFile(f,s,i);
    };
    w.append(l,i,s); return {w,i,s};
  }

  async function upload(pid,file,status,input) {
    if (!pid || !file) return;
    const fd = new FormData(); fd.append('image',file);
    if(status) status.textContent='Uploading image...';
    try {
      const r = await fetch(base + pid + '/image',{method:'POST',body:fd,credentials:'same-origin'});
      const d = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error || 'Image upload failed');
      if(status) status.textContent='Image uploaded successfully.';
      if(input) input.value=''; pending=null; pendingStatus=null;
      if(typeof window.loadAdminProducts==='function') await window.loadAdminProducts();
      if(typeof window.loadSellerProducts==='function') await window.loadSellerProducts();
      setTimeout(startControls,200);
    } catch(e) { if(status) status.textContent=e.message || 'Image upload failed'; }
  }

  async function loadProducts(){
    try { const r=await fetch(seller?'/api/seller/products':'/api/admin/products',{credentials:'same-origin'}); const d=await r.json(); products=Array.isArray(d)?d:(d.products||[]); } catch(_) {}
  }

  function addPicker(){
    const input=document.getElementById('productImage');
    if(!input || document.getElementById('shrivi-add-image-upload')) return;
    const h=document.createElement('div'); h.id='shrivi-add-image-upload';
    const b=box('Upload Product Image (JPG / PNG / WEBP, max 5MB)',(f,s)=>{pending=f;pendingStatus=s;s.textContent=`Selected: ${f.name} — save/add the product to upload.`;});
    h.appendChild(b.w);
    const g=input.closest('.form-group');
    (g ? g : input).insertAdjacentElement('afterend',h);
  }

  function productId(button){
    const o=button.getAttribute('onclick')||'';
    const m=o.match(/(?:editProduct|deleteProduct|toggleEdit)\s*\(\s*(\d+)\s*\)/i); if(m) return m[1];
    if(button.dataset.productId && /^\d+$/.test(button.dataset.productId)) return button.dataset.productId;
    const c=button.closest('.product-card,.product,article,li'); if(!c) return null;
    const x=c.querySelector('[data-product-id],[data-id]');
    const n=x?.dataset?.productId||x?.dataset?.id; if(n&&/^\d+$/.test(n)) return n;
    const name=c.querySelector('h3,h4')?.textContent?.trim();
    return name ? String(products.find(p=>String(p.name||'').trim()===name)?.id||'') : null;
  }

  async function startControls(){
    if(!document.body) return;
    addPicker();
    if(!products.length) await loadProducts();
    document.querySelectorAll('button').forEach(btn=>{
      const t=(btn.textContent||'').toLowerCase(), o=(btn.getAttribute('onclick')||'').toLowerCase();
      if(!t.includes('edit product')&&!o.includes('editproduct')&&!o.includes('toggleedit')) return;
      if(btn.dataset.imageUploadReady==='1') return;
      const pid=productId(btn), card=btn.closest('.product-card,.product,article,li'); if(!pid||!card) return;
      const content=card.querySelector('.product-content,.product-body,.edit-box')||card;
      if(content.querySelector('.shrivi-existing-image-upload')) {btn.dataset.imageUploadReady='1';return;}
      btn.dataset.imageUploadReady='1';
      const b=box('Upload Product Image (JPG / PNG / WEBP, max 5MB)',(f,s,i)=>upload(pid,f,s,i));
      b.w.classList.add('shrivi-existing-image-upload'); content.appendChild(b.w);
    });
  }

  function adminAddHook(){
    if(seller||adminHook||typeof window.apiFetch!=='function') return;
    const old=window.apiFetch;
    window.apiFetch=async function(url,opt={}){
      const out=await old.apply(this,arguments);
      if(String(opt.method||'GET').toUpperCase()==='POST' && url==='/api/products' && pending){
        const f=pending,s=pendingStatus,pid=idOf(out);
        if(pid) await upload(pid,f,s); else if(s) s.textContent='Product created, but image upload could not find the product ID.';
      }
      return out;
    }; adminHook=true;
  }

  function sellerAddHook(){
    if(!seller||sellerHook) return;
    const old=window.fetch.bind(window);
    window.fetch=async function(input,opt={}){
      const url=typeof input==='string'?input:(input?.url||'');
      const method=String(opt.method||(typeof input!=='string'?input?.method:'GET')||'GET').toUpperCase();
      const create=method==='POST'&&(url==='/api/seller/products'||url.endsWith('/api/seller/products'));
      const r=await old(input,opt);
      if(create&&pending){
        try{
          const d=await r.clone().json(),pid=idOf(d),f=pending,s=pendingStatus;
          if(pid) await upload(pid,f,s); else if(s) s.textContent='Product created, but image upload could not find the product ID.';
        }catch(_){ if(pendingStatus) pendingStatus.textContent='Product created, but image upload could not start.'; }
      }
      return r;
    }; sellerHook=true;
  }

  function start(){
    adminAddHook(); sellerAddHook(); startControls();
    new MutationObserver(()=>{adminAddHook();sellerAddHook();startControls();}).observe(document.documentElement,{childList:true,subtree:true});
    [300,1000,2500,5000].forEach(ms=>setTimeout(()=>{adminAddHook();sellerAddHook();startControls();},ms));
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
