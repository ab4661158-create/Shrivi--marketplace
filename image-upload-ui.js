(() => {
  "use strict";

  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

    // Primary endpoint used by the existing server.
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

    // Fallback endpoint installed by the image-upload bootstrap.
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

  // Override the old seller save function. Product is always created/updated first,
  // then the selected file is uploaded and the permanent URL is saved back to product.
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
      // 1. Save the product first. This guarantees the product itself is not lost
      // if an external image service temporarily fails.
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

      // 2. If a file was selected, upload it now.
      if (file) {
        $("imageUploadStatus").textContent = "Uploading image...";
        const imageUrl = await upload(file, productId);

        // 3. Save the permanent image URL on the product.
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

  // Keep the image selector validation/preview handled by seller.html.
})();
