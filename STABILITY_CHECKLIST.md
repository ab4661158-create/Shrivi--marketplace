# SHRIVI Stability Gate

This release keeps the existing marketplace implementation intact and adds a single verification gate for the areas that have caused repeated regressions.

## Verified automatically

- Production startup loads the database upgrade, canonical seller API, and seller image verification layers.
- Seller single-image and multi-image upload routes remain canonical.
- Seller product image URLs are persisted in `product_images` and mirrored to the product primary image.
- Customer startup explicitly hands control from the native splash to the loaded shop page.
- Android build workflow verifies native splash resources and produces a non-empty APK.
- Live `/shop` and `/api/products` endpoints are reachable.

## Release rule

Do not install an APK from an older workflow run after a newer stability commit has been merged. Build/install only the APK produced by the latest successful Android workflow for the merged commit.
