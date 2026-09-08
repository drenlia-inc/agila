# Docker Setup for Agila

Agila is designed to run in Docker. Compose starts the application with PostgreSQL, Redis, and related services.

**Choose your path:**

| Who you are | What to do |
|-------------|------------|
| **Production / self-hosted** | Follow [Part 1 — Production deployment](#part-1--production-deployment) only, then stop. |
| **Developer** | Skip to [Part 2 — Local development](#part-2--local-development). |

---

## Table of contents

- [Part 1 — Production deployment](#part-1--production-deployment)
  - [Assumptions](#assumptions)
  - [Host packages](#host-packages)
  - [Install Agila](#install-agila)
  - [Configure nginx](#configure-nginx)
  - [Obtain a TLS certificate](#obtain-a-tls-certificate)
  - [Sign in](#sign-in)
  - [Production checklist](#production-checklist)
  - [Useful production commands](#useful-production-commands)
- [Part 2 — Local development](#part-2--local-development)
  - [Prerequisites](#prerequisites)
  - [Quick start](#quick-start)
  - [Ports](#ports)
  - [npm scripts](#npm-scripts)
  - [Container architecture](#container-architecture)
  - [Volumes](#volumes)
  - [Environment variables](#environment-variables)
  - [Troubleshooting](#troubleshooting)
  - [Development notes](#development-notes)

---

# Part 1 — Production deployment

Target: single-tenant Agila on **Ubuntu Server 26.04** (for example **AWS EC2** `t3.medium`), with Docker Compose, nginx, and Let’s Encrypt.

When you finish the checklist at the end of this part, **you are done**. You do not need Part 2.

## Assumptions

This section assumes a normal self-hosted environment:

- You can reach the server over **SSH**.
- A **DNS fully qualified domain name (FQDN)** already resolves to the server’s public IP address.
- The server is reachable from the internet on **TCP ports 80 and 443**.

DNS registration and opening those ports at the cloud or network edge are out of scope.

Agila runs PostgreSQL, Redis, the application, and the optional AI runner **inside Docker**. Do not install Node.js, PostgreSQL, or Redis on the host OS.

Suggested EC2 sizing: **Ubuntu Server 26.04 LTS**, **t3.medium** (2 vCPU / 4 GiB). Prefer a stable public address (for example an Elastic IP). Expose only ports **80** and **443** for the application; do not publish `3010`, `3222`, or Redis `6379` to the internet.

## Host packages

| Purpose | Packages |
|--------|----------|
| Clone and basics | `git`, `curl`, `ca-certificates`, `openssl` |
| Containers | Docker Engine and Compose (`docker` / `docker compose`) |
| TLS edge | `nginx`, `certbot`, `python3-certbot-nginx` |

Optional: `ufw`, `dnsutils`.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates openssl nginx certbot python3-certbot-nginx ufw dnsutils

sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# Re-login (or: newgrp docker), then confirm:
docker compose version
```

You may instead install Docker from Docker’s apt repository (`docker-ce` and `docker-compose-plugin`). Either channel is fine if `docker compose version` succeeds.

Optional host firewall (in addition to any cloud security group):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Install Agila

Part 1 uses **`docker-compose-prod.yml`**: it builds with **`Dockerfile.prod`**, runs `NODE_ENV=production`, does not bind-mount source code, does not publish Redis, and sets `TRUST_PROXY=1`. This is the production path.

(`docker-compose-example.yml` is for local development only — see Part 2. `docker-compose-demo.yml` is for the public demo site.)

### 1. Clone and copy the Compose file

```bash
git clone https://github.com/drenlia-inc/agila.git
cd agila
cp docker-compose-prod.yml docker-compose.yml
```

`docker-compose.yml` is gitignored and should remain local to the server.

### 2. Configure secrets

There is no dedicated secret-generation script. Create a project-root `.env`; Compose substitutes `${VAR}` into the compose file.

```bash
cp .env.example .env

openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # SETTINGS_ENCRYPTION_KEY
openssl rand -hex 24   # POSTGRES_PASSWORD
```

Set at least:

| Variable | Notes |
|----------|--------|
| `JWT_SECRET` | Required for authentication |
| `SETTINGS_ENCRYPTION_KEY` | Recommended; encrypts SMTP / OAuth / AI secrets at rest |
| `POSTGRES_PASSWORD` | Must match the Postgres service password |

### 3. Set your public hostname

In `docker-compose.yml`, set **`ALLOWED_ORIGINS`** to your FQDN (hostname is sufficient), for example `kanban.example.com`.

Leave **`DEMO_ENABLED=false`**, **`MULTI_TENANT=false`**, and **`TRUST_PROXY=1`** as shipped in the prod file.

nginx proxies to **`127.0.0.1:3010` only**. The production image serves the built frontend on that port and proxies `/api` and `/socket.io` to the backend inside the container.

### 4. Start the stack

```bash
docker compose up --build -d
```

Retrieve the one-time admin password after first boot:

```bash
docker compose logs | grep -A5 'ADMIN ACCOUNT CREDENTIALS'
```

Default email: `admin@kanban.local`. The password is written **once** to the logs and is not shown on the login page when `DEMO_ENABLED=false`.

## Configure nginx

Terminate TLS at nginx and proxy to port `3010`. Enable WebSocket upgrade headers and raise the upload body limit.

Example (`/etc/nginx/sites-available/agila`), substituting your FQDN:

```nginx
server {
    listen 80;
    server_name kanban.example.com;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/agila /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Do not apply long-lived cache headers to `/` or `index.html`. See [DEBUGGING.md](/DEBUGGING.md) if the UI shell appears stale after upgrades.

## Obtain a TLS certificate

```bash
sudo certbot --nginx -d kanban.example.com
```

Certbot configures HTTPS and typically enables HTTP-to-HTTPS redirection. Renewal is handled by the certbot timer on Ubuntu.

## Sign in

1. Open `https://kanban.example.com` (your FQDN).
2. Sign in with `admin@kanban.local` and the password from the container logs.
3. Change the admin password immediately.
4. Under **Settings → Site Settings**, set the site name and URL to your HTTPS origin.
5. Optionally configure SMTP, SSO, and AI under System Settings.

Local health check: `http://127.0.0.1:3010/health`.

## Production checklist

1. Confirm SSH access, FQDN → IP, and public reachability on ports 80 and 443.
2. Install packages (Docker, nginx, certbot).
3. Clone the repository; copy **`docker-compose-prod.yml`** to `docker-compose.yml`.
4. Create `.env` with strong secrets; set **`ALLOWED_ORIGINS`** to your FQDN.
5. Run `docker compose up --build -d` and capture admin credentials from the logs.
6. Configure nginx to proxy to `127.0.0.1:3010` (WebSockets and `client_max_body_size`).
7. Run `certbot --nginx` for your FQDN.
8. Sign in over HTTPS and change the admin password.

**Production deployment is complete.** Stop here unless you need local development (Part 2).

## Useful production commands

```bash
docker compose ps
docker compose logs -f agila-app
docker compose restart agila-app
./scripts/backup-postgres.sh
```

Database backups: [README — Database Backup & Restore](/README.md#database-backup--restore).

---

# Part 2 — Local development

For engineers running Agila on a workstation. Production operators can ignore this part.

## Prerequisites

- Docker Engine installed and running
- Docker Compose available (`docker compose`)

## Quick start

```bash
git clone https://github.com/drenlia-inc/agila.git
cd agila
cp docker-compose-example.yml docker-compose.yml
# Optional: cp .env.example .env and set JWT_SECRET / POSTGRES_PASSWORD

npm run docker:dev
# Or: docker compose up --build
```

Open:

- Frontend: http://localhost:3010
- Backend API: http://localhost:3222

Default admin credentials are printed once in the logs (`ADMIN ACCOUNT CREDENTIALS`). See the [README Installation](/README.md#installation) section.

## Ports

| Command | Frontend | Backend API | Notes |
|---------|----------|-------------|-------|
| `npm run docker:dev` | http://localhost:3010 | http://localhost:3222 | Hot reloading |

## npm scripts

```bash
npm run docker:build   # Build image
npm run docker:run     # Run container directly
npm run docker:dev     # Start development stack
npm run docker:stop    # Stop containers
npm run docker:clean   # Remove containers and volumes
```

## Container architecture

```
┌─────────────────────────────────────────────────┐
│               Docker Compose Stack              │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │             Agila Container              │   │
│  │  ┌─────────────────────────────┐         │   │
│  │  │      Vite Dev Server        │         │   │  ← Port 3010
│  │  │       (Hot Reloading)       │         │   │
│  │  └─────────────────────────────┘         │   │
│  │  ┌─────────────────────────────┐         │   │
│  │  │      Express Backend        │         │   │  ← Port 3222
│  │  │        (API Server)         │         │   │
│  │  └─────────────────────────────┘         │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │             Redis Container              │   │
│  │  ┌─────────────────────────────┐         │   │
│  │  │        Redis Server         │         │   │  ← Port 6379
│  │  │     (Real-time updates)     │         │   │
│  │  └─────────────────────────────┘         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

PostgreSQL is also started by Compose (not shown above).

## Volumes

**Application**

- `postgres_data`, `kanban-data`, `kanban-attachments`, `kanban-avatars`, `redis_data`

**Development**

- `.:/app` — source mounted for hot reload
- `/app/node_modules` — preserves container modules

## Environment variables

| Area | Variables |
|------|-----------|
| Core | `NODE_ENV`, `DOCKER_ENV=true`, `PORT` (default `3222`), `VITE_API_URL` |
| Services | `REDIS_URL` (default `redis://redis:6379`), `POSTGRES_*` |
| Security | `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `ALLOWED_ORIGINS` |
| Optional | `DEMO_ENABLED`, `LICENSE_ENABLED`, `APP_VERSION`, `RUNNER_TOKEN` |

Health endpoint: `/health` (database connectivity; used by Docker health checks).

## Troubleshooting

```bash
docker compose logs
docker compose ps

docker compose ps postgres
docker exec agila-postgres pg_isready -U kanban_user -d kanban
docker exec -it agila node /app/scripts/query-db.js "SELECT count(*) FROM users;"

docker compose logs redis
docker compose logs agila-app | grep -i redis

sudo ss -tulpn | grep -E ':3010|:3222'

npm run docker:clean
npm run docker:dev
```

## Development notes

- Hot reload prioritizes developer experience; volume mounts and source maps use more resources.
- Keep `DEMO_ENABLED=false` unless you intentionally want demo behaviour.
- Do not enable `ALLOW_TEST_ENDPOINTS` on shared or production-like hosts.
- Media files use an HttpOnly `ek_media` cookie; do not put the session JWT in file URL query strings.
- Why Docker-only: Redis and PostgreSQL are required; Compose provides a consistent, isolated stack without installing those services on the host.
