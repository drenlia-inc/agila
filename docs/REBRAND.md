# Agila rebrand & domain hard cutover

Operator runbook for migrating from **Docru** / `docru.app` to **Agila** / `agila.dev`.

(Prior cutover: Easy Kanban / `ezkan.cloud` → Docru / `docru.app`. That domain should already be retired; this runbook assumes the live product host is `*.docru.app`.)

This document describes:

1. What was already changed in the application repo (code + Docker).
2. Docker cutover steps you can run locally.
3. What the **on-machine Kubernetes agent** must still do under `k8s/` and on the cluster (**`k8s/` was intentionally left unchanged** in the rebrand PR).

Hard cutover: after DNS flip, `*.docru.app` should stop serving the app. There is no dual-domain support in application code.

---

## Decisions

| Topic | Choice |
|-------|--------|
| Product name | **Agila** (display / seeds / i18n / docs). Docker compose service/`container_name` → Agila; crypto salts, `ek_media`, localStorage keys, k8s IDs unchanged. |
| Domain | **`agila.dev`** via `TENANT_DOMAIN` (default in code if unset). |
| `SITE_NAME` | Rows exactly equal to `Docru` → `Agila`. Also maps leftover exact `Easy Kanban` → `Agila`. Custom site names left alone. |
| Existing `SMTP_*` | **Not** rewritten by the cutover script — fix in Admin → Mail. |
| New managed SMTP seeds | Env: `MANAGED_SMTP_HOST`, `MANAGED_SMTP_USERNAME`, `MANAGED_SMTP_FROM_EMAIL`, `MANAGED_SMTP_FROM_NAME`, `MANAGED_SMTP_PASSWORD` (fallbacks derived from `TENANT_DOMAIN`). |
| Favicon | `public/agila-favicon.png` (default). Vite dev/preview uses `public/agila-favicon-dev.png` (teal DEV badge). Legacy `/kanban.ico` paths are treated as “no custom logo”. |

---

## What already changed in the repo

### Application

- Shared helper: [`server/utils/tenantDomain.js`](../server/utils/tenantDomain.js) — `getTenantDomain()`, `getManagedSmtpSeedDefaults()`; default domain → `agila.dev`.
- Call sites use the helper instead of hardcoded hosts: tenant routing, CSP, Socket.IO CORS, password-reset / invite / admin-portal URL builders.
- DB seeds ([`server/config/database.js`](../server/config/database.js)): `SITE_NAME` / `SMTP_FROM_NAME` → `Agila`; `WEBSITE_URL` / `ADMIN_PORTAL_URL` from `TENANT_DOMAIN`; managed SMTP from env.
- UI: `index.html` title, Header / email fallbacks, Admin mail noreply display fallback, owner-setup “custom identity” check vs `Agila`.
- i18n EN/FR product strings → Agila.
- [`README.md`](../README.md) / [`DOCKER.md`](../DOCKER.md) product naming → Agila.

### Docker / env (not `k8s/`)

- All `docker-compose*.yml`: `TENANT_DOMAIN=agila.dev`; `admin.agila.dev` where admin portal URLs appeared; licensed compose files pass through `MANAGED_SMTP_*`.
- [`.env.example`](../.env.example): documents `TENANT_DOMAIN`, portal URL, `MANAGED_SMTP_*`.

### Cutover script

- [`scripts/rebrand-domain-cutover.js`](../scripts/rebrand-domain-cutover.js)  
  - Updates `public` and every `tenant_*` schema that has `settings`.  
  - `SITE_NAME` exact match (`Docru` or `Easy Kanban` → `Agila`).  
  - Host rewrite on `APP_URL`, `GOOGLE_CALLBACK_URL`, `WEBSITE_URL`, `ADMIN_PORTAL_URL`.  
  - **Skips all `SMTP_*`.**

```bash
# Dry run
POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_DB=kanban \
  POSTGRES_USER=kanban_user POSTGRES_PASSWORD=… \
  node scripts/rebrand-domain-cutover.js --dry-run

# Apply
node scripts/rebrand-domain-cutover.js
```

Optional: `OLD_DOMAIN=docru.app` `NEW_DOMAIN=agila.dev` (defaults).

---

## Docker instance cutover

1. Backup Postgres volume / `pg_dump`.
2. Note Google OAuth redirect URIs for the current public origin (`*.docru.app`).
3. Deploy image that includes this rebrand; set compose / `.env`:
   - `TENANT_DOMAIN=agila.dev`
   - `ALLOWED_ORIGINS` → include new public host(s) (e.g. `kanban.agila.dev`); drop old hosts when retiring them
   - `MANAGED_SMTP_*` if this instance seeds managed mail for new DBs
