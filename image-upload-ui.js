(() => {
  "use strict";

  const MAX_INPUT_BYTES = 5 * 1024 * 1024;
  const MAX_DIMENSION = 1200;
  const TARGET_BYTES = 350 * 1024;
  const MIN_QUALITY = 0.55;
  const START_QUALITY = 0.78;
  const REQUEST_TIMEOUT = 45000;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

  function setStatus(text) {
    const el = $("imageUploadStatus");
    if (el) el.textContent = text || "";
  }

  async function readJson(response) {
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
      return await originalFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out. Please try again with a smaller image.");
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
    if (file.size > MAX_INPUT_BYTES) {
      throw new Error("Image must be 5MB or smaller.");
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the image."));
      reader.onload = () => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not open the image."));
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function optimizeImage(file) {
    validate(file);

    let image;
    try {
      image = await loadImage(file);
    } catch (error) {
      throw error;
    }

    const longest = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(1, longest));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    if (file.size <= TARGET_BYTES && longest <= MAX_DIMENSION && /image\/(jpeg|webp)/.test(file.type)) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return file;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    let quality = START_QUALITY;
    let blob = await canvasToBlob(canvas, quality);

    while (blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.07);
      blob = await canvasToBlob(canvas, quality);
    }

    if (!blob || blob.size >= file.size) return file;

    const baseName = (file.name || "product-image").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: Date.now()
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Image compression failed.")),
        "image/webp",
        quality
      );
    });
  }

  function uploadWithProgress(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("image", file, file.name);

      xhr.open("POST", "/api/seller/upload/image", true);
      xhr.withCredentials = true;
      xhr.timeout = REQUEST_TIMEOUT;

      xhr.upload.onprogress = event => {
        if (event.lengthComputable) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          setStatus(`Uploading image... ${percent}%`);
        } else {
          setStatus("Uploading image...");
        }
      };

      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || data.message || `Image upload failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during image upload."));
      xhr.ontimeout = () => reject(new Error("Image upload timed out. Please try again."));
      xhr.onabort = () => reject(new Error("Image upload was cancelled."));
      xhr.send(formData);
    });
  }

  async function uploadImage(file) {
    setStatus("Preparing image...");
    const optimized = await optimizeImage(file);

    const originalMB = (file.size / 1024 / 1024).toFixed(2);
    const optimizedMB = (optimized.size / 1024 / 1024).toFixed(2);

    setStatus(
      optimized.size < file.size
        ? `Uploading optimized image (${optimizedMB} MB from ${originalMB} MB)...`
        : `Uploading image (${optimizedMB} MB)...`
    );

    const data = await uploadWithProgress(optimized);
    const url =
      data.url ||
      data.secure_url ||
      data.image ||
      data.imageUrl ||
      data.data?.url ||
      data.data?.image ||
      data.data?.imageUrl;

    if (!url) {
      throw new Error("Image uploaded but no image URL was returned.");
    }

    setStatus("Image uploaded. Saving product...");
    return url;
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
    } catch (error) {
      return alert(error.message);
    }

    const button = $("saveProductButton");
    button.disabled = true;
    button.textContent = file ? "Uploading & saving..." : "Saving...";

    try {
      // Upload first, then create/update the product with the final URL.
      // This avoids creating a half-saved product when image upload fails.
      if (file) {
        image = await uploadImage(file);
      }

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
          image,
          description,
          stock,
          discount_percent: discount
        })
      });

      await readJson(response);

      setStatus(file ? "Product and image saved successfully." : "Product saved successfully.");
      closeProductModal();
      msg(id ? "Product updated successfully!" : "Product added successfully!", "success");

      await safeRefresh(() => loadProducts());
      await safeRefresh(() => loadDashboard());
    } catch (error) {
      console.error("Shrivi seller save product:", error);
      setStatus("Save failed.");
      msg(error.message || "Failed to save product.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save Product";
    }
  };
})();
