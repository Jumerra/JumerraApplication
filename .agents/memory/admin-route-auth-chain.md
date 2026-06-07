---
name: Admin router auth chain
description: requirePermission depends on req.currentUser being populated by a prior auth middleware
---

`requirePermission("x")` in `artifacts/api-server/src/lib/permissions.ts` reads
`req.currentUser` and returns 401 if it is unset. It does **not** authenticate on its own.

**Rule:** Always chain `requireAdmin` (or `requireAuth`) BEFORE `requirePermission(...)`
on admin routes — e.g. `router.get(path, requireAdmin, requirePermission("..."), handler)`.
The `admin-revenue` router is the canonical precedent.

**Why:** A new admin router (`admin-ministries`) used `requirePermission` alone, with no
preceding auth middleware, so `req.currentUser` was always undefined and every endpoint
401'd — the admin console feature was fully broken even though the permission name was
correct.

**How to apply:** Admin system roles (e.g. `finance`, `operations`) are `role:"admin"`
users with a specific `orgRole`, so `requireAdmin` passes them through and the following
`requirePermission` does the fine-grained filtering. Use both, in that order.
