(() => {
  "use strict";

  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  function showUploadMessage(message, type = "info") {
    let box = document.getElementById("shrivi-image-upload-message");
    if (!box) {
      box = document.createElement("div");
      box.id = "shrivi-image-upload-message";
      box.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:999999;padding:14px 18px;border-radius:12px;background:#111;color:#fff;font:14px Arial;box-shadow:0 8px 30px rgba(0,0,0,.2)";
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.style.background = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#111";
    clearTimeout(box.__timer);
    box.__timer = setTimeout(() => box.remove(), 3500);
  }

  function validateImage(file) {
    if (!file) return true;
    if (!ALLOWED_TYPES.includes(file.type)) {
      showUploadMessage("Only JPG, PNG and WEBP images are allowed.", "error");
      return false;
    }
    if (file.size > MAX_SIZE) {
      showUploadMessage("Image must be 5MB or smaller.", "error");
      return false;
    }
    return true;
  }

  // FINAL SELLER SAVE FLOW:
  // 1) Upload selected image first using the already-working seller upload API.
  // 2) Send the returned Cloudinary URL with product create/update.
  // This avoids the old create-product-then-upload race/failure completely.
  window.saveProduct = async function saveProduct() {
    const id = $("productId").value.trim();
    const name = $("productName").value.trim();
    const price = Number($("productPrice").value);
    const category = $("productCategory").value.trim();
    let image = $("productImage").value.trim();
    const description = $("productDescription").value.trim();
    const stock = Number($("productStock").value);
    const discount = Number($("productDiscount").value || 0);
    const imageFile = $("productImageFile").files?.[0] || null;

    if (!name) return alert("Product name is required.");
    if (!Number.isFinite(price) || price < 0) return alert("Enter a valid product price.");
    if (!category) return alert("Product category is required.");
    if (!Number.isInteger(stock) || stock < 0) return alert("Stock must be a whole number.");
    if (!Number.isFinite(discount) || discount < 0 || discount >= 100) return alert("Discount must be between 0 and 99.99%.");
    if (!validateImage(imageFile)) return;

    if (image && !imageFile) {
      try { new URL(image); }
      catch (e) { return alert("Please enter a valid image URL."); }
    }

    const button = $("saveProductButton");
    button.disabled = true;
    button.textContent = "Saving...";

    try {
      // Upload first, then save the returned permanent URL in products.image.
      if (imageFile) {
        $("imageUploadStatus").textContent = "Uploading image...";
        const formData = new FormData();
        formData.append("image", imageFile);

        const uploadResponse = await fetch("/api/seller/upload/image", {
          method: "POST",
          credentials: "include",
          body: formData
        });

        const uploadData = await getJson(uploadResponse);
        image = uploadData.url || uploadData.secure_url || "";

        if (!image) throw new Error("Image uploaded but no image URL was returned.");
        $("productImage").value = image;
        $("imageUploadStatus").textContent = "Image uploaded successfully.";
      }

      const url = id ? "/api/seller/products/" + encodeURIComponent(id) : "/api/seller/products";
      const method = id ? "PUT" : "POST";

      const response = await fetch(url, {
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

      await getJson(response);

      closeProductModal();
      showMessage("mainMessage", id ? "Product updated successfully!" : "Product added successfully!");
      await loadProducts();
      await loadDashboard();

    } catch (error) {
      console.error("Seller save product:", error);
      showMessage("mainMessage", error.message || "Failed to save product.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save Product";
    }
  };

  // Keep a safe standalone uploader API available for any future UI use.
  window.ShriviImageUpload = {
    async uploadImage(file) {
      if (!validateImage(file)) return null;
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/seller/upload/image", {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Image upload failed");
      return data.url || data.secure_url || null;
    }
  };
})();
