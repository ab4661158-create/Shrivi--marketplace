# SHRIVI Workflow Safety Guidelines

## Active Workflows (Authorized)

### build-android-final.yml
- **Purpose:** Build Android APK on main branch
- **Trigger:** Push to main with file changes
- **Safety:** ✅ Read-only output, artifact only
- **Bypass:** N/A (always safe to run)

### verify-marketplace.yml
- **Purpose:** Verify marketplace API health
- **Trigger:** PR and main branch
- **Safety:** ✅ Read-only verification
- **Bypass:** N/A (always safe to run)

## Disabled Workflows (Auto-Patch Conflicts)

The following workflows have been DISABLED because they auto-patch source files,
which can conflict with canonical implementations and undo correct fixes:

### apply-seller-theme.yml
- **Status:** ❌ DISABLED
- **Reason:** Conflicts with seller.html CSS and seller-canonical-api.js
- **Impact:** Would override manual fixes with outdated theme
- **Re-enable:** Never, unless explicitly coordinated with backend maintainers

### remove-customer-sell.yml
- **Status:** ❌ DISABLED
- **Reason:** Can break customer.html during development
- **Impact:** Would remove seller buttons, causing inconsistent state
- **Re-enable:** Only if commit message explicitly contains [enable-remove-customer-sell]

### fix-seller-image-upload.yml
- **Status:** ❌ DISABLED
- **Reason:** Conflicts with seller-canonical-api.js
- **Impact:** Would patch frontend, but backend is already correct
- **Re-enable:** NEVER. All image fixes go through seller-canonical-api.js

## Rules for New Workflows

1. **No auto-patching of source files** — Use CI/CD for build, test, deploy, NOT for source mods
2. **No conflicting routes** — If a feature is implemented in backend, don't patch frontend
3. **Document all triggers** — Every workflow must explicitly state when it runs
4. **Verify in PR first** — Test in PR before merging to main
5. **Add bypass options** — Use commit message guards like `[skip ci]` or specific tags

## Canonical Implementations (Single Source of Truth)

- **Seller Image Upload:** `seller-canonical-api.js` (DO NOT PATCH FRONTEND)
- **Seller Product CRUD:** `seller-canonical-api.js` (DO NOT PATCH FRONTEND)
- **Customer API:** `server.js` + `shrivi-db-upgrades.js` (DO NOT PATCH FRONTEND)
- **Database Schema:** `server.js` + `shrivi-db-upgrades.js` (DO NOT AUTO-MIGRATE)

## Emergency Disable

If a workflow is causing issues:
1. Rename the .yml file or move to .disabled
2. Create a commit with message `[workflow-disabled] <reason>`
3. Document in this file
4. Notify team

---

**Last Updated:** 2026-08-22  
**Maintained by:** SHRIVI Stability Team
