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
| `cloudflared`  | Optional. Outbound tunnel to Cloudflare, started by Dockyard when you turn on public access. |
| `traefik`      | Routes each hostname to the right container using Docker labels.    |
| `socket-proxy` | Read-only Docker API for Traefik.                                   |
| `dockyard`     | API, dashboard and deploy hooks (Node/TypeScript + React).          |

## Setup

### 1. Configure and start

```bash
cp .env.example .env
openssl rand -hex 32   # paste into DOCKYARD_SECRET
# choose an ADMIN_PASSWORD
docker compose up -d --build
```

Open `http://dockyard.localhost:8080` on the machine itself (or `http://localhost:3000`)
and sign in with `ADMIN_PASSWORD`. On a remote server, reach it through an SSH tunnel:
`ssh -L 8080:localhost:8080 you@server`.

### 2. Choose how apps are reachable

The first sign-in asks one question, and you can change the answer later under
**Settings → Public access**:

- **On this machine only.** Nothing to set up. Apps are served at
  `http://<name>.localhost:8080`. (Chrome, Firefox and curl resolve `*.localhost`
  by themselves.)
- **On the internet, with your own domain.** Uses a Cloudflare tunnel, so no router
  ports are opened. Paste a Cloudflare API token and Dockyard does the rest: it creates
  the tunnel, routes `*.yourdomain` to it, adds the wildcard DNS record, adds a WAF rule
  so deploy hooks get past Super Bot Fight Mode, and starts the connector. The token is
  used once and not stored. Apps are then served at `https://<name>.yourdomain`.

The API token needs: Account · Cloudflare Tunnel · Edit; Zone · Zone · Read;
Zone · DNS · Edit; Zone · Zone WAF · Edit; and optionally Zone · Bot Management · Edit.
The domain must already be on Cloudflare.

Good to know:

- Turning public access off or on needs no redeploys. Apps are routed by the first part
  of their address, so each one answers on the local address and on your domain.
- Cloudflare's free certificate covers one wildcard level, so `abc.example.com` works
  but `abc.apps.example.com` would not.
- On Cloudflare's free plan, **Bot Fight Mode** can block GitHub from calling deploy
  hooks and cannot be skipped for one address. Setup reports whether it is on and can
  turn it off for you. On paid plans the skip rule for Super Bot Fight Mode is enough.
- Prefer to do the Cloudflare side yourself? Choose "I already have a tunnel" and enter
  your domain and tunnel token. The tunnel needs a published application route
  `*.yourdomain` → `HTTP` → `traefik:80` and a proxied `CNAME` `*` →
  `<tunnel-id>.cfargotunnel.com`.
- Upgrading from a version that kept `BASE_DOMAIN` and `CLOUDFLARE_TUNNEL_TOKEN` in
  `.env`: they are imported into the dashboard's settings on first start and can then be
  removed from `.env`. Run `docker compose up -d --build --remove-orphans` once to retire
  the old `cloudflared` service; Dockyard now runs the connector itself.

### 3. Lock down the dashboard (recommended with public access)

Dockyard can run anything on this machine, so put Cloudflare Access in front of it:

1. **Zero Trust → Access → Applications → Add** a self-hosted app for
   `dockyard.yourdomain` with a policy allowing only your email.
2. Add a second application for `dockyard.yourdomain/api/hooks` with a
   **Bypass** policy for Everyone, so GitHub can reach the deploy hooks. Hooks are
   protected by their own HMAC signatures.

## Deploying an app

1. **New app** → choose a single image (e.g. `nginx:alpine`, port 80) or paste a
   compose file. Dockyard deploys it at the address you pick, or a random subdomain
   if you leave it blank. You can change the address later under **Settings**; it
   takes effect on the next deploy.
2. Open **Deploy hook** on the app, pick GitHub Container Registry or Docker Hub, add
   the secrets it lists to your GitHub repo, and commit the workflow it shows (also in
   [`examples/deploy-ghcr.yml`](examples/deploy-ghcr.yml) and [`examples/deploy.yml`](examples/deploy.yml)).
   For private images, add the registry's credentials under **Settings → Registry
   credentials** so Dockyard can pull them. Docker Hub, ghcr.io and any other registry
   are supported; credentials are verified when saved and stored encrypted. (The
   `GHCR_*` and `DOCKERHUB_*` variables in `.env` still work as a fallback.)
3. Every push to `main` builds, pushes and deploys that exact image digest.
   Roll back from **Deployments** any time.

### Deploying with an AI agent

An agent such as Claude Code can take a project folder and put it live without
you touching the dashboard:

1. On the **Agents** page, create an access token. Agents sign in with it instead
   of the admin password, and you can revoke it at any time.
2. Run the setup commands shown on that page on the machine where the agent works
   (the dashboard's **Help** page walks through the install step by step).
   They save the server address and token to `~/.config/dockyard/config` and install
   the `dockyard` command. The machine also needs `git` and `jq`.
3. Choose how workflows authenticate to Dockyard:
   - **Global deploy hook** (turn it on from the Agents page): one signing secret for
     every app. Add it to each new GitHub repository as the Actions secret
     `DOCKYARD_HOOK_SECRET`. Dockyard picks the app from the image name, so the secret
     can move an app to another build of its own image but not to a foreign one.
   - **Per-app hooks** (the default): each app has its own secret, and `dockyard deploy`
     stores it in the repository for you, which needs the GitHub CLI (`gh auth login`).
4. In an app's folder, tell the agent: *Deploy this app to Dockyard. Run
   `dockyard guide` first and follow it.*

`dockyard guide` prints this server's deployment guide. `dockyard deploy --port 3000`
registers the app, adds a workflow that builds the image and pushes it to ghcr.io,
pushes the branch, and waits until the app is live. `dockyard status`, `env`, `redeploy` and `logs` cover the rest. You can
run the same commands yourself.

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

With the global deploy hook on, the same request can go to `POST /api/hooks` (no app
ID), signed with the global secret. `image` is then required: it selects the app.

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
  registries.ts   Saved registry credentials for pulling private images
  site.ts         Local or public addresses, depending on whether public access is on
  cloudflare.ts   Sets up the Cloudflare tunnel, DNS and hook rule, and runs the connector
  docker.ts       docker / docker compose CLI wrapper
  routes/         auth, apps, hooks, images, tokens, agent, registries, cloudflare
server/assets/
  dockyard        The CLI that agents and people run inside an app's repository
  agent-guide.md  The deployment guide served to agents
web/src/
  pages/          Apps list, New app, App detail with tabs, Images, Agents, Settings, Help
  components/     Shared UI
```