4. Point edge DNS/TLS at the same upstream under the new hostname; prepare to retire `docru.app`.
5. Run `scripts/rebrand-domain-cutover.js` against the instance DB (dry-run first). Defaults are `OLD_DOMAIN=docru.app` / `NEW_DOMAIN=agila.dev`.
6. Update Google Cloud Console callbacks to the new origin; remove old URIs after smoke.
7. Restart app; smoke: login, media (`ek_media` is host-only — users refresh session on new host), WebSocket, invite/reset links.
8. Fix SMTP in Admin if needed; retire old hostname in DNS/proxy.

### Docker / edge status (kanban.dev)

Completed for the local pro compose + public edge:

- App image / compose: `TENANT_DOMAIN=agila.dev`, `ALLOWED_ORIGINS` includes `kanban.agila.dev`
- DB cutover applied (`APP_URL` / `GOOGLE_CALLBACK_URL` / `WEBSITE_URL` / `ADMIN_PORTAL_URL` → `agila.dev`; custom `SITE_NAME` unchanged)
- web03: `kanban.agila.dev` vhost + cert; `kanban.docru.app` → permanent redirect to Agila
- proxy.private.drenlia.com: `kanban.drenlia.dev` → permanent redirect to Agila
- Tenants kept dual-domain on edge for now: `drenlia` / `amanda-pg` on both `*.docru.app` and `*.agila.dev` (app code still single-domain via `TENANT_DOMAIN`)

Still operator-owned before calling kanban “fully done”:

- Confirm Google OAuth authorized redirect includes `https://kanban.agila.dev/api/auth/google/callback`
- Optional smoke: password login, Google SSO, WebSocket, media cookie on new host
- SMTP rows were **not** rewritten (still may show legacy From addresses) — Admin → Mail if you care
- `admin.agila.dev` / marketing `agila.dev` — **code rebrand applied** in `agila-admin` / `agila-web`; **web03 vhosts + certs done** (`120-agila.dev.conf`, mirrors Docru)

### Demo gitflow + CD (web01)

Repo: **`Drenlia-Inc/agila`**. Develop on **`dev`**, PR/merge to **`main`**. Push to `main` runs **Deploy demo** (`drenlia-runner` → `/home/demo/projects/demo/easy-kanban`).

- Compose file on the server is `docker-compose.yml` → `docker-compose-demo.yml` (`DEMO_ENABLED=true`). Project name is pinned to **`easy-kanban`** so a later folder rename to `agila` does not orphan Postgres/Redis volumes.
- Hourly `/home/demo/projects/demo/reset.sh kanban` still uses the `easy-kanban` path — update that script (and crontab / `start_kanban.sh`) in the same change if/when the directory is renamed.
- `.env` on the server is not in git; deploy is `git fetch` + `reset --hard origin/main` + `docker compose up -d --build` (volumes kept).

---

## Kubernetes — for the on-machine agent

**Do not assume these files were updated.** Edit and apply them on the ops host.

### Edge notes (from Docru → Agila ops)

- Public tenant/app vhosts for this stack are created on **web03** with `/root/bin/deploy.sh <host> <ip:port>` (not `/root/deploy.sh`). That writes under `/etc/nginx/sites-dev/`, enables the site, and runs certbot.
- **Cloudflare Access** on `*.agila.dev` blocks Let’s Encrypt HTTP-01 until you bypass `/.well-known/acme-challenge/*` or temporarily grey-cloud / disable Access for issuance.
- App code does **not** accept two base domains at once. For a soft cutover, keep old nginx vhosts (`*.docru.app`) proxying the same upstream while new `*.agila.dev` vhosts exist; flip `TENANT_DOMAIN` / ingress / DNS when ready. Optional permanent redirects (as done for `kanban.*`) after the new host is live.
- `kanban.drenlia.dev` historically lived on **proxy.private.drenlia.com** (`/etc/nginx/sites-available/proxy`), not web03.

### A. Repo file edits under `k8s/`

Replace `docru.app` with `agila.dev` (and product strings where user-facing) in at least:

