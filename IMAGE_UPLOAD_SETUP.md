# Shrivi Product Images

## Current status
Product records already support an `image` / image URL field. The existing UI keeps a placeholder when a product has no image.

## Implemented
- Admin product image upload endpoint.
- Seller-owned product image upload endpoint.
- JPG / PNG / WEBP validation.
- 5MB server-side size limit.
- Session authentication for admin and seller uploads.
- Seller ownership check before image replacement.
- Cloudinary signed server-side upload.
- Only the returned HTTPS `secure_url` is saved in the product `image` field.
- Upload controls are injected into the existing Admin/Seller product cards without replacing their working panels.

## Render environment variables required
Set these in the Render service environment variables:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Never put `CLOUDINARY_API_SECRET` in HTML, browser JavaScript, GitHub, or chat.

## Cloudinary setup
Create/open a Cloudinary product environment and get the Cloud Name, API Key and API Secret from the Cloudinary Console API Keys page. Cloudinary documents these credentials and recommends keeping the API Secret server-side. 

## Upload rules
The server accepts only:
- JPEG
- PNG
- WEBP

Maximum file size: 5MB.

Images are uploaded into the `shrivi/products` folder and the resulting HTTPS URL is stored in the existing product `image` column.

## Rollout
1. Configure the three Cloudinary variables in Render.
2. Redeploy the Shrivi service if Render does not auto-deploy.
3. Login to Admin or Seller Center.
4. Open Products.
5. Create a product first if needed.
6. Use the new **Upload Image** control on the product card.
7. Verify the image appears in the product card and customer Shop.
