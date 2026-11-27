import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assignments } from './assignments.js';
import { Store } from './db.js';
import { createApp } from './http.js';
import { attachRealtime } from './realtime.js';

export function startServer(opts: { port: number; dbFile: string; clientDir?: string; secureCookies?: boolean }) {
  const store = new Store(opts.dbFile);
  const assignments = new Assignments(store);
  const app = createApp(store, assignments, { secureCookies: !!opts.secureCookies, clientDir: opts.clientDir });
  const httpServer = createServer(app);
  httpServer.headersTimeout = 30_000;
  httpServer.requestTimeout = 60_000;
  const { io, manager } = attachRealtime(httpServer, store, { corsOrigin: process.env.CORS_ORIGIN });

  const ready = new Promise<number>((resolve) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr ? addr.port : opts.port);
    });
  });

  async function close() {
    manager.shutdown();
    await new Promise<void>((r) => io.close(() => r()));
    await new Promise<void>((r) => httpServer.close(() => r()));
    store.db.close();
  }

  return { ready, close, manager, store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = here.includes(`${path.sep}dist-server${path.sep}`) ? path.resolve(here, '../..') : path.resolve(here, '..');
  const port = Number(process.env.PORT) || 3000;
  const dataDir = process.env.DATA_DIR || path.join(root, 'data');
  const prod = process.env.NODE_ENV === 'production';
  const server = startServer({
    port,
    dbFile: path.join(dataDir, 'gaskuis.db'),
    clientDir: path.join(root, 'dist-client'),
    secureCookies: prod && process.env.INSECURE_COOKIES !== '1',
  });
  server.ready.then((p) => console.log(`GasKuis berjalan di http://localhost:${p}`));

  let closing = false;
  const shutdown = (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`${sig} diterima, menutup server...`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
}
