(() => {
  "use strict";

  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const TIMEOUT = 60000;

  const $ = id => document.getElementById(id);

  function message(text, type = "success") {
    const el = $("mainMessage");
    if (!el) return alert(text);
    el.textContent = text;
    el.className = "message " + (type === "error" ? "error-message" : "success-message");
    el.style.display = "block";
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      return await fetch(url, {
        ...options,
        credentials: "include",
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Request timed out. Please try again.");
      throw new Error(error.message || "Network request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function validate(file) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Only JPG, PNG and WEBP images are allowed.");
    if (file.size > MAX_SIZE) throw new Error("Image must be 5MB or smaller.");
  }

  async function uploadForProduct(productId, file) {
    validate(file);
    const form = new FormData();
    form.append("image", file);
    const response = await request(`/api/seller/products/${encodeURIComponent(productId)}/image`, {
      method: "POST",
      body: form
    });
    const data = await readJson(response);
    const url = data.url || data.secure_url || data.product?.image || data.image;
    if (!url) throw new Error("Image upload completed but no image URL was returned.");
    return url;
  }

  window.saveProduct = async function () {
    const id = $("productId").value.trim();
    const name = $("productName").value.trim();
    const price = Number($("productPrice").value);
    const category = $("productCategory").value.trim();
    const imageInput = $("productImage");
    let image = imageInput.value.trim();
    const description = $("productDescription").value.trim();
    const stock = Number($("productStock").value);
    const discount = Number($("productDiscount").value || 0);
    const file = $("productImageFile").files?.[0] || null;
    const button = $("saveProductButton");

    if (!name) return alert("Product name is required.");
    if (!Number.isFinite(price) || price < 0) return alert("Enter a valid product price.");
    if (!category) return alert("Product category is required.");
    if (!Number.isInteger(stock) || stock < 0) return alert("Stock must be a whole number.");
    if (!Number.isFinite(discount) || discount < 0 || discount >= 100) return alert("Discount must be between 0 and 99.99%.");

    try {
      validate(file);
      if (image && !file) new URL(image);
    } catch (error) {
      return alert(error.message);
    }

    button.disabled = true;
    button.textContent = "Saving...";

    try {
      // Save the listing first. This guarantees a product ID before image upload.
      const endpoint = id ? `/api/seller/products/${encodeURIComponent(id)}` : "/api/seller/products";
      const response = await request(endpoint, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, category, image: file ? "" : image, description, stock, discount_percent: discount })
      });

      const data = await readJson(response);
      const productId = Number(id || data?.product?.id || data?.id || data?.product_id);
      if (!productId) throw new Error("Product saved, but no product ID was returned.");

      // Upload through the endpoint that also writes the Cloudinary URL into products.image.
      if (file) {
        if ($("imageUploadStatus")) $("imageUploadStatus").textContent = "Uploading image...";
        image = await uploadForProduct(productId, file);
        imageInput.value = image;
        if ($("imageUploadStatus")) $("imageUploadStatus").textContent = "Image saved successfully.";
      }

      closeProductModal();
      message(id ? "Product updated successfully!" : "Product added successfully!", "success");

      // Refresh is deliberately non-blocking for the save result.
      Promise.resolve().then(() => loadProducts()).catch(console.warn);
      Promise.resolve().then(() => loadDashboard()).catch(console.warn);
    } catch (error) {
      console.error("Shrivi save product:", error);
      message(error.message || "Failed to save product.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save Product";
    }
  };
})();
