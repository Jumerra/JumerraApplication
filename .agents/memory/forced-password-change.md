---
name: Forced password change enforcement
description: Why the mustChangePassword first-login flow must be enforced server-side, not just in the web UI.
---

# Forced first-login password change must be enforced on the server

A user flagged `mustChangePassword=true` (ministry owner created with a default
password by super-admin, or any account whose password was reset) gets a normal
authenticated session on login. The flag alone does not restrict anything.

**Rule:** enforcement lives in a server middleware (`forcedPasswordChangeGate` in
`middleware/require-auth.ts`), mounted at the top of the API router after
`ministryLockdown`. A flagged user is blocked (403 `{mustChangePassword:true}`)
from every route except a narrow allowlist: read own auth state, change password,
log out. The flag is cleared inside `/auth/change-password`.

**Why:** the web `ForcedPasswordGate` (App.tsx) is only UX — a flagged user could
otherwise call any business endpoint directly via curl/API client before changing
their password. Caught in code review.

**How to apply:** any future "must do X before using the app" flag (verify email,
accept terms, etc.) needs the same server-side gate pattern, not just a client
redirect. Webhooks are mounted below the gate but authenticate via signed payloads
(no session), so they are unaffected. The session cookie is `Secure`, so smoke
tests must hit `https://$REPLIT_DEV_DOMAIN`, not `http://localhost:80` (the cookie
is silently dropped over plain HTTP, making every request look like 401).
