(() => {
  "use strict";

  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  // The seller dashboard has a defensive compatibility endpoint installed by
  // image-upload-bootstrap.js. Route only this one request through it.
  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url;
      if (url === "/api/seller/dashboard") {
        return originalFetch("/api/seller/dashboard-fixed", init);
      }
    } catch (error) {
      console.warn("Shrivi fetch wrapper:", error);
    }
    return originalFetch(input, init);
  };

  function msg(message, type = "info") {
    const el = document.getElementById("mainMessage");
    if (el) {
      el.textContent = message;
      el.className = "message " + (type === "error" ? "error-message" : "success-message");
      el.style.display = "block";
    } else {
      alert(message);
    }
  }

  async function json(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return data;
  }

  function validate(file) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Only JPG, PNG and WEBP images are allowed.");
    if (file.size > MAX_SIZE) throw new Error("Image must be 5MB or smaller.");
  }

  async function upload(file, productId) {
    validate(file);

    const fd = new FormData();
    fd.append("image", file);

    try {
      const r = await fetch("/api/seller/upload/image", {
        method: "POST",
        credentials: "include",
        body: fd
      });
      const d = await json(r);
      const url = d.url || d.secure_url || d.image || d.product?.image;
      if (url) return url;
    } catch (firstError) {
      console.warn("Primary seller image upload failed:", firstError);
    }

    if (productId) {
      const fd2 = new FormData();
      fd2.append("image", file);
      const r2 = await fetch(`/api/seller/products/${encodeURIComponent(productId)}/image`, {
        method: "POST",
        credentials: "include",
        body: fd2
      });
      const d2 = await json(r2);
      const url2 = d2.url || d2.secure_url || d2.image || d2.product?.image;
      if (url2) return url2;
    }

    throw new Error("Image upload failed. Please check Cloudinary configuration.");
  }

  // Override the old seller save function. Product is created/updated first,
  // then an optional selected file is uploaded and its permanent URL is saved.
  window.saveProduct = async function () {
    const id = $("productId").value.trim();
    const name = $("productName").value.trim();
    const price = Number($("productPrice").value);
    const category = $("productCategory").value.trim();
    let image = $("productImage").value.trim();
    const description = $("productDescription").value.trim();
    const stock = Number($("productStock").value);
    const discount = Number($("productDiscount").value || 0);
    const file = $("productImageFile").files?.[0] || null;

    if (!name) return alert("Product name is required.");
    if (!Number.isFinite(price) || price < 0) return alert("Enter a valid product price.");
    if (!category) return alert("Product category is required.");
    if (!Number.isInteger(stock) || stock < 0) return alert("Stock must be a whole number.");
    if (!Number.isFinite(discount) || discount < 0 || discount >= 100) return alert("Discount must be between 0 and 99.99%.");

    // Prevent accidental duplicate listings in the UI before making a request.
    // The database unique index added by the bootstrap is the final protection.
    if (!id && Array.isArray(window.currentProducts)) {
      const duplicate = window.currentProducts.find(product =>
        String(product?.name || "").trim().toLowerCase() === name.toLowerCase() &&
        String(product?.category || "").trim().toLowerCase() === category.toLowerCase() &&
        Number(product?.price || 0) === price
      );

      if (duplicate) {
        return msg("This product is already listed. Edit the existing product instead.", "error");
      }
    }

    try {
      validate(file);
      if (image && !file) new URL(image);
    } catch (e) {
      return alert(e.message);
    }

    const button = $("saveProductButton");
    button.disabled = true;
    button.textContent = "Saving...";

    try {
      const endpoint = id ? `/api/seller/products/${encodeURIComponent(id)}` : "/api/seller/products";
      const method = id ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          price,
          category,
          image: file ? "" : image,
          description,
          stock,
          discount_percent: discount
        })
      });

      const data = await json(response);
      const productId = Number(id || data?.product?.id || data?.id || data?.product_id);
      if (!productId) throw new Error("Product was saved but the server did not return its ID.");

      if (file) {
        $("imageUploadStatus").textContent = "Uploading image...";
        const imageUrl = await upload(file, productId);

        const imageUpdate = await fetch(`/api/seller/products/${encodeURIComponent(productId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name,
            price,
            category,
            image: imageUrl,
            description,
            stock,
            discount_percent: discount
          })
        });
        await json(imageUpdate);
        $("productImage").value = imageUrl;
        $("imageUploadStatus").textContent = "Image saved successfully.";
      }

      closeProductModal();
      msg(id ? "Product updated successfully!" : "Product added successfully!", "success");
      await loadProducts();
      await loadDashboard();
    } catch (error) {
      console.error("Shrivi seller save product:", error);
      msg(error.message || "Failed to save product.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save Product";
    }
  };
})();
