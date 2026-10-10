# Deploying an app to this Dockyard

This guide is for an AI agent or script deploying an app to the Dockyard server at {{URL}}.

## How deployment works here

Dockyard runs container images on one machine and gives every app an address of the
form `<address>.{{BASE_DOMAIN}}`. It does not build code.

Check `GET /api/meta` first. If `publicAccess` is `false`, this Dockyard is local-only:
GitHub cannot reach it, so the push-to-deploy flow below does not work and
`dockyard deploy` refuses to run. Tell the user to set up public access on the
dashboard's Settings page (only they can), or create the app from an existing image
with `POST /api/apps`, which works without public access.

The path from source to a live app is:

1. The app's code lives in a GitHub repository with a `Dockerfile` at its root.
2. On every push to the deploy branch, a GitHub Actions workflow builds the image
   and pushes it to GitHub Container Registry as `ghcr.io/<owner>/<repo>`.
3. The workflow then calls the app's signed deploy hook on Dockyard.
4. Dockyard pulls that exact image and replaces the running container.

The `dockyard` command below sets all of this up in one step.

## What you need

- `DOCKYARD_URL` ({{URL}}) and `DOCKYARD_TOKEN`, in the environment or in
  `~/.config/dockyard/config` as `KEY=VALUE` lines. Never print the token or commit it.
- `git`, `curl` and `jq`.
- The workflow signs its call to Dockyard with the repository secret `DOCKYARD_HOOK_SECRET`.
  Check `GET /api/meta`:
  - `github: true`: Dockyard has a GitHub token of its own and `dockyard deploy` stores
    the secret in the repository for you (only when it is missing; `--reset-secret`
    overwrites it). Nothing else is needed, whatever `globalHook` says. If Dockyard's
    token cannot reach the repository, the command stops with GitHub's reason; the user
    fixes the token's repository access on the dashboard's GitHub & Deploy Hooks page.
  - `github: false` and `globalHook: true`: one secret is shared by all apps and **the
    user adds it to the repository by hand** (GitHub repository → Settings → Secrets and
    variables → Actions). You cannot read that secret. Ask the user to confirm it is
    there before deploying. The GitHub CLI is not needed.
  - `github: false` and `globalHook: false`: each app has its own secret and
    `dockyard deploy` stores it for you, which needs the GitHub CLI `gh`, signed in
    (`gh auth status`).
- The `dockyard` command. If it is not installed, fetch it from this server:

  ```
  curl -fsS -H "Authorization: Bearer $DOCKYARD_TOKEN" {{URL}}/api/agent/cli -o dockyard && chmod +x dockyard
  ```

## Steps

1. **Make the app container-ready.**
   - It needs a `Dockerfile` at the repository root that produces a production image.
     Write one if it is missing.
   - The app must listen on `0.0.0.0` (not `127.0.0.1`) on one HTTP port. Note that port.
   - Do not bake secrets or `.env` files into the image. Runtime settings go in
     Dockyard as environment variables (step 4).
   - If you can, build and run the image locally once to confirm it starts.

2. **Make sure the code is in a GitHub repository** with a remote named `origin`, and
   that your work is committed. If there is no repository yet, ask the user before
   creating one (`gh repo create <name> --private --source . --remote origin`) unless
   they already asked you to deploy.

3. **Deploy.** From inside the repository:

   ```
   dockyard deploy --name "My App" --port 3000 --address my-app
   ```

   - `--port` is the port from step 1. It is required the first time.
   - `--address` is optional: the app is served at `my-app.{{BASE_DOMAIN}}`.
     Use lowercase letters, digits and hyphens. Without it, Dockyard picks a random one.
   - `--domain` is optional: which of the server's public domains the app lives under.
     `GET /api/meta` lists them in `domains` and the one used without the flag in
     `defaultDomain`. Only pass it when the user asks for a specific domain.
   - The command registers the app, commits `.github/workflows/dockyard.yml`, pushes
     the current branch, and waits until the app is live. It prints the address when done.
     When Dockyard has a GitHub token, or the global hook is off, it also stores the
     hook secret (and, with the global hook off, the hook URL) as GitHub secrets.
   - It is safe to run again. Later runs find the same app and redeploy it.

4. **Set environment variables, if the app needs any:**

   ```
   dockyard env DATABASE_URL=postgres://... API_KEY=...
   dockyard redeploy
   ```

