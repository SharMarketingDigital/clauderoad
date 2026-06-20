/// <reference types="vite/client" />

// Typed client env vars (Vite inlines VITE_-prefixed vars at build time). Set these in
// a `.env` locally or in the Vercel dashboard for production. See .env.example.
interface ImportMetaEnv {
  // The WebSocket URL of the authoritative server. Supports ws:// and wss:// (secure).
  // Unset -> the client falls back to ws://<current-host>:8080 for local dev.
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
