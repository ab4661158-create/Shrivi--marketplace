/* SHRIVI CUSTOMER PRODUCTION UI + API */
(function(){
  'use strict';
  const api=window.ShriviCustomerAPI={
    async request(url,options={}){const r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Request failed');return data;},
    me(){return this.request('/api/customer/me')}, orders(){return this.request('/api/customer/orders')},
    addresses(){return this.request('/api/customer/addresses')}, addAddress(d){return this.request('/api/customer/addresses',{method:'POST',body:JSON.stringify(d)})},
    reviews(id){return this.request('/api/products/'+encodeURIComponent(id)+'/reviews')}, addReview(id,d){return this.request('/api/products/'+encodeURIComponent(id)+'/reviews',{method:'POST',body:JSON.stringify(d)})},
    returns(id,d){return this.request('/api/customer/orders/'+encodeURIComponent(id)+'/return',{method:'POST',body:JSON.stringify(d)})},
    notifications(){return this.request('/api/customer/notifications')}
  };

  function toast(msg){if(window.showToast)return window.showToast(msg);const e=document.createElement('div');e.textContent=msg;e.style.cssText='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:99999;background:#111;color:#fff;padding:12px 18px;border-radius:12px;font-weight:700';document.body.appendChild(e);setTimeout(()=>e.remove(),2500);}
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function injectStyle(){if(document.getElementById('shrivi-production-ui'))return;const s=document.createElement('style');s.id='shrivi-production-ui';s.textContent=`
    .shrivi-tools{max-width:1200px;margin:18px auto;padding:16px;border-radius:18px;background:#fff;border:1px solid #e8e8e8;box-shadow:0 4px 18px rgba(0,0,0,.06)}
    .shrivi-tools h2{font-size:20px;margin-bottom:5px}.shrivi-tools p{color:#666;font-size:13px;margin-bottom:12px}
    .shrivi-tool-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}.shrivi-tool{border:1px solid #ddd;background:#fafafa;border-radius:12px;padding:11px;text-align:left;font-weight:700;cursor:pointer}.shrivi-tool small{display:block;color:#777;font-weight:400;margin-top:4px}
    .shrivi-panel{display:none;margin-top:12px;padding:14px;background:#fafafa;border-radius:14px;border:1px solid #eee}.shrivi-panel.open{display:block}.shrivi-list{display:grid;gap:8px}.shrivi-item{background:#fff;border:1px solid #eee;border-radius:10px;padding:10px}.shrivi-form{display:grid;gap:8px}.shrivi-form input,.shrivi-form textarea,.shrivi-form select{padding:10px;border:1px solid #ddd;border-radius:9px}.shrivi-form button{padding:10px;border:0;border-radius:9px;background:#111;color:#fff;font-weight:700}
    .shrivi-review-btn{margin-top:7px;width:100%;border:1px solid #ddd;border-radius:9px;background:#fff;padding:8px;font-weight:700}.shrivi-badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#eee;font-size:11px;margin-left:5px}
  `;document.head.appendChild(s);}

  function panel(){if(document.getElementById('shrivi-tools'))return;injectStyle();const wrap=document.createElement('section');wrap.id='shrivi-tools';wrap.className='shrivi-tools';wrap.innerHTML=`<h2>✨ SHRIVI Smart Shopping</h2><p>Amazon-style tools — connected to your Shrivi account and marketplace data.</p><div class="shrivi-tool-grid">
    <button class="shrivi-tool" data-tool="account">👤 Account<small>Login status</small></button>
    <button class="shrivi-tool" data-tool="orders">📦 My Orders<small>Live order data</small></button>
    <button class="shrivi-tool" data-tool="addresses">📍 Addresses<small>Save delivery address</small></button>
    <button class="shrivi-tool" data-tool="reviews">⭐ Reviews<small>Ratings & reviews</small></button>
    <button class="shrivi-tool" data-tool="returns">🔄 Returns<small>Request a return</small></button>
    <button class="shrivi-tool" data-tool="notifications">🔔 Notifications<small>Order updates</small></button>
  </div><div id="shrivi-tool-panel" class="shrivi-panel"></div>`;
    const container=document.querySelector('.container')||document.body;container.prepend(wrap);wrap.addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b)openTool(b.dataset.tool);});
  }

  async function openTool(tool){const p=document.getElementById('shrivi-tool-panel');if(!p)return;p.classList.add('open');p.innerHTML='<b>Loading…</b>';
    try{
      if(tool==='account'){const d=await api.me();p.innerHTML=d.loggedIn?`<b>Welcome, ${esc(d.customer.name)}</b><p>Account is connected.</p>`:'<b>Not logged in.</b><p>Use the Account button above to login/register.</p>';return;}
      if(tool==='orders'){const d=await api.orders();const a=d.orders||d; p.innerHTML='<h3>📦 My Orders</h3><div class="shrivi-list">'+(Array.isArray(a)&&a.length?a.map(o=>`<div class="shrivi-item"><b>Order #${esc(o.id)}</b> — ₹${esc(o.total)} <span class="shrivi-badge">${esc(o.status||'pending')}</span><button class="shrivi-review-btn" data-return-order="${esc(o.id)}">🔄 Request Return</button></div>`).join(''):'<div class="shrivi-item">No orders found.</div>')+'</div>';return;}
      if(tool==='addresses'){const d=await api.addresses();const a=d.addresses||[];p.innerHTML=`<h3>📍 Delivery Addresses</h3><div class="shrivi-list">${a.map(x=>`<div class="shrivi-item"><b>${esc(x.label)}</b> — ${esc(x.full_name)}<br>${esc(x.line1)}, ${esc(x.city)}, ${esc(x.state)} - ${esc(x.pincode)}<br>📞 ${esc(x.phone)}</div>`).join('')||'<div class="shrivi-item">No saved addresses.</div>'}</div><hr style="margin:12px 0;border:0;border-top:1px solid #ddd"><form class="shrivi-form" id="shrivi-address-form"><input name="full_name" placeholder="Full name" required><input name="phone" placeholder="10-digit phone" required><input name="line1" placeholder="Address" required><input name="city" placeholder="City" required><input name="state" placeholder="State" required><input name="pincode" placeholder="6-digit pincode" required><button>Save Address</button></form>`;document.getElementById('shrivi-address-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api.addAddress(Object.fromEntries(f.entries()));toast('Address saved');openTool('addresses')}catch(x){toast(x.message)}};return;}
      if(tool==='notifications'){const d=await api.notifications();const a=d.notifications||[];p.innerHTML='<h3>🔔 Notifications</h3><div class="shrivi-list">'+(a.length?a.map(x=>`<div class="shrivi-item"><b>${esc(x.title)}</b><br>${esc(x.message)}<br><small>${new Date(x.created_at).toLocaleString()}</small></div>`).join(''):'<div class="shrivi-item">No notifications yet.</div>')+'</div>';return;}
      if(tool==='reviews'){p.innerHTML='<h3>⭐ Product Reviews</h3><p>Select a product below and use its Review button.</p>';return;}
      if(tool==='returns'){const d=await api.orders();const a=d.orders||d;p.innerHTML='<h3>🔄 Returns & Replacements</h3><div class="shrivi-list">'+(Array.isArray(a)&&a.length?a.map(o=>`<div class="shrivi-item"><b>Order #${esc(o.id)}</b><br>Status: ${esc(o.status||'pending')}<button class="shrivi-review-btn" data-return-order="${esc(o.id)}">Request Return / Replacement</button></div>`).join(''):'<div class="shrivi-item">Login and place an order first.</div>')+'</div>';return;}
    }catch(e){p.innerHTML=`<div class="shrivi-item">${esc(e.message)}<br><small>Please login to use this feature.</small></div>`;}
  }

  async function addReviewButton(){try{const products=await (await fetch('/api/products')).json();const cards=[...document.querySelectorAll('.card')];cards.forEach(card=>{if(card.querySelector('.shrivi-review-btn'))return;const name=card.querySelector('.product-name')?.textContent?.trim();const product=products.find(x=>x.name===name);if(!product)return;const b=document.createElement('button');b.className='shrivi-review-btn';b.textContent='⭐ Reviews';b.onclick=async()=>{try{const d=await api.reviews(product.id);const rating=prompt(`Average ${d.average||0}/5 — ${d.count||0} reviews.\nEnter rating 1-5 to add/update your review:`);if(rating===null)return;const text=prompt('Write your review:')||'';await api.addReview(product.id,{rating:Number(rating),review_text:text});toast('Review submitted');}catch(e){toast(e.message)}};card.appendChild(b);});}catch(e){}
  }

  document.addEventListener('click',async e=>{const b=e.target.closest('[data-return-order]');if(!b)return;const reason=prompt('Why do you want to return/replace this order?');if(!reason)return;try{await api.returns(b.dataset.returnOrder,{reason,type:'return'});toast('Return request submitted');openTool('returns');}catch(x){toast(x.message)}});
  document.addEventListener('DOMContentLoaded',()=>{panel();setTimeout(addReviewButton,700);setInterval(addReviewButton,2500);});
})();