5. **Verify.** `dockyard status` shows the address and container state; then request
   the address and check the response. `dockyard logs` prints recent container output.

After this, every push to the deploy branch redeploys the app automatically.

## If something fails

- **It times out, or the workflow's last step fails with 401 "Invalid signature"**:
  `DOCKYARD_HOOK_SECRET` is missing from the repository or does not match. When
  `GET /api/meta` says `github: true`, run `dockyard deploy --reset-secret` to overwrite
  it. Otherwise the user fixes it in the repository's Actions secrets, then re-runs the
  workflow from the Actions tab or pushes a new commit.
- **"the GitHub build failed"**: the image did not build. Run `gh run view --log-failed`,
  fix the Dockerfile or code, commit, and run `dockyard deploy` again.
- **Dockyard could not pull the image (denied / unauthorized)**: packages on ghcr.io
  are private by default. Either the user makes the package public on GitHub, or adds
  GitHub credentials on the dashboard's Settings page under Registry credentials (only
  the user can; API tokens cannot manage credentials). Then run `dockyard redeploy`.
  Check `GET /api/meta`: `registries.ghcr` is `true` when Dockyard already has GitHub
  credentials.
- **Containers did not reach a running or healthy state**: the app crashed on start or
  its `HEALTHCHECK` failed within 120 seconds. Read `dockyard logs`.
- **The address returns 404 or 502**: the container is up but not answering on the
  port given with `--port`, or it listens on `127.0.0.1`. Fix it and deploy again, or
  correct the port with `dockyard deploy --port <port>`.

## Limits

- One image per app through this command. Apps that need several services (for
  example a database) are created as a compose file through the API or dashboard.
- Dockyard rejects compose files that use `build`, `ports`, `privileged`, bind mounts,
  host networking or `traefik.*` labels. Use images and named volumes.
- Only HTTP on a single port is routed. HTTPS is added in front by Dockyard's proxy.
- A deploy replaces the container, so there is a gap of a second or two.

## API reference

Every request needs `Authorization: Bearer $DOCKYARD_TOKEN`. Bodies and responses are JSON.

| Call | Purpose |
| --- | --- |
| `GET /api/meta` | Address domain, the public `domains` and `defaultDomain`, whether public access and the global hook are on, whether Dockyard has a GitHub token (`github`), and which registries it has credentials for |
| `GET /api/apps` | List apps with state and address |
| `POST /api/apps` | Create: `{name, slug?, domain?, sourceType: "image", image, port, deploy?}` or `{name, slug?, domain?, sourceType: "compose", compose, primaryService?, port}` |
| `GET /api/apps/:id` | One app, with its containers |
| `PATCH /api/apps/:id` | Change `name`, `slug`, `domain`, `port`, `compose`, `primaryService` (applies on the next deploy) |
| `DELETE /api/apps/:id?volumes=true` | Remove the app; ask the user first |
| `POST /api/apps/:id/deploy` | Deploy the current settings again |
| `GET /api/apps/:id/deployments` | Deployment history, newest first |
| `GET /api/deployments/:id` | One deployment with its log |
| `POST /api/deployments/:id/rollback` | Roll back to that deployment |
| `GET` / `PUT /api/apps/:id/env` | Read or replace variables: `{vars: [{key, value}]}` |
| `GET /api/apps/:id/hook` | The deploy hook URL and signing secret |
| `POST /api/apps/:id/github-secrets` | `{repo: "owner/name", reset?: boolean}`: store the hook secret in that GitHub repository with Dockyard's token. Answers `{configured: false}` without a token; otherwise `{secrets: {NAME: "added" \| "present" \| "updated"}}`. The repository must be the one the app's ghcr.io image is built from |
| `GET /api/apps/:id/logs?tail=200` | Recent container logs (plain text) |
| `POST /api/apps/:id/actions/{start,stop,restart}` | Control the containers |

The deploy hook is `POST /api/hooks/:id` (signed with that app's secret) or, when the
global hook is on, `POST /api/hooks` (signed with the global secret; the app is the one
whose image comes from the same repository as `image`). Both take the body
`{"image": "...", "digest": "sha256:...", "commit": "..."}` and headers
`X-Dockyard-Timestamp: <unix seconds>` and
`X-Dockyard-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`.
They need no token; the signature authenticates them.
