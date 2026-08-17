(() => {
  const isSeller = location.pathname === "/seller";
  const endpointBase = isSeller ? "/api/seller/products/" : "/api/admin/products/";
  const isAdmin = !isSeller;

  let products = [];
  let loadingProducts = false;
  let pendingAddImage = null;
  let addUploadStatus = null;
  let originalApiFetch = null;
  let apiFetchWrapped = false;

  function productIdFromResponse(data) {
    return data?.id || data?.product?.id || data?.data?.id || data?.data?.product?.id || null;
  }

  async function getProducts() {
    if (loadingProducts) return products;
    loadingProducts = true;
    try {
      const url = isSeller ? "/api/seller/products" : "/api/admin/products";
      const response = await fetch(url, { credentials: "same-origin" });
      if (response.ok) {
        const data = await response.json();
        products = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
      }
    } catch (_) {
    } finally {
      loadingProducts = false;
    }
    return products;
  }

  function styleBox(wrapper) {
    wrapper.style.marginTop = "10px";
    wrapper.style.padding = "12px";
    wrapper.style.border = "1px solid #d1d5db";
    wrapper.style.borderRadius = "9px";
    wrapper.style.background = "#f9fafb";
    wrapper.style.display = "block";
  }

  function makeFileInput(labelText, onSelected) {
    const wrapper = document.createElement("div");
    wrapper.className = "shrivi-image-upload-box";
    styleBox(wrapper);

    const label = document.createElement("label");
    label.textContent = labelText;
    label.style.display = "block";
    label.style.fontWeight = "bold";
    label.style.marginBottom = "8px";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.style.display = "block";
    input.style.width = "100%";
    input.style.padding = "8px";
    input.style.background = "white";
    input.style.border = "1px solid #d1d5db";
    input.style.borderRadius = "7px";

    const status = document.createElement("div");
    status.style.marginTop = "8px";
    status.style.fontSize = "13px";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        input.value = "";
        status.textContent = "Image must be 5MB or smaller.";
        return;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        input.value = "";
        status.textContent = "Only JPG, PNG and WEBP images are allowed.";
        return;
      }
      onSelected(file, status, input);
    });

    wrapper.append(label, input, status);
    return { wrapper, input, status };
  }

  async function uploadProductImage(productId, file, status, input) {
    if (!productId || !file) return false;
    const formData = new FormData();
    formData.append("image", file);
    status.textContent = "Uploading image...";
    try {
      const response = await fetch(`${endpointBase}${productId}/image`, {
        method: "POST",
        body: formData,
        credentials: "same-origin"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Image upload failed");
      status.textContent = "Image uploaded successfully.";
      if (input) input.value = "";
      if (typeof window.loadAdminProducts === "function") await window.loadAdminProducts();
      if (typeof window.loadSellerProducts === "function") await window.loadSellerProducts();
      setTimeout(addUploadControls, 150);
      return true;
    } catch (error) {
      status.textContent = error.message || "Image upload failed";
      return false;
    }
  }

  function getProductIdFromButton(button) {
    const onclick = button.getAttribute("onclick") || "";
    const match = onclick.match(/(?:editProduct|deleteProduct|toggleEdit)\s*\(\s*(\d+)\s*\)/i);
    if (match) return match[1];
    const dataId = button.dataset.productId || button.dataset.id;
    if (dataId && /^\d+$/.test(dataId)) return dataId;
    const card = button.closest(".product-card, .product, article, li");
    if (!card) return null;
    const explicit = card.querySelector("[data-product-id], [data-id]");
    const explicitId = explicit?.dataset?.productId || explicit?.dataset?.id;
    if (explicitId && /^\d+$/.test(explicitId)) return explicitId;
    const name = card.querySelector("h3, h4")?.textContent?.trim();
    if (!name) return null;
    const found = products.find(p => String(p.name || "").trim() === name);
    return found ? String(found.id) : null;
  }

  function addAdminAddProductPicker() {
    if (!isAdmin) return;
    const imageInput = document.getElementById("productImage");
    if (!imageInput || document.getElementById("shrivi-add-image-upload")) return;

    const holder = document.createElement("div");
    holder.id = "shrivi-add-image-upload";
    const made = makeFileInput(
      "Upload Product Image (JPG / PNG / WEBP, max 5MB)",
      (file, status) => {
        pendingAddImage = file;
        addUploadStatus = status;
        status.textContent = `Selected: ${file.name} — click Add Product to upload.`;
      }
    );
    holder.appendChild(made.wrapper);

    const formGroup = imageInput.closest(".form-group");
    if (formGroup) {
      formGroup.insertAdjacentElement("afterend", holder);
    } else {
      imageInput.insertAdjacentElement("afterend", holder);
    }
  }

  async function addUploadControls() {
    if (!document.body) return;
    addAdminAddProductPicker();

    const buttons = [...document.querySelectorAll("button")].filter(button => {
      const text = (button.textContent || "").trim().toLowerCase();
      const onclick = (button.getAttribute("onclick") || "").toLowerCase();
      return text.includes("edit product") || onclick.includes("editproduct") || onclick.includes("toggleedit");
    });

    if (!buttons.length) return;
    if (!products.length) await getProducts();

    buttons.forEach(button => {
      if (button.dataset.imageUploadReady === "1") return;
      const productId = getProductIdFromButton(button);
      if (!productId) return;
      const card = button.closest(".product-card, .product, article, li");
      if (!card) return;
      const content = card.querySelector(".product-content, .product-body, .edit-box") || card;
      if (content.querySelector(`.shrivi-image-upload-box[data-product-id="${productId}"]`)) {
        button.dataset.imageUploadReady = "1";
        return;
      }
      button.dataset.imageUploadReady = "1";
      const made = makeFileInput(
        "Upload Product Image (JPG / PNG / WEBP, max 5MB)",
        (file, status, input) => uploadProductImage(productId, file, status, input)
      );
      made.wrapper.dataset.productId = productId;
      content.appendChild(made.wrapper);
    });
  }

  function installAddProductHook() {
    if (!isAdmin || apiFetchWrapped || typeof window.apiFetch !== "function") return;
    originalApiFetch = window.apiFetch;
    window.apiFetch = async function(url, options = {}) {
      const result = await originalApiFetch.apply(this, arguments);
      const method = String(options?.method || "GET").toUpperCase();
      if (method === "POST" && url === "/api/products" && pendingAddImage) {
        const file = pendingAddImage;
        const status = addUploadStatus;
        pendingAddImage = null;
        addUploadStatus = null;
        const id = productIdFromResponse(result);
        if (id) {
          if (status) status.textContent = "Product created. Uploading image...";
          await uploadProductImage(id, file, status || document.createElement("div"));
        } else if (status) {
          status.textContent = "Product created, but image upload could not find the product ID.";
        }
      }
      return result;
    };
    apiFetchWrapped = true;
  }

  function start() {
    installAddProductHook();
    addUploadControls();
    const observer = new MutationObserver(() => {
      installAddProductHook();
      addUploadControls();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    [300, 1000, 2500, 5000].forEach(ms => setTimeout(() => {
      installAddProductHook();
      addUploadControls();
    }, ms));
    window.addEventListener("load", () => {
      installAddProductHook();
      addUploadControls();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
