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
      // Keep existing page functionality working even if this helper fails.
    } finally {
      loadingProducts = false;
    }
    return products;
  }

  function styleBox(wrapper) {
    wrapper.style.marginTop = "10px";
    wrapper.style.padding = "10px";
    wrapper.style.border = "1px solid #e5e7eb";
    wrapper.style.borderRadius = "8px";
    wrapper.style.background = "#f9fafb";
  }

  function makeFileInput(labelText, onSelected) {
    const wrapper = document.createElement("div");
    wrapper.className = "shrivi-image-upload-box";
    styleBox(wrapper);

    const label = document.createElement("label");
    label.textContent = labelText;
    label.style.display = "block";
    label.style.fontWeight = "bold";
    label.style.marginBottom = "6px";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.style.width = "100%";
    input.style.marginBottom = "7px";

    const status = document.createElement("div");
    status.style.marginTop = "7px";
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
      status.textContent = `Selected: ${file.name}`;
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
      if (typeof window.loadProducts === "function") await window.loadProducts();
      setTimeout(addUploadControls, 150);
      return true;
    } catch (error) {
      status.textContent = error.message || "Image upload failed";
      return false;
    }
  }

  function getProductIdFromButton(button) {
    const onclick = button.getAttribute("onclick") || "";
    let match = onclick.match(/(?:editProduct|deleteProduct|toggleEdit)\s*\(\s*(\d+)\s*\)/i);
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

  async function addUploadControls() {
    if (!document.body) return;

    // Add a real file picker to the Add Product form. The selected file is uploaded
    // automatically immediately after the existing product-creation request succeeds.
    if (isAdmin && !document.getElementById("shrivi-add-image-upload")) {
      const imageInput = document.getElementById("productImage");
      if (imageInput) {
        const holder = document.createElement("div");
        holder.id = "shrivi-add-image-upload";
        const made = makeFileInput(
          "Product Image Upload (JPG/PNG/WEBP, max 5MB)",
          (file, status) => {
            pendingAddImage = file;
            addUploadStatus = status;
            status.textContent = "Image selected. Click Add Product to upload it.";
          }
        );
        holder.appendChild(made.wrapper);
        imageInput.closest(".form-group")?.after(holder);
      }
    }

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
        "Product Image Upload (JPG/PNG/WEBP, max 5MB)",
        (file, status, input) => uploadProductImage(productId, file, status, input)
      );
      made.wrapper.dataset.productId = productId;
      content.appendChild(made.wrapper);
    });
  }

  function installAddProductHook() {
    if (!isAdmin || apiFetchWrapped) return;
    if (typeof window.apiFetch !== "function") return;

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
          status.textContent = "Product created, but its ID was not returned. Upload the image from Product Management.";
        }
      }
      return result;
    };
    apiFetchWrapped = true;
  }

  const observer = new MutationObserver(() => {
    installAddProductHook();
    addUploadControls();
  });

  function start() {
    installAddProductHook();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    addUploadControls();
    setTimeout(() => { installAddProductHook(); addUploadControls(); }, 300);
    setTimeout(() => { installAddProductHook(); addUploadControls(); }, 1000);
    setTimeout(() => { installAddProductHook(); addUploadControls(); }, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
