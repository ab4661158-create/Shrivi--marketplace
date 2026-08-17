(() => {
  const isSeller = location.pathname === "/seller";
  const endpointBase = isSeller
    ? "/api/seller/products/"
    : "/api/admin/products/";

  function addUploadControls() {
    const editButtons = document.querySelectorAll(
      'button[onclick*="editProduct("]'
    );

    editButtons.forEach(button => {
      if (button.dataset.imageUploadReady === "1") return;

      const match = button.getAttribute("onclick")?.match(/editProduct\((\d+)\)/);
      if (!match) return;

      const productId = match[1];
      button.dataset.imageUploadReady = "1";

      const wrapper = document.createElement("div");
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

        const allowed = ["image/jpeg", "image/png", "image/webp"];
        if (!allowed.includes(file.type)) {
          status.textContent = "Only JPG, PNG and WEBP images are allowed.";
          return;
        }

        const formData = new FormData();
        formData.append("image", file);

        uploadButton.disabled = true;
        uploadButton.textContent = "Uploading...";
        status.textContent = "Uploading securely...";

        try {
          const response = await fetch(
            `${endpointBase}${productId}/image`,
            {
              method: "POST",
              body: formData,
              credentials: "same-origin"
            }
          );

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error || "Image upload failed");
          }

          status.textContent = "Image uploaded successfully.";
          input.value = "";

          if (typeof window.loadProducts === "function") {
            await window.loadProducts();
          }

          if (typeof window.loadSellerProducts === "function") {
            await window.loadSellerProducts();
          }
        } catch (error) {
          status.textContent = error.message || "Image upload failed";
        } finally {
          uploadButton.disabled = false;
          uploadButton.textContent = "Upload Image";
        }
      });

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      wrapper.appendChild(uploadButton);
      wrapper.appendChild(status);

      const card = button.closest(".product-card, .product");
      if (card) {
        const content = card.querySelector(".product-content, .product-body");
        (content || card).appendChild(wrapper);
      }
    });
  }

  const observer = new MutationObserver(addUploadControls);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addUploadControls);
  } else {
    addUploadControls();
  }
})();
