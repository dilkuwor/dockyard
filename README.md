# Dockyard

A small self-hosted cloud for one Docker machine. Deploy an image or a compose
file, get a live HTTPS URL on your domain, and redeploy automatically when
GitHub Actions pushes a new image.

```
GitHub Actions ── push ──▶ Docker Hub
      │
      └── signed POST /api/hooks/<app> ──▶ Cloudflare ──▶ cloudflared ──▶ Traefik ──▶ Dockyard
                                                                            │            │
                       visitor ── quiet-tide-4k2p.bytetech.cloud ──▶ ───────┘            ▼
                                                                   app containers ◀── docker compose up
```

## What's in the box

| Service        | Job                                                                 |
| -------------- | ------------------------------------------------------------------- |
| `cloudflared`  | Outbound tunnel to Cloudflare. No open ports on your router.         |
| `traefik`      | Routes each hostname to the right container using Docker labels.    |
| `socket-proxy` | Read-only Docker API for Traefik.                                   |
| `dockyard`     | API, dashboard and deploy hooks (Node/TypeScript + React).          |

## Setup

### 1. Cloudflare tunnel and DNS

1. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels** and
   create a tunnel (type *Cloudflared*). Copy the token from the install command.
2. In the tunnel's **Public hostnames**, add:
   - Subdomain `*`, domain `bytetech.cloud`, service `HTTP` → `traefik:80`
3. In **DNS** for bytetech.cloud, make sure there is a proxied `CNAME` record
   `*` → `<tunnel-id>.cfargotunnel.com`. The dashboard sometimes skips this for
   wildcards; add it by hand if it's missing.

Cloudflare's free certificate covers one wildcard level, so `abc.bytetech.cloud`
works but `abc.apps.bytetech.cloud` would not.

### 2. Configure

```bash
cp .env.example .env
openssl rand -hex 32   # paste into DOCKYARD_SECRET
# fill in CLOUDFLARE_TUNNEL_TOKEN and ADMIN_PASSWORD
```

### 3. Start

```bash
docker compose up -d --build
```

Open `https://dockyard.bytetech.cloud` (or `http://localhost:3000` on the
machine itself) and sign in with `ADMIN_PASSWORD`.

### 4. Lock down the dashboard (recommended)

Dockyard can run anything on this machine, so put Cloudflare Access in front of it:

1. **Zero Trust → Access → Applications → Add** a self-hosted app for
   `dockyard.bytetech.cloud` with a policy allowing only your email.
2. Add a second application for `dockyard.bytetech.cloud/api/hooks` with a
   **Bypass** policy for Everyone, so GitHub can reach the deploy hooks. Hooks are
   protected by their own HMAC signatures.

If Cloudflare's Bot Fight Mode is on, it may challenge GitHub's `curl` calls.
Add a WAF skip rule for the `/api/hooks/` path if deploys get blocked.

## Deploying an app

1. **New app** → choose a single image (e.g. `nginx:alpine`, port 80) or paste a
   compose file. Dockyard deploys it at the address you pick, or a random subdomain
   if you leave it blank. You can change the address later under **Settings**; it
   takes effect on the next deploy.
2. Open **Deploy hook** on the app, add the four secrets to your GitHub repo, and
   commit the workflow it shows (also in [`examples/deploy.yml`](examples/deploy.yml)).
3. Every push to `main` builds, pushes and deploys that exact image digest.
   Roll back from **Deployments** any time.

### Compose rules

Apps share one machine, so Dockyard rejects anything that reaches outside the app:
`build`, `ports`, `privileged`, `network_mode`, host `pid`/`ipc`, `cap_add`,
`devices`, bind mounts, `env_file`, `container_name`, external or named
networks/volumes, and `traefik.*` labels. Use images, named volumes, and the
Environment tab instead. The service that gets the URL is joined to the shared
`dockyard_edge` network; other services stay on the app's private network.

### Cleaning up old images

Every deploy pulls an image, and old ones stay on disk. The **Images** page lists
the images Dockyard pulled that no container uses any more and removes them on
request. It only ever touches images Dockyard pulled itself, so other projects on
the same machine are safe. A later rollback simply pulls the image again.

### Deploy hook format

```
POST /api/hooks/<app-id>
X-Dockyard-Timestamp: <unix seconds>
X-Dockyard-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{ "image": "yourname/app", "digest": "sha256:…", "commit": "<git sha>" }
```

Requests older than 5 minutes are rejected. `digest` and `commit` are optional;
without `digest`, the image tag is pulled as-is.

## Development

```bash
# terminal 1 — API on :3000 (needs Docker running locally)
cp .env.example .env    # set DATA_DIR=./.data and the required values
cd server && npm install && npm run dev

# terminal 2 — dashboard on :5173, proxies /api to :3000
cd web && npm install && npm run dev
```

## Project layout

```
server/src/
  index.ts        Fastify setup, static dashboard, startup checks
  compose.ts      Validates user compose files and renders the routed version
  deployer.ts     Per-app deploy queue: render → pull → up --wait
  images.ts       Tracks pulled images and prunes the unused ones
  docker.ts       docker / docker compose CLI wrapper
  routes/         auth, apps, hooks, images
web/src/
  pages/          Apps list, New app, App detail with tabs, Images
  components/     Shared UI
```
