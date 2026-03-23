/**
 * Standalone server entry point — runs the same Express app as the Cloud Function
 * but as a plain Node.js HTTP server. Use this to self-host on any platform
 * (Cloud Run, Railway, Fly.io, Docker, bare VPS, etc.).
 *
 * Required env vars:
 *   API_KEY                — your chosen master API key (keep secret)
 *
 * Optional env vars:
 *   DATA_SERVICE_ACCOUNT   — base64-encoded Firebase service account JSON
 *                            (only needed outside Google Cloud; on Cloud Run / GCE
 *                            Application Default Credentials are used automatically)
 *
 * Other optional env vars:
 *   PORT                   — HTTP port (default 8080)
 *   ALLOWED_ORIGIN         — allowed browser origin, or "*" to allow all
 *   ADMIN_EMAILS           — comma-separated emails that get admin access
 *
 * Quick start (outside Google Cloud):
 *   npm run build
 *   DATA_SERVICE_ACCOUNT=$(base64 -w0 serviceAccount.json) \
 *   API_KEY=my-secret-key \
 *   node lib/server.js
 *
 * On Google Cloud Run — just set API_KEY; credentials are automatic.
 */

import * as admin from 'firebase-admin';

// Firebase must be initialized before any route handler imports run.
// DATA_SERVICE_ACCOUNT is optional when running on Google Cloud (Cloud Run, GCE, etc.)
// because Application Default Credentials are available automatically in that environment.
const serviceAccountEnv = process.env.DATA_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  const serviceAccount = JSON.parse(Buffer.from(serviceAccountEnv, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp(); // uses ADC — works on Cloud Run, GCE, and local gcloud auth
}

// Import app after Firebase init so route handlers can call getFirestore() safely.
import('./app').then(({ app }) => {
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => {
    console.log(`Telarchy server listening on port ${port}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
