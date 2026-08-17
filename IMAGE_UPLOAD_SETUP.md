# Shrivi Product Images

## Current status
Product records already support an `image`/image URL field. The live UI shows a placeholder when a product has no image.

## Production recommendation
Use a trusted image-hosting/storage provider (for example Cloudinary or S3-compatible storage) and save only the resulting HTTPS image URL in the product `image` field.

## Important
Do not put provider API secrets in HTML or client-side JavaScript. Keep upload credentials server-side/environment variables.

## Rollout
1. Configure image storage provider.
2. Add authenticated server-side upload endpoint.
3. Validate file type and size.
4. Store returned HTTPS URL in the product record.
5. Keep existing placeholder fallback for products without images.
