(() => {
  "use strict";

  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  function showMessage(message, type = "info") {
    let box = document.getElementById(
      "shrivi-image-upload-message"
    );

    if (!box) {
      box = document.createElement("div");

      box.id =
        "shrivi-image-upload-message";

      box.style.cssText = `
        position:fixed;
        right:20px;
        bottom:20px;
        z-index:999999;
        max-width:360px;
        padding:14px 18px;
        border-radius:12px;
        background:#111;
        color:#fff;
        font-family:Arial,sans-serif;
        font-size:14px;
        box-shadow:0 8px 30px rgba(0,0,0,.2);
      `;

      document.body.appendChild(box);
    }

    box.textContent = message;

    if (type === "error") {
      box.style.background = "#b91c1c";
    } else if (type === "success") {
      box.style.background = "#15803d";
    } else {
      box.style.background = "#111";
    }

    clearTimeout(
      box.__shriviTimer
    );

    box.__shriviTimer =
      setTimeout(() => {
        box.remove();
      }, 3500);
  }

  function isValidImage(file) {
    if (!file) {
      showMessage(
        "Please select an image.",
        "error"
      );
      return false;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      showMessage(
        "Only JPG, PNG and WEBP images are allowed.",
        "error"
      );
      return false;
    }

    if (file.size > MAX_SIZE) {
      showMessage(
        "Image must be 5MB or smaller.",
        "error"
      );
      return false;
    }

    return true;
  }

  async function uploadImage(
    url,
    productId,
    file,
    button
  ) {
    if (!isValidImage(file)) {
      return null;
    }

    const formData =
      new FormData();

    formData.append(
      "image",
      file
    );

    const originalText =
      button.textContent;

    button.disabled = true;
    button.textContent =
      "Uploading...";

    try {
      const response =
        await fetch(
          url.replace(
            ":id",
            encodeURIComponent(
              productId
            )
          ),
          {
            method: "POST",
            body: formData,
            credentials: "same-origin"
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Image upload failed"
        );
      }

      showMessage(
        "Image uploaded successfully.",
        "success"
      );

      button.textContent =
        "Uploaded ✓";

      return data;
    } catch (error) {
      console.error(
        "Shrivi image upload:",
        error
      );

      showMessage(
        error.message ||
          "Image upload failed.",
        "error"
      );

      button.textContent =
        originalText;

      return null;
    } finally {
      button.disabled = false;
    }
  }

  function createUploader(
    productId,
    sellerMode = false
  ) {
    const wrapper =
      document.createElement("div");

    wrapper.className =
      "shrivi-image-uploader";

    wrapper.style.cssText = `
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      margin-top:8px;
    `;

    const input =
      document.createElement("input");

    input.type = "file";
    input.accept =
      "image/jpeg,image/png,image/webp";
    input.style.display = "none";

    const button =
      document.createElement("button");

    button.type = "button";
    button.textContent =
      "Upload Image";

    button.style.cssText = `
      border:0;
      border-radius:8px;
      padding:9px 13px;
      cursor:pointer;
      background:#111;
      color:#fff;
      font-size:13px;
    `;

    const filename =
      document.createElement("span");

    filename.style.cssText = `
      font-size:12px;
      color:#666;
    `;

    button.addEventListener(
      "click",
      () => {
        input.click();
      }
    );

    input.addEventListener(
      "change",
      async () => {
        const file =
          input.files &&
          input.files[0];

        if (!file) return;

        filename.textContent =
          file.name;

        const url =
          sellerMode
            ? "/api/seller/products/:id/image"
            : "/api/admin/products/:id/image";

        const result =
          await uploadImage(
            url,
            productId,
            file,
            button
          );

        if (
          result &&
          result.product &&
          result.product.image
        ) {
          updateProductImage(
            productId,
            result.product.image
          );

          input.value = "";
        }
      }
    );

    wrapper.appendChild(
      input
    );

    wrapper.appendChild(
      button
    );

    wrapper.appendChild(
      filename
    );

    return wrapper;
  }

  function updateProductImage(
    productId,
    imageUrl
  ) {
    const selectors = [
      `[data-product-id="${productId}"] img`,
      `[data-id="${productId}"] img`,
      `img[data-product-id="${productId}"]`
    ];

    selectors.forEach(
      selector => {
        document
          .querySelectorAll(
            selector
          )
          .forEach(img => {
            img.src =
              imageUrl;
          });
      }
    );

    window.dispatchEvent(
      new CustomEvent(
        "shrivi:image-uploaded",
        {
          detail: {
            productId,
            imageUrl
          }
        }
      )
    );
  }

  function getProductId(element) {
    if (!element) {
      return null;
    }

    const value =
      element.dataset.productId ||
      element.dataset.id ||
      element.getAttribute(
        "data-product-id"
      ) ||
      element.getAttribute(
        "data-id"
      );

    const id =
      Number(value);

    return Number.isInteger(id) &&
      id > 0
      ? id
      : null;
  }

  function findProductIdFromRow(
    row
  ) {
    if (!row) {
      return null;
    }

    const direct =
      getProductId(row);

    if (direct) {
      return direct;
    }

    const elements =
      row.querySelectorAll(
        "[data-product-id],[data-id]"
      );

    for (const element of elements) {
      const id =
        getProductId(element);

      if (id) {
        return id;
      }
    }

    return null;
  }

  function injectIntoProductRows() {
    const sellerMode =
      location.pathname
        .toLowerCase()
        .includes("seller");

    const rows =
      document.querySelectorAll(
        "tr, .product-card, .product-item, .product-row, [data-product-id], [data-id]"
      );

    rows.forEach(row => {
      if (
        row.querySelector(
          ".shrivi-image-uploader"
        )
      ) {
        return;
      }

      const productId =
        findProductIdFromRow(row);

      if (!productId) {
        return;
      }

      const uploader =
        createUploader(
          productId,
          sellerMode
        );

      row.appendChild(
        uploader
      );
    });
  }

  function watchPage() {
    injectIntoProductRows();

    const observer =
      new MutationObserver(
        () => {
          injectIntoProductRows();
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function exposeAPI() {
    window.ShriviImageUpload = {
      uploadImage,
      createUploader,
      updateProductImage
    };
  }

  function init() {
    exposeAPI();

    if (
      document.readyState ===
      "loading"
    ) {
      document.addEventListener(
        "DOMContentLoaded",
        watchPage,
        { once: true }
      );
    } else {
      watchPage();
    }
  }

  init();
})();
