(() => {
  const isSeller = location.pathname === "/seller";
  const endpointBase = isSeller
    ? "/api/seller/products/"
    : "/api/admin/products/";

  let products = [];
  let loadingProducts = false;

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
      // Existing page functionality remains untouched if this helper cannot load.
    } finally {
      loadingProducts = false;
    }

    return products;
  }

  function getProductIdFromButton(button) {
    const onclick = button.getAttribute("onclick") || "";
    const match = onclick.match(/(?:editProduct|deleteProduct)\s*\(\s*(\d+)\s*\)/i);
    if (match) return match[1];

    const dataId = button.dataset.productId || button.dataset.id;
    if (dataId && /^\d+$/.test(dataId)) return dataId;

    const card = button.closest(".product-card, .product, article, li, div");
    if (!card) return null;

    const explicit = card.querySelector("[data-product-id], [data-id]");
    const explicitId = explicit?.dataset?.productId || explicit?.dataset?.id;
    if (explicitId && /^\d+$/.test(explicitId)) return explicitId;

    const nameElement = card.querySelector("h3, h4");
    const name = nameElement?.textContent?.trim();
    if (!name) return null;

    const found = products.find(p => String(p.name || "").trim() === name);
    return found ? String(found.id) : null;
  }

  function buildUploader(productId) {
    const wrapper = document.createElement("div");
    wrapper.className = "shrivi-image-upload-box";
    wrapper.style.marginTop = "10px";
    wrapper.style.padding = "10px";
    wrapper.style.border = "1px solid #e5e7eb";
    wrapper.style.borderRadius = "8px";
    wrapper.style.background = "#f9fafb";

    const label = document.createElement("label");
    label.textContent = "Product Image (JPG/PNG/WEBP, max 5MB)";
    label.style.display = "block";
    label.style.fontWeight = "bold";
    label.style.marginBottom = "6px";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.style.width = "100%";
    input.style.marginBottom = "7px";

    const uploadButton = document.createElement("button");
    uploadButton.type = "button";
    uploadButton.textContent = "Upload Image";
    uploadButton.style.background = "#111827";
    uploadButton.style.color = "white";
    uploadButton.style.border = "0";
    uploadButton.style.borderRadius = "7px";
    uploadButton.style.padding = "9px 12px";
    uploadButton.style.cursor = "pointer";
    uploadButton.style.fontWeight = "bold";

    const status = document.createElement("div");
    status.style.marginTop = "7px";
    status.style.fontSize = "13px";

    uploadButton.addEventListener("click", async () => {
      const file = input.files?.[0];
      if (!file) {
        status.textContent = "Select an image first.";
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        status.textContent = "Image must be 5MB or smaller.";
        return;
      }

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        status.textContent = "Only JPG, PNG and WEBP images are allowed.";
        return;
      }

      const formData = new FormData();
      formData.append("image", file);

      uploadButton.disabled = true;
      uploadButton.textContent = "Uploading...";
      status.textContent = "Uploading securely to Cloudinary...";

      try {
        const response = await fetch(`${endpointBase}${productId}/image`, {
          method: "POST",
          body: formData,
          credentials: "same-origin"
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Image upload failed");

        status.textContent = "Image uploaded successfully.";
        input.value = "";

        if (typeof window.loadProducts === "function") await window.loadProducts();
        if (typeof window.loadSellerProducts === "function") await window.loadSellerProducts();

        setTimeout(addUploadControls, 100);
      } catch (error) {
        status.textContent = error.message || "Image upload failed";
      } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = "Upload Image";
      }
    });

    wrapper.append(label, input, uploadButton, status);
    return wrapper;
  }

  async function addUploadControls() {
    const buttons = [...document.querySelectorAll("button")].filter(button => {
      const text = (button.textContent || "").trim().toLowerCase();
      const onclick = (button.getAttribute("onclick") || "").toLowerCase();
      return text.includes("edit product") || onclick.includes("editproduct");
    });

    if (!buttons.length) return;
    if (!products.length) await getProducts();

    buttons.forEach(button => {
      if (button.dataset.imageUploadReady === "1") return;

      const productId = getProductIdFromButton(button);
      if (!productId) return;

      const card = button.closest(".product-card, .product, article, li, div");
      if (!card) return;

      button.dataset.imageUploadReady = "1";

      const content = card.querySelector(".product-content, .product-body, .edit-box") || card;
      if (content.querySelector(`.shrivi-image-upload-box[data-product-id="${productId}"]`)) return;

      const uploader = buildUploader(productId);
      uploader.dataset.productId = productId;
      content.appendChild(uploader);
    });
  }

  const observer = new MutationObserver(() => {
    addUploadControls();
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    addUploadControls();
    setTimeout(addUploadControls, 500);
    setTimeout(addUploadControls, 1500);
    setTimeout(addUploadControls, 3000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
