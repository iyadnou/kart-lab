// =============================================================================
// server/relay.js — the WebSocket "post office" between phone and game.
//
// Both pages open a WebSocket to   wss://<this server>/ws?role=...
//   role=controller   the phone
//   role=game         the game page on the Mac
//
// The relay does not understand or change the messages; it only forwards:
//   controller -> every game        (input, ~60 times per second)
//   game       -> every controller  (e.g. "rumble" when you hit a wall)
//
// It also tells each side whether the other side is present:
//   to games:        { type: 'status', controllers: <count>, controllerUrl }
//   to controllers:  { type: 'status', games: <count> }
// =============================================================================

import { WebSocketServer } from 'ws';

/**
 * @param {import('node:https').Server} server
 * @param {{controllerUrl: string}} info  sent to the game for its QR code
 */
export function attachRelay(server, info) {
  const games = new Set();
  const controllers = new Set();

  // noServer: we decide ourselves which upgrade requests belong to us. (In dev
  // mode Vite's hot-reload WebSocket lives on the same server; it must not
  // receive our connections and we must not receive its.)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'https://localhost');
    if (url.pathname !== '/ws') return; // not ours — leave it for Vite
    wss.handleUpgrade(request, socket, head, (ws) => {
      onConnection(ws, url.searchParams.get('role'));
    });
  });

  function onConnection(ws, role) {
    const isGame = role === 'game';
    const mine = isGame ? games : controllers; // the group this socket joins
    const theirs = isGame ? controllers : games; // the group it talks to
    mine.add(ws);
    console.log(`  [relay] ${isGame ? 'game' : 'controller'} connected`);
    broadcastStatus();

    ws.on('message', (data, isBinary) => {
      // Forward as-is. No parsing: the relay stays fast and simple.
      for (const peer of theirs) {
        if (peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
      }
    });

    ws.on('close', () => {
      mine.delete(ws);
      console.log(`  [relay] ${isGame ? 'game' : 'controller'} disconnected`);
      broadcastStatus();
    });

    ws.on('error', () => ws.close());
  }

  function broadcastStatus() {
    const toGames = JSON.stringify({
      type: 'status',
      controllers: controllers.size,
      controllerUrl: info.controllerUrl,
    });
    const toControllers = JSON.stringify({ type: 'status', games: games.size });
    for (const ws of games) if (ws.readyState === ws.OPEN) ws.send(toGames);
    for (const ws of controllers) if (ws.readyState === ws.OPEN) ws.send(toControllers);
  }
}
