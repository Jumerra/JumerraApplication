# Deploying Jumerra on Render

Two phases:

- **Phase 1** — Provision Render services + Cloudflare R2 bucket (you do this in the web UIs; no code changes needed).
- **Phase 2** — Code change to switch object storage from Replit's bucket to Cloudflare R2 (the agent handles this once you've completed Phase 1).

---

## Phase 1 — Things only you can do

### 1. Cloudflare R2 bucket (object storage)

1. Go to **dash.cloudflare.com** → sign in (or create a free account).
2. Left sidebar → **R2 Object Storage** → **Create bucket**.
3. Bucket name: `jumerra-uploads`. Region: **Eastern Europe (EEUR)** or **Western Europe (WEUR)** — both are reasonable for African users.
4. Click into the bucket → **Settings** → **Public access** → enable **Allow public access** (R2.dev subdomain is fine for now; you can add a custom CDN domain later).
5. Copy the **public R2.dev URL** that appears (looks like `https://pub-xxxxxxxx.r2.dev`). You'll paste it into Render as `S3_PUBLIC_BASE_URL`.
6. Left sidebar → **R2** → **Manage R2 API Tokens** → **Create API token**.
   - Permissions: **Object Read & Write**
   - Scope: just the `jumerra-uploads` bucket
   - TTL: forever (or whatever your security policy prefers)
7. Save the credentials Cloudflare shows you (one time only):
   - **Access Key ID** → goes into Render as `S3_ACCESS_KEY_ID`
   - **Secret Access Key** → goes into Render as `S3_SECRET_ACCESS_KEY`
   - **Jurisdiction-specific S3 endpoint** (looks like `https://<accountid>.r2.cloudflarestorage.com`) → goes into Render as `S3_ENDPOINT`

### 2. Render services (one-click via Blueprint)

1. Push your latest code to GitHub if you haven't (the GitHub integration in Replit can do this for you).
2. Go to **dashboard.render.com** → **New +** → **Blueprint**.
3. Connect the GitHub repo for Jumerra.
4. Render detects the `render.yaml` at the repo root and lists three things to create:
   - `jumerra-db` (Postgres)
   - `jumerra-api` (Web Service)
   - `jumerra-web` (Static Site)
5. Click **Apply**. Render provisions the database first, then the two services.
6. The first build will fail or warn about missing env vars — that's expected. We'll set them next.

### 3. Set the manual secrets on `jumerra-api`

In Render → `jumerra-api` → **Environment**, add these (most you already have in Replit Secrets):

| Key                       | Where it comes from                                |
| ------------------------- | -------------------------------------------------- |
| `PAYSTACK_SECRET_KEY`     | Paystack dashboard → Settings → API Keys           |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack dashboard → Settings → Webhooks           |
| `RESEND_API_KEY`          | resend.com → API Keys                              |
| `EMAIL_DEFAULT_FROM`      | e.g. `Jumerra <noreply@jumerra.com>`               |
| `STORAGE_BACKEND`         | `s3`                                               |
| `S3_ENDPOINT`             | from R2 step 7 above                               |
| `S3_BUCKET`               | `jumerra-uploads`                                  |
| `S3_ACCESS_KEY_ID`        | from R2 step 7 above                               |
| `S3_SECRET_ACCESS_KEY`    | from R2 step 7 above                               |
| `S3_PUBLIC_BASE_URL`      | from R2 step 5 above                               |
| `SENTRY_DSN_SERVER`       | (optional) sentry.io project DSN                   |

`DATABASE_URL` and `SESSION_SECRET` are wired automatically by the Blueprint — don't set them manually.

### 4. Set the API URL on `jumerra-web`

Render gives `jumerra-api` a URL like `https://jumerra-api.onrender.com`. In Render → `jumerra-web` → **Environment**:

- `VITE_API_BASE_URL` = `https://jumerra-api.onrender.com` (the actual one Render assigned)

Click **Manual Deploy** to rebuild the web frontend with the new env var baked in.

### 5. Configure Paystack webhook

In Paystack dashboard → Settings → Webhooks, set the webhook URL to:

```
https://jumerra-api.onrender.com/api/webhooks/paystack
```

(Or your custom domain once you've added one — see step 6.)

### 6. Custom domain

Once both services are healthy:

1. Buy domain (if you don't have one). I'd suggest `jumerra.com`.
2. In Render → `jumerra-web` → **Settings** → **Custom Domains** → add `jumerra.com` and `www.jumerra.com`.
3. In Render → `jumerra-api` → **Settings** → **Custom Domains** → add `api.jumerra.com`.
4. Render shows you DNS records to add. Go to your registrar (GoDaddy, Namecheap, Cloudflare):
   - For `jumerra.com` and `www.jumerra.com`: add the **A record** + **CNAME** Render specifies.
   - For `api.jumerra.com`: add the **CNAME** Render specifies.
5. Wait 5 minutes to 24 hours for DNS to propagate.
6. Come back to Render and click **Verify** on each domain.
7. After verification, update `ALLOWED_ORIGINS` on `jumerra-api` to include your real domain(s):
   ```
   https://jumerra.com,https://www.jumerra.com
   ```
8. Update `VITE_API_BASE_URL` on `jumerra-web` to `https://api.jumerra.com` and trigger a rebuild.
9. Update the Paystack webhook URL to `https://api.jumerra.com/api/webhooks/paystack`.

---

## Phase 2 — Code change (agent handles)

Once you've completed steps 1–4 above and have the R2 credentials saved in Render, tell the agent **"R2 ready, do Phase 2"**. The agent will swap `objectStorage.ts` from the Replit GCS sidecar to an S3-compatible client that works with R2.

After Phase 2 ships, your existing avatars in Replit's bucket will NOT be auto-migrated. You can either:

- Leave them — old links 404, users re-upload.
- Bulk-migrate with `rclone copy` from the Replit bucket to R2. Agent can write the script if you want.

---

## Estimated monthly cost (production)

| Item                          | Cost           |
| ----------------------------- | -------------- |
| Render Web Service (API)      | $7             |
| Render Static Site (web)      | Free           |
| Render Postgres basic-256mb   | $7             |
| Cloudflare R2 (10 GB stored)  | ~$0.15         |
| Cloudflare R2 egress          | $0 (always)    |
| **Total**                     | **~$14/mo**    |

Scale up the API and Postgres tiers as traffic grows. Stay on Render starter tiers while you're under ~1k daily active users.
