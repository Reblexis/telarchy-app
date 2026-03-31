/**
 * Standalone server entry point — runs the same Express app on any platform
 * (Docker, Railway, Fly.io, Cloud Run, bare VPS, etc.).
 *
 * Required env vars:
 *   DATABASE_URL   — PostgreSQL connection string
 *                    e.g. postgresql://user:password@localhost:5432/telarchy
 *   API_KEY        — master API key (keep secret)
 *   TREASURY_PRIVATE_KEY — Base treasury wallet private key for the backed economy
 *
 * Optional env vars:
 *   PORT                — HTTP port (default 8080)
 *   ALLOWED_ORIGIN      — allowed browser origin, or "*" to allow all
 *   ADMIN_EMAILS        — comma-separated emails that get platform-admin access
 *   GOOGLE_CLIENT_ID    — Google OAuth client ID (for social sign-in)
 *   GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID    — GitHub OAuth client ID (for social sign-in)
 *   GITHUB_CLIENT_SECRET
 *
 * Quick start:
 *   npm run build
 *   DATABASE_URL=postgresql://... API_KEY=my-secret node lib/server.js
 */

import path from 'path';
import fs from 'fs';
import express from 'express';
import { assertTreasuryConfigured } from './lib/usdc';

import('./app').then(({ app }) => {
  assertTreasuryConfigured();

  // Serve frontend static files when bundled in self-hosted mode
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(publicDir, 'index.html'));
      }
    });
  }

  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => {
    console.log(`Telarchy server listening on port ${port}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
