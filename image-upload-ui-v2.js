(() => {
  "use strict";
  const MAX_SIZE = 5 * 1024 * 1024;
  const TYPES = ["image/jpeg", "image/png", "image/webp"];
  const $ = id => document.getElementById(id);

  function message(text, type = "success") {
    const el = $("mainMessage");
    if (!el) return alert(text);
    el.textContent = text;
    el.className = "message " + (type === "error" ? "error-message" : "success-message");
    el.style.display = "block";
  }

  async function request(url, options = {}, timeout = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...options, credentials: "include", signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Request timed out. Please try again.");
      throw new Error(error.message || "Network request failed");
    } finally { clearTimeout(timer); }
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function validate(file) {
    if (!file) return;
    if (!TYPES.includes(file.type)) throw new Error("Only JPG, PNG and WEBP images are allowed.");
    if (file.size > MAX_SIZE) throw new Error("Image must be 5MB or smaller.");
  }

  async function uploadImage(file) {
    validate(file);
    const form = new FormData();
    form.append("image", file);
    const response = await request("/api/seller/upload/image", { method: "POST", body: form }, 25000);
    const data = await readJson(response);
    const url = data.url || data.secure_url || data.image || data.imageUrl;
    if (!url) throw new Error("Image upload completed but no image URL was returned.");
    return url;
  }

  window.saveProduct = async function () {
    const button = $("saveProductButton");
    if (!button || button.disabled) return;

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

    if (!name) return alert("Product name is required.");
    if (!Number.isFinite(price) || price < 0) return alert("Enter a valid product price.");
    if (!category) return alert("Product category is required.");
    if (!Number.isInteger(stock) || stock < 0) return alert("Stock must be a whole number.");
    if (!Number.isFinite(discount) || discount < 0 || discount >= 100) return alert("Discount must be between 0 and 99.99%.");
    try { validate(file); if (image && !file) new URL(image); } catch (e) { return alert(e.message); }

    button.disabled = true;
    button.textContent = "Saving...";

    try {
      // Save listing first so the product is never lost because image hosting is slow.
      const endpoint = id ? `/api/seller/products/${encodeURIComponent(id)}` : "/api/seller/products";
      const response = await request(endpoint, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, category, image: file ? "" : image, description, stock, discount_percent: discount })
      }, 15000);
      const data = await readJson(response);
      const productId = Number(id || data?.product?.id || data?.id);
      if (!productId) throw new Error("Product saved, but no product ID was returned.");

      if (file) {
        if ($("imageUploadStatus")) $("imageUploadStatus").textContent = "Uploading image...";
        image = await uploadImage(file);
        const update = await request(`/api/seller/products/${productId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, price, category, image, description, stock, discount_percent: discount })
        }, 15000);
        await readJson(update);
        imageInput.value = image;
        if ($("imageUploadStatus")) $("imageUploadStatus").textContent = "Image saved successfully.";
      }

      closeProductModal();
      message(id ? "Product updated successfully!" : "Product added successfully!", "success");
      Promise.resolve().then(() => loadProducts()).catch(console.warn);
      Promise.resolve().then(() => loadDashboard()).catch(console.warn);
    } catch (error) {
      console.error("SHRIVI save product:", error);
      message(error.message || "Failed to save product.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save Product";
    }
  };
})();
