# Shrivi Secure Admin

This version uses a real server-side session and bcrypt password hash.

## 1. Install
npm install

## 2. Create a password hash
Run:
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD',12))"

## 3. Set environment variables
Windows PowerShell:
$env:ADMIN_USER="admin"
$env:ADMIN_HASH="PASTE_HASH_HERE"
$env:SESSION_SECRET="MAKE_A_LONG_RANDOM_SECRET"

macOS/Linux:
export ADMIN_USER="admin"
export ADMIN_HASH="PASTE_HASH_HERE"
export SESSION_SECRET="MAKE_A_LONG_RANDOM_SECRET"

## 4. Start
npm start

Then open http://localhost:3000

IMPORTANT:
- Do not use the old demo password on a public website.
- Use HTTPS in production.
- Set a strong random SESSION_SECRET.
- This starter is an authentication foundation; payments, seller accounts, database, product management and orders still need to be connected.
