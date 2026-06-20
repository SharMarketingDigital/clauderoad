# Deploy — Openrealm (client on Vercel, server on a VPS)

Architecture: the **client** is a static site (Vercel) and the **WebSocket server** is a
long-running Node process on a **VPS** (Contabo). They talk over the internet via **WSS**
(secure WebSocket). The server is authoritative; the client only sends intent.

```
  Browser (Vercel, https://<your-vercel-domain>)
        │  wss://clauderoad.shar.com.br           (secure WebSocket)
        ▼
  Reverse proxy + TLS  ──►  ClaudeRoad server (ws on :8080)
   • EasyPanel + Traefik (Docker container)  ← recommended; see "Deploy via EasyPanel"
   • or bare VPS: Caddy/nginx + PM2          ← only if Traefik isn't already on the box
```

> Replace every `<...>` placeholder with your real domain/IP.

---

## Environment variables (the full list)

| Variable          | Side   | Default            | What it does |
|-------------------|--------|--------------------|--------------|
| `PORT`            | server | `8080`             | TCP port the server listens on. |
| `HOST`            | server | `0.0.0.0`          | Bind address. `0.0.0.0` accepts external connections. Use `127.0.0.1` if a reverse proxy on the same box is the only client. |
| `SNAPSHOT_HZ`     | server | `10`               | Snapshots broadcast per second (smoothness vs. bandwidth). |
| `WORLD_SEED`      | server | `1337`             | Seed for the shared world's deterministic mob layout (optional). |
| `ALLOWED_ORIGINS` | server | *(empty)*          | Comma-separated allowlist of browser Origins. **Empty = dev** (localhost only). **Set in production** to your Vercel URL so only it may connect (never wide-open). |
| `VITE_SERVER_URL` | client | *(unset → localhost)* | The `wss://`/`ws://` URL the browser connects to. Set in the Vercel dashboard to `wss://<your-server-domain>`. Locally, leave unset to use `ws://localhost:8080`. |

`.env` is gitignored — copy `.env.example` to `.env` on each machine. Never commit real values.

---

## Deploy via EasyPanel (Docker) — recommended

If your VPS already runs **EasyPanel + Traefik** (alongside n8n, Supabase, Evolution API),
deploy the ClaudeRoad server as an isolated **Docker container** using the `Dockerfile` in the
repo root. Traefik already owns ports 80/443 and provisions TLS for every app, so you do **NOT**
install Caddy/nginx and do **NOT** touch the host's 80/443. The container only exposes its
internal port; Traefik routes the domain to it over the internal Docker network.

**Client:** unchanged — goes on Vercel (see section (c)) with `VITE_SERVER_URL=wss://clauderoad.shar.com.br`.

**Server — as an EasyPanel App:**
1. **Create the App.** EasyPanel → your project → **+ Service → App**. Source: **GitHub** (this
   repo, branch `main`). Build method: **Dockerfile** (EasyPanel auto-detects the root
   `Dockerfile`). No build/start command needed — the Dockerfile builds the bundle and runs it.
2. **Environment** (App → Environment):
   ```
   ALLOWED_ORIGINS=https://<your-vercel-domain>
   # PORT=8080 and HOST=0.0.0.0 are already baked into the Dockerfile; override only if needed.
   # SNAPSHOT_HZ=10   (optional)
   ```
   `ALLOWED_ORIGINS` must be your EXACT Vercel URL (scheme + host, no trailing slash), e.g.
   `https://clauderoad.vercel.app` — the server rejects any other browser Origin.
3. **Internal port.** Set the container's exposed/app port to **`8080`** (what the server
   listens on). EasyPanel/Traefik reach it over the Docker network — **no host port is published**.
