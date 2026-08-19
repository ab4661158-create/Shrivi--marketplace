(() => {
  "use strict";

  const MAX_SIZE = 5 * 1024 * 1024;
  const MAX_DIMENSION = 1600;
  const COMPRESS_QUALITY = 0.82;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const REQUEST_TIMEOUT = 60000;

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

  function $(id) {
    return document.getElementById(id);
  }

  function msg(message, type = "info") {
    const el = $("mainMessage");
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
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }
    return data;
  }

  async function request(input, init = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      return await originalFetch(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out. Please try again.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function validate(file) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error("Only JPG, PNG and WEBP images are allowed.");
    }
    if (file.size > MAX_SIZE) {
      throw new Error("Image must be 5MB or smaller.");
    }
  }

  function setStatus(text) {
    const el = $("imageUploadStatus");
    if (el) el.textContent = text || "";
  }

  // Compress large phone photos in the browser before sending them to Cloudinary.
  // This makes product creation much faster on mobile networks while preserving quality.
  async function optimizeImage(file) {
    validate(file);

    if (file.size < 900 * 1024) {
      return file;
    }

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      bitmap.close?.();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error("Image compression failed")),
        "image/jpeg",
        COMPRESS_QUALITY
      );
    });

    if (!blob || blob.size >= file.size) {
      return file;
    }

    const baseName = (file.name || "product-image").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    });
  }

  async function upload(file, productId) {
    const optimized = await optimizeImage(file);

    const fd = new FormData();
    fd.append("image", optimized);

    try {
      setStatus(
        optimized.size < file.size
          ? `Uploading optimized image (${(optimized.size / 1024 / 1024).toFixed(2)} MB)...`
          : "Uploading image..."
      );

      const r = await request("/api/seller/upload/image", {
        method: "POST",
        credentials: "include",
        body: fd
      });
      const d = await json(r);
      const url = d.url || d.secure_url || d.image || d.product?.image || d.imageUrl || d.data?.url || d.data?.image;
      if (url) return url;
    } catch (firstError) {
      console.warn("Primary seller image upload failed:", firstError);
    }

    if (productId) {
      const fd2 = new FormData();
      fd2.append("image", optimized);
      const r2 = await request(`/api/seller/products/${encodeURIComponent(productId)}/image`, {
        method: "POST",
        credentials: "include",
        body: fd2
      });
      const d2 = await json(r2);
      const url2 = d2.url || d2.secure_url || d2.image || d2.product?.image || d2.imageUrl || d2.data?.url || d2.data?.image;
      if (url2) return url2;
    }

    throw new Error("Image upload failed. Please try again.");
  }

  async function safeRefresh(fn) {
    try {
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Refresh timed out")), 10000))
      ]);
    } catch (error) {
      console.warn("Shrivi refresh after save:", error);
    }
  }

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
    if (!Number.isFinite(discount) || discount < 0 || discount > 99.99) {
      return alert("Discount must be between 0 and 99.99%.");
    }

    try {
      validate(file);
      if (image && !file) new URL(image);
    } catch (e) {
      return alert(e.message);
    }

    const button = $("saveProductButton");
    button.disabled = true;
    button.textContent = file ? "Saving & uploading..." : "Saving...";

    try {
      // Save the database record first. This prevents a slow Cloudinary upload
      // from blocking product creation or causing a generic "Failed to fetch".
      const endpoint = id
        ? `/api/seller/products/${encodeURIComponent(id)}`
        : "/api/seller/products";
      const method = id ? "PUT" : "POST";

      const response = await request(endpoint, {
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
      if (!productId) {
        throw new Error("Product was saved but the server did not return its ID.");
      }

      // Image upload is now a second, independent step.
      if (file) {
        setStatus("Preparing image...");
        const imageUrl = await upload(file, productId);

        const imageUpdate = await request(`/api/seller/products/${encodeURIComponent(productId)}`, {
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
        setStatus("Image saved successfully.");
      }

      closeProductModal();
      msg(id ? "Product updated successfully!" : "Product added successfully!", "success");

      // Refresh is best-effort and can never keep the save button stuck.
      await safeRefresh(() => loadProducts());
      await safeRefresh(() => loadDashboard());
    } catch (error) {
      console.error("Shrivi seller save product:", error);
      msg(error.message || "Failed to save product.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save Product";
    }
  };
})();
