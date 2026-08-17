# Shrivi Marketplace

Shrivi is a multi-vendor fashion marketplace built with Node.js, Express and PostgreSQL.

## Current production structure

- Customer storefront: `/shop`
- Mobile/PWA storefront: `/app`
- Seller Center: `/seller`
- Admin Panel: `/`
- PostgreSQL database for products, sellers and orders
- Server-side admin and seller sessions
- bcrypt password hashing
- Product management (add/edit/delete)
- Seller product and order management
- Admin order status management
- Product image upload support through Cloudinary
- PWA manifest and service worker included
- Razorpay dependency included for payment integration

## Production environment variables

Set these in the hosting provider environment settings. Never put passwords or API secrets in HTML files.

- `DATABASE_URL`
- `ADMIN_USER`
- `ADMIN_HASH`
- `SESSION_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- Razorpay credentials when payment checkout is enabled

## Run locally

```bash
npm install
npm start
```

The production start command uses `image-upload-bootstrap.js`, which starts the existing server and installs the secure product-image upload routes.

## Security

- Admin authentication is server-side.
- Admin passwords are not stored in frontend HTML.
- Use a long random `SESSION_SECRET`.
- Use HTTPS in production.
- Never commit `.env` files or API secrets.

## Important

This repository contains the live Shrivi Marketplace codebase. Existing working marketplace, admin, seller and database functionality should be preserved when adding new features.