4. **Domain.** App → Domains → add **`clauderoad.shar.com.br`** → container port `8080`. EasyPanel
   provisions TLS automatically via Traefik (Let's Encrypt), so `https://`/`wss://` on that domain
   just work. (Point the `clauderoad.shar.com.br` DNS A record at the VPS first.)
5. **Deploy.** EasyPanel builds the image and starts the container. The Docker `HEALTHCHECK` hits
   `/health`, so EasyPanel shows it healthy. Verify:
   ```
   curl https://clauderoad.shar.com.br/health      # -> ok
   ```
6. **Redeploy** on new commits: push to `main`, then hit **Deploy/Rebuild** in EasyPanel (or
   enable auto-deploy on push).

> The container is fully isolated: it depends on nothing from the host except the internal port
> Traefik routes to. Inside the container it binds `0.0.0.0:8080` (so Traefik can reach it), runs
> as a non-root user, and never binds a host port. Nothing about n8n/Supabase/Evolution/Traefik
> is touched.

---

## (a) Alternative — bare VPS with PM2 + Caddy

> ⚠️ Use this ONLY on a plain VPS where **no** reverse proxy already owns 80/443. If your box runs
> **Traefik/EasyPanel**, skip this whole section (don't install Caddy, don't touch 80/443) — use
> **Deploy via EasyPanel** above instead.

Assumes a fresh Ubuntu/Debian VPS with a domain (e.g. `<your-server-domain>`) pointing at it.

### 1. Install Node 20+ and PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm i -g pm2
```

### 2. Get the code + build the server bundle
```bash
git clone <your-repo-url> openrealm && cd openrealm
npm install                 # FULL install (NOT --production): the build needs esbuild + tsc (devDeps)
npm run build:server        # typechecks, then bundles -> dist-server/index.js (runs on plain node, NOT tsx)
```
> The *runtime* only needs `ws` (a prod dep), but `build:server` needs the devDeps, so use the
> full `npm install` here — don't use `--production`/`--omit=dev`.

### 3. Configure env + start under PM2 (robust across reboots)
Put the env in a PM2 **ecosystem file** — PM2 persists it with `pm2 save`, so it survives a
reboot (unlike `--node-args="--env-file"`, which can be silently dropped on a resurrected
process, leaving the server in dev mode and rejecting your Vercel origin). It's gitignored.

Create `ecosystem.config.cjs` in the project root:
```js
// ecosystem.config.cjs  (deploy-specific; gitignored — fill in your domain)
module.exports = {
  apps: [{
    name: 'openrealm-server',
    script: 'dist-server/index.js',
    env: {
      PORT: 8080,
      HOST: '127.0.0.1',                       // behind the reverse proxy; or 0.0.0.0 to expose directly
      SNAPSHOT_HZ: 10,
      ALLOWED_ORIGINS: 'https://<your-vercel-domain>',
    },
  }],
};
```
```bash
pm2 start ecosystem.config.cjs
pm2 save            # persist the process list (so it comes back after reboot)
pm2 startup         # run the command it prints, so PM2 starts on boot
pm2 logs openrealm-server   # CONFIRM the log shows "origins=[https://<your-vercel-domain>]" — NOT "dev"
```
> ⚠️ After a reboot, re-check `pm2 logs` shows `origins=[...]` (not `dev`). If the env didn't load,
> the server falls back to localhost-only origins and will reject the Vercel client.

To redeploy after `git pull`: `npm install && npm run build:server && pm2 restart openrealm-server`.

### 4. TLS / WSS via a reverse proxy (required for `wss://`)
Browsers on an `https://` page can only open `wss://` (not `ws://`). The Node server speaks
plain `ws`; put a proxy in front to add TLS. **Caddy** is the easiest (automatic HTTPS):

`/etc/caddy/Caddyfile`:
```
<your-server-domain> {
    reverse_proxy 127.0.0.1:8080      # Caddy proxies WS upgrades + GET /health automatically
}
```
```bash
sudo apt-get install -y caddy && sudo systemctl reload caddy
```
Now `wss://<your-server-domain>` reaches the server, and `https://<your-server-domain>/health`
returns `ok`. (nginx works too — proxy_pass with `Upgrade`/`Connection` headers.)

Open the firewall for 80/443 only (keep 8080 internal): `sudo ufw allow 80,443/tcp`.

### 5. Verify the server is up
```bash
curl https://<your-server-domain>/health      # -> ok
```

---

## (b) Environment variables — both sides at a glance

- **VPS** (the `ecosystem.config.cjs` `env`): `PORT`, `HOST`, `SNAPSHOT_HZ`, `ALLOWED_ORIGINS=https://<your-vercel-domain>`.
- **Vercel** (Project → Settings → Environment Variables): `VITE_SERVER_URL=wss://<your-server-domain>`.

These two must agree: the client connects to `VITE_SERVER_URL`, and the server only accepts
that browser if its Origin is in `ALLOWED_ORIGINS`.

---

## (c) Client on Vercel

1. **Import the repo** in Vercel (New Project → pick this GitHub repo). It's a Vite app.
2. **Build settings** (Vercel auto-detects Vite; confirm):
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
3. **Environment Variable**: add `VITE_SERVER_URL = wss://<your-server-domain>` (Production).
   (Vite inlines it at build time — redeploy after changing it.)
4. **Deploy.** Then open the site:
   - Single-player (offline): `https://<your-vercel-domain>/`
   - Multiplayer: `https://<your-vercel-domain>/?mp` → connects to your VPS over `wss://`.
   - Two players: open `?mp&name=Alice` and `?mp&name=Bob` (two tabs / two devices).

---

## Local development (unchanged)
```bash
npm run server   # ws://localhost:8080 (dev: ALLOWED_ORIGINS empty -> localhost allowed)
npm run dev      # http://localhost:5173
# open http://localhost:5173/?mp in two tabs; http://localhost:5173/ stays single-player
```

## Verify before deploying
```bash
npm run typecheck   # client + server
npm test            # 111 sim tests
npm run build       # client bundle
npm run build:server   # server bundle -> dist-server/
```
