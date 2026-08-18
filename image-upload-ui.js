(() => {
  const isSeller = location.pathname === '/seller';
  const createUrl = isSeller ? '/api/seller/products' : '/api/products';
  const imageUrl = isSeller ? '/api/seller/products/' : '/api/admin/products/';
  let pendingFile = null;
  let pendingStatus = null;
  let fetchHookInstalled = false;

  const okTypes = ['image/jpeg', 'image/png', 'image/webp'];

  function makeUploadBox(label, onFile) {
    const box = document.createElement('div');
    box.className = 'shrivi-image-upload-box';
    box.style.cssText = 'margin-top:10px;padding:12px;border:1px solid #d1d5db;border-radius:9px;background:#f9fafb;display:block';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'display:block;font-weight:bold;margin-bottom:8px';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.style.cssText = 'display:block;width:100%;padding:8px;background:#fff;border:1px solid #d1d5db;border-radius:7px';

    const status = document.createElement('div');
    status.style.cssText = 'margin-top:8px;font-size:13px;min-height:18px';

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!okTypes.includes(file.type)) {
        input.value = '';
        status.textContent = 'Only JPG, PNG and WEBP images are allowed.';
        status.style.color = '#991b1b';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        input.value = '';
        status.textContent = 'Image must be 5MB or smaller.';
        status.style.color = '#991b1b';
        return;
      }
      onFile(file, status, input);
    });

    box.append(labelEl, input, status);
    return { box, input, status };
  }

  async function uploadProductImage(id, file, status, input) {
    if (!id || !file) return false;
    status.textContent = 'Uploading image...';
    status.style.color = '#92400e';
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch(imageUrl + encodeURIComponent(id) + '/image', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin'
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Image upload failed');
      status.textContent = '✓ Image uploaded successfully.';
      status.style.color = '#166534';
      if (input) input.value = '';
      setTimeout(() => location.reload(), 250);
      return true;
    } catch (e) {
      status.textContent = e.message || 'Image upload failed';
      status.style.color = '#991b1b';
      return false;
    }
  }

  function productIdFromButton(btn) {
    const onclick = btn.getAttribute('onclick') || '';
    const m = onclick.match(/(?:editProduct|deleteProduct|toggleEdit)\s*\(\s*(\d+)\s*\)/i);
    if (m) return m[1];
    const card = btn.closest('.product-card,.product,article,li');
    if (!card) return null;
    return card.dataset.productId || card.dataset.id || null;
  }

  function addNewProductPicker() {
    const urlInput = document.getElementById('productImage');
    if (!urlInput || document.getElementById('shrivi-new-image-picker')) return;

    const holder = document.createElement('div');
    holder.id = 'shrivi-new-image-picker';
    const picker = makeUploadBox(
      'Product Image — select JPG / PNG / WEBP (max 5MB)',
      (file, status, input) => {
        pendingFile = file;
        pendingStatus = status;
        status.textContent = '✓ Image selected. Click Add Product; image will upload automatically after the product is created.';
        status.style.color = '#166534';
      }
    );
    holder.appendChild(picker.box);
    const parent = urlInput.closest('.form-group') || urlInput.parentElement;
    if (parent) parent.insertAdjacentElement('afterend', holder);
  }

  function addExistingProductPickers() {
    document.querySelectorAll('button').forEach(btn => {
      const text = (btn.textContent || '').toLowerCase();
      const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
      if (!text.includes('edit product') && !onclick.includes('editproduct') && !onclick.includes('toggleedit')) return;

      const card = btn.closest('.product-card,.product,article,li');
      if (!card || card.querySelector('.shrivi-existing-image-upload')) return;

      const id = productIdFromButton(btn);
      if (!id) return;

      const target = card.querySelector('.product-content,.product-body,.edit-box') || card;
      const picker = makeUploadBox(
        'Upload / Replace Product Image (max 5MB)',
        (file, status, input) => uploadProductImage(id, file, status, input)
      );
      picker.box.classList.add('shrivi-existing-image-upload');
      target.appendChild(picker.box);
    });
  }

  function installCreateHook() {
    if (fetchHookInstalled) return;
    fetchHookInstalled = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, options = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String(options.method || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();
      const creating = method === 'POST' && (url === createUrl || url.endsWith(createUrl));

      const response = await originalFetch(input, options);

      if (creating && pendingFile) {
        const file = pendingFile;
        const status = pendingStatus;
        pendingFile = null;
        pendingStatus = null;

        try {
          const data = await response.clone().json();
          const id = data?.id || data?.product?.id || data?.data?.id || data?.data?.product?.id;
          if (!response.ok) return response;
          if (!id) {
            if (status) {
              status.textContent = 'Product created, but product ID was not returned for image upload.';
              status.style.color = '#991b1b';
            }
            return response;
          }
          await uploadProductImage(id, file, status || { set textContent(v) {}, style: {} }, null);
        } catch (e) {
          if (status) {
            status.textContent = 'Product created, but image upload failed: ' + (e.message || 'unknown error');
            status.style.color = '#991b1b';
          }
        }
      }
      return response;
    };
  }

  function start() {
    addNewProductPicker();
    addExistingProductPickers();
    installCreateHook();

    const observer = new MutationObserver(() => {
      addNewProductPicker();
      addExistingProductPickers();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    [300, 1000, 2500, 5000].forEach(ms => setTimeout(() => {
      addNewProductPicker();
      addExistingProductPickers();
      installCreateHook();
    }, ms));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
