# Deploy — Openrealm (client on Vercel, server on a VPS)

Architecture: the **client** is a static site (Vercel) and the **WebSocket server** is a
long-running Node process on a **VPS** (Contabo). They talk over the internet via **WSS**
(secure WebSocket). The server is authoritative; the client only sends intent.

```
  Browser (Vercel, https://<your-vercel-domain>)
        │  wss://<your-server-domain>            (secure WebSocket)
        ▼
  Reverse proxy (Caddy/nginx, TLS)  ──►  Node server (ws on 127.0.0.1:8080, under PM2)
```

> Replace every `<...>` placeholder with your real domain/IP.

---

## Environment variables (the full list)

| Variable          | Side   | Default            | What it does |
|-------------------|--------|--------------------|--------------|
| `PORT`            | server | `8080`             | TCP port the server listens on. |
| `HOST`            | server | `0.0.0.0`          | Bind address. `0.0.0.0` accepts external connections. Use `127.0.0.1` if a reverse proxy on the same box is the only client. |
| `SNAPSHOT_HZ`     | server | `10`               | Snapshots broadcast per second (smoothness vs. bandwidth). |
| `ALLOWED_ORIGINS` | server | *(empty)*          | Comma-separated allowlist of browser Origins. **Empty = dev** (localhost only). **Set in production** to your Vercel URL so only it may connect (never wide-open). |
| `VITE_SERVER_URL` | client | *(unset → localhost)* | The `wss://`/`ws://` URL the browser connects to. Set in the Vercel dashboard to `wss://<your-server-domain>`. Locally, leave unset to use `ws://localhost:8080`. |

`.env` is gitignored — copy `.env.example` to `.env` on each machine. Never commit real values.

---

## (a) Server on the VPS with PM2

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