| File | What to change |
|------|----------------|
| [`k8s/configmap.yaml.example`](../k8s/configmap.yaml.example) | `TENANT_DOMAIN`, `ALLOWED_ORIGINS`, `ADMIN_SERVICE_URL` (live `configmap.yaml` is gitignored) |
| [`k8s/configmap-pg.yaml.example`](../k8s/configmap-pg.yaml.example) | Same + origins (live `configmap-pg.yaml` is gitignored — copy from example) |
| [`k8s/app-deployment.yaml`](../k8s/app-deployment.yaml) | Probe `Host:` `app.docru.app` → `app.agila.dev` (or actual probe host) |
| [`k8s/app-deployment-pg.yaml`](../k8s/app-deployment-pg.yaml) | Probe `Host:` → new host |
| [`k8s/ingress-websocket.yaml`](../k8s/ingress-websocket.yaml) | Every `*.docru.app` host → `*.agila.dev` |
| [`k8s/deploy-pg.sh`](../k8s/deploy-pg.sh) | `DOMAIN` / default → `DOMAIN="${TENANT_DOMAIN:-agila.dev}"`; example URLs / echo text |
| [`k8s/deploy-instance-pg.sh`](../k8s/deploy-instance-pg.sh) | Example hostname in usage text |
| [`k8s/deploy-instance.sh`](../k8s/deploy-instance.sh) | Same (legacy path if still used) |
| [`k8s/remove-instance.sh`](../k8s/remove-instance.sh) / [`remove-instance-pg.sh`](../k8s/remove-instance-pg.sh) | `DOMAIN` default |
| [`k8s/verify-tenant-routing-pg.sh`](../k8s/verify-tenant-routing-pg.sh) | Default `TENANT_DOMAIN` / comments |
| [`k8s/migrate-tenant-to-pg.sh`](../k8s/migrate-tenant-to-pg.sh) | Default domain + final visit URL |
| [`k8s/setup-nfs.sh`](../k8s/setup-nfs.sh) | Example `TENANT_DOMAIN` in echo |
| [`k8s/reference-docs/*`](../k8s/reference-docs/) | Docs still saying `docru.app` / Docru / `ezkan.cloud` (optional cleanup) |

Also add/update ConfigMap entries for managed SMTP if SaaS seeds new tenants:

```yaml
MANAGED_SMTP_HOST: "smtp.agila.dev"
MANAGED_SMTP_USERNAME: "noreply@agila.dev"
MANAGED_SMTP_FROM_EMAIL: "noreply@agila.dev"
MANAGED_SMTP_FROM_NAME: "Agila"
# MANAGED_SMTP_PASSWORD via Secret, not plain ConfigMap, if used
```

Quick inventory on the machine:

```bash
rg -n 'docru\.app|ezkan\.cloud|Docru' k8s/
```

### B. Cluster cutover checklist

Suggested order for a **soft** dual-edge cutover (matches how kanban.dev was done):

1. DNS/certs for `*.agila.dev` (and later `admin.agila.dev`) ready; plan when to stop answering on `docru.app`.
2. On web03, add Agila vhosts **alongside** existing Docru ones (`/root/bin/deploy.sh <tenant>.agila.dev <same MetalLB ip:port>`). Keep Docru vhosts until cutover.
3. Inventory tenant settings (rollback):

   ```sql
   -- example: list APP_URL / SITE_NAME per tenant schema
   SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%';
   ```

4. Google OAuth: add `https://{tenant}.agila.dev/api/auth/google/callback` for each tenant before flip; remove old after smoke.
5. Deploy Agila-branded image; update ConfigMaps / deployments / ingress generators so **new** hosts are `{id}.agila.dev`. During soft cutover you may still serve Docru hostnames from the old ingress until DNS flip.
6. Rollout pods with `TENANT_DOMAIN=agila.dev` when you are ready for the app to treat Agila as the canonical base domain (invite/reset URL builders, CSP, tenant host parsing).
7. Run cutover script against the cluster DB (port-forward or `kubectl exec` into Postgres), e.g.:

   ```bash
   # After port-forward to Postgres:
   POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432 \
     POSTGRES_DB=easykanban POSTGRES_USER=kanban POSTGRES_PASSWORD=… \
     node scripts/rebrand-domain-cutover.js --dry-run
   node scripts/rebrand-domain-cutover.js
   ```

   Defaults are already `OLD_DOMAIN=docru.app` / `NEW_DOMAIN=agila.dev`. Adjust DB name/user to match [`k8s/postgres-secret-pg.yaml.example`](../k8s/postgres-secret-pg.yaml.example) / live secrets.

8. Smoke sample tenants on **both** hostnames if dual-edge, then on Agila only after redirect/DNS flip.
9. Optional: permanent redirects `*.docru.app` → `*.agila.dev` on web03; then retire Docru DNS/vhosts.
10. New deploys only create `*.agila.dev` ingresses / deploy.sh hosts.
11. Per-tenant SMTP still on old hosts: Admin → Mail (script does not touch `SMTP_*`).

### C. Rollback (cluster)

1. Revert ingress hosts + ConfigMap `TENANT_DOMAIN` + DNS to `docru.app` (and keep/restore Docru nginx vhosts if removed).
2. Inverse host rewrite from inventory (`OLD_DOMAIN=agila.dev` `NEW_DOMAIN=docru.app` with a careful one-off, or restore from backup).
3. Reverse `SITE_NAME` only where inventory showed the old default (`Agila` → `Docru`).
4. App image can remain Agila-branded; routing/DNS is the critical axis.

