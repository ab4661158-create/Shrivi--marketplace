(() => {
  "use strict";
  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const showMessage = (m, type="info") => {
    let b = document.getElementById("shrivi-image-upload-message");
    if (!b) { b=document.createElement("div"); b.id="shrivi-image-upload-message"; b.style.cssText="position:fixed;right:20px;bottom:20px;z-index:999999;padding:14px 18px;border-radius:12px;background:#111;color:#fff;font:14px Arial;box-shadow:0 8px 30px rgba(0,0,0,.2)"; document.body.appendChild(b); }
    b.textContent=m; b.style.background=type==="error"?"#b91c1c":type==="success"?"#15803d":"#111"; clearTimeout(b.__t); b.__t=setTimeout(()=>b.remove(),3500);
  };
  function valid(file){ if(!file){showMessage("Please select an image.","error");return false;} if(!ALLOWED_TYPES.includes(file.type)){showMessage("Only JPG, PNG and WEBP images are allowed.","error");return false;} if(file.size>MAX_SIZE){showMessage("Image must be 5MB or smaller.","error");return false;} return true; }
  async function uploadImage(url, productId, file, button){
    if(!valid(file)) return null;
    const fd=new FormData(); fd.append("image",file);
    const old=button.textContent; button.disabled=true; button.textContent="Uploading...";
    try{
      const r=await fetch(url.replace(":id",encodeURIComponent(productId)),{method:"POST",body:fd,credentials:"same-origin"});
      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error||"Image upload failed");
      showMessage("Image uploaded successfully.","success"); button.textContent="Uploaded ✓"; return data;
    }catch(e){ console.error(e); showMessage(e.message||"Image upload failed.","error"); button.textContent=old; return null; }
    finally{button.disabled=false;}
  }
  function updateProductImage(id,url){ document.querySelectorAll(`[data-product-id="${id}"] img,[data-id="${id}"] img,img[data-product-id="${id}"]`).forEach(img=>img.src=url); window.dispatchEvent(new CustomEvent("shrivi:image-uploaded",{detail:{productId:id,imageUrl:url}})); }
  function createUploader(productId,sellerMode=false){
    const w=document.createElement("div"); w.className="shrivi-image-uploader"; w.style.cssText="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px";
    const input=document.createElement("input"); input.type="file"; input.accept="image/jpeg,image/png,image/webp"; input.style.display="none";
    const button=document.createElement("button"); button.type="button"; button.textContent="Upload Image"; button.style.cssText="border:0;border-radius:8px;padding:9px 13px;cursor:pointer;background:#111;color:#fff;font-size:13px";
    const name=document.createElement("span"); name.style.cssText="font-size:12px;color:#666"; button.onclick=()=>input.click();
    input.onchange=async()=>{const f=input.files?.[0]; if(!f)return; name.textContent=f.name; const result=await uploadImage(sellerMode?"/api/seller/products/:id/image":"/api/admin/products/:id/image",productId,f,button); if(result?.product?.image){updateProductImage(productId,result.product.image);input.value="";}};
    w.append(input,button,name); return w;
  }
  function init(){ window.ShriviImageUpload={uploadImage,createUploader,updateProductImage}; }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
})();