import { createServer } from 'http';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables (.env.local takes precedence)
config({ path: join(__dirname, '../.env.local') });
config({ path: join(__dirname, '../.env') });

// Register process-level error handlers before anything else
import './process-handlers.js';

async function main() {
  // Load secrets from SSM in production (before importing app).
  // On non-AWS platforms (Railway, etc.), loadProductionSecrets() returns
  // early when USE_SSM is not set, falling back to injected env vars.
  if (process.env.NODE_ENV === 'production') {
    const { loadProductionSecrets } = await import('./config/ssm.js');
    await loadProductionSecrets();
  }

  // Now import app + logger after secrets are loaded
  const { createApp } = await import('./app.js');
  const { setupCollaboration } = await import('./collaboration/index.js');
  const { logger } = await import('./config/logger.js');

  const PORT = process.env.PORT || 3000;
  const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

  const app = createApp(CORS_ORIGIN);
  const server = createServer(app);

  // DDoS protection: Set server-wide timeouts to prevent slow-read attacks (Slowloris)
  const SERVER_TIMEOUT_MS = 60_000;
  const KEEP_ALIVE_TIMEOUT_MS = 65_000;
  const HEADERS_TIMEOUT_MS = 66_000;
  server.timeout = SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  // Setup WebSocket collaboration server
  setupCollaboration(server);

  // Start server
  server.listen(PORT, () => {
    logger.info({ port: PORT, corsOrigin: CORS_ORIGIN }, 'API server started');
  });
}

main().catch((err) => {
  // Use console.error here as logger may not be initialized yet
  console.error('Failed to start server:', err);
  process.exit(1);
});
