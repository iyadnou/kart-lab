// =============================================================================
// server/index.js — the one process that `npm run dev` starts.
//
// It is a single HTTPS server that does three jobs:
//   1. serves the two web pages:   /            -> the game (open on the Mac)
//                                  /controller  -> the phone controller
//   2. in dev mode, lets Vite transform and hot-reload the source files
//   3. relays WebSocket messages between phone and game (see relay.js)
//
// Why HTTPS? iPhones only allow a web page to read the tilt sensors on a
// "secure" page, so plain http:// would not work. We create our own
// certificate (see certificate.js); browsers show a warning for it once.
//
//   npm run dev     development mode (Vite middleware, hot reload)
//   npm run build   bundle the pages into dist/
//   npm start       serve the built files from dist/ (no Vite needed)
// =============================================================================

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCertificate } from './certificate.js';
import { getLanAddresses } from './network.js';
import { attachRelay } from './relay.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const IS_PROD = process.argv.includes('--prod');

// Which HTML file answers which URL.
const PAGES = {
  '/': 'index.html',
  '/controller': 'controller/index.html',
  '/controller/': 'controller/index.html',
};

const lanAddresses = getLanAddresses();
const certificate = await getCertificate(path.join(ROOT, '.cert'), lanAddresses);
const server = https.createServer(certificate);

// The address the phone should open. If the Mac has no network, fall back
// to localhost so the game still runs with the keyboard.
const host = lanAddresses[0] ?? 'localhost';
const gameUrl = `https://localhost:${PORT}/`;
const controllerUrl = `https://${host}:${PORT}/controller`;

// --- Pages and files ------------------------------------------------------------
if (IS_PROD) {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) {
    console.error('No dist/ folder. Run "npm run build" first, or use "npm run dev".');
    process.exit(1);
  }
  server.on('request', (req, res) => serveBuiltFile(dist, req, res));
} else {
  // Vite in "middleware mode": it does not open its own server, it just
  // gives us a request handler that we plug into ours.
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: ROOT,
    appType: 'custom', // we serve the HTML pages ourselves (below)
    server: {
      middlewareMode: true,
      hmr: { server }, // hot-reload messages share our HTTPS server
    },
  });

  server.on('request', async (req, res) => {
    const pathname = new URL(req.url, 'https://localhost').pathname;
    const page = PAGES[pathname];
    if (!page) {
      // Not a page: let Vite serve scripts, styles and npm packages.
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
      return;
    }
    try {
      const raw = fs.readFileSync(path.join(ROOT, page), 'utf8');
      const html = await vite.transformIndexHtml(req.url, raw);
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      console.error(error);
      res.writeHead(500).end(String(error));
    }
  });
}

// --- WebSocket relay ----------------------------------------------------------------
attachRelay(server, { controllerUrl });

// --- Go -----------------------------------------------------------------------------
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other program or run: PORT=5180 npm run dev`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Kart Lab is running');
  console.log('');
  console.log(`  Game (open on this Mac):   ${gameUrl}`);
  console.log(`  Controller (open on phone): ${controllerUrl}`);
  for (const other of lanAddresses.slice(1)) {
    console.log(`                              https://${other}:${PORT}/controller`);
  }
  console.log('');
  console.log('  The phone must be on the same Wi-Fi. Both browsers will warn about');
  console.log('  the self-signed certificate once: choose "Advanced" / "Show details"');
  console.log('  and continue to the site.');
  if (lanAddresses.length === 0) {
    console.log('');
    console.log('  No network found: the phone cannot connect, keyboard only.');
  }
  console.log('');
});

// =============================================================================
// A tiny static file server for the production build
// =============================================================================

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveBuiltFile(dist, req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
  const file = path.join(dist, PAGES[pathname] ?? pathname);
  // Never serve anything outside dist/ (e.g. a request for /../secret).
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