---

## Env reference

| Variable | Role |
|----------|------|
| `TENANT_DOMAIN` | Base domain for `{tenantId}.{domain}` routing, CSP, Socket.IO, URL fallbacks. Default in code: `agila.dev`. |
| `ALLOWED_ORIGINS` | Extra Socket.IO / Vite origins (comma-separated). |
| `ADMIN_SERVICE_URL` | Set in compose/ConfigMaps historically; runtime portal link uses DB `ADMIN_PORTAL_URL`. |
| `MANAGED_SMTP_HOST` / `_USERNAME` / `_FROM_EMAIL` / `_FROM_NAME` / `_PASSWORD` | Seeds for **new** licensed tenants only. |
| `MULTI_TENANT` | `true` in K8s SaaS; `false` for typical Docker. |

---

## Out of scope (intentionally)

- Renaming Docker images, K8s namespaces, DB name `easykanban`, crypto salts, localStorage prefixes, `ek_media`
- Dual-domain acceptance in `extractTenantId`
- Migrating existing tenant `SMTP_*` rows
- Replacing favicon until an Agila asset is provided

---

## Infra identifiers: `easy-kanban` → `agila` (difficulty notes)

Product branding is **Agila**; technical IDs mostly stay **`easy-kanban*`**. Renaming infra is optional and separate from domain cutover. Decide whether you care about **operator-facing** names (`kubectl`, image tags, `docker ps`) or only **user-facing** branding (already largely Agila via `SITE_NAME` / `*.agila.dev`).

### Do not rename (crypto / protocol)

These are not branding — changing them breaks data or sessions:

- Settings / SSH crypto salts in `server/utils/secretCrypto.js` (`easy-kanban-settings-v1`, `easy-kanban-agent-ssh-v1`, …)
- `ek_media` cookie / localStorage-style prefixes unless you ship an explicit migration
- S3 probe key prefixes that already exist in buckets (optional later; not required for Agila UX)

### Docker — done (operator-facing)

Compose files now use Agila names:

- Services: `agila-app`, `agila-runner` (+ neutral `postgres`, `redis`)
- `container_name`: `agila`, `agila-runner`, `agila-postgres`, `agila-redis`
- Internal URLs: `http://agila-runner:8080`, `http://agila-app:3222`
- Local image tag helpers (`package.json` / `scripts/build.sh`): `agila` / `agila:latest`

**Volumes intentionally unchanged** (`kanban-data`, `postgres_data`, …) so recreating containers keeps existing data.

Still optional later: App `INSTANCE_NAME` fallback `easy-kanban-app`; k8s registry tags that still say `easy-kanban:latest`.

### Kubernetes — two scopes

| Scope | Effort | Risk |
|-------|--------|------|
| Docs / scripts / YAML for **greenfield** only | Medium (many files; `deploy-pg.sh` sed patterns, labels, registry push scripts) | Low if live cluster untouched |
| **Rename live** cluster objects | High (careful cutover; likely downtime) | High |

Live identifiers today include (non-exhaustive):

- Namespaces: `easy-kanban-pg`, `easy-kanban` (nfs-server only after SQLite cleanup)
- Workloads / networking: Deployment `easy-kanban`, Service `easy-kanban-service` / NodePort, label `app=easy-kanban`
- Config / secrets: `easy-kanban-config-pg`, `easy-kanban-settings-crypto`, `easy-kanban-managed-s3`, …
- Images in the internal registry: `…:5000/easy-kanban:latest` (+ runner)
- Storage: PVs/PVCs named `easy-kanban-*`; NFS DNS `nfs-server.easy-kanban.svc.cluster.local`; some PVs pin the NFS **ClusterIP** (do not recreate that Service casually)
- Host paths such as `/data/easy-kanban-pv/…`
- Per-tenant ingress names: `easy-kanban-ingress-{tenant}`

Kubernetes does **not** rename namespaces or most resources in place. A real rename is create-new → migrate data/bindings → cut traffic → delete-old (Postgres PVC, Redis, NFS mounts, registry storage, NodePort/web03, every script that assumes `NAMESPACE=easy-kanban-pg`).

**Recommendation:** leave live k8s IDs as `easy-kanban*` unless you want a clean operator namespace and can schedule a dual-run. User-facing hosts already use `*.agila.dev`. Optional cheap wins: Docker `container_name` / image tags only; or Agila names in **new** manifests without migrating the current cluster.

### Practical options (summary)

1. **Keep infra IDs** — default; matches Decisions table above.
2. **Docker + image tags only** — cheap operator clarity for local/test.
3. **Greenfield YAML aliases** — new installs named `agila*`; does not rename live objects.
4. **Full live k8s rename** — only with explicit downtime / dual-run plan; not part of this domain cutover.
