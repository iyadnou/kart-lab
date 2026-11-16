// Vite configuration.
//
// In development Vite is used as middleware inside our own HTTPS server
// (server/index.js), so there are no dev-server settings here. This file only
// tells `npm run build` that the project has two pages.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: 'index.html',
        controller: 'controller/index.html',
      },
    },
    // Three.js + Rapier are big; silence the size warning.
    chunkSizeWarningLimit: 6000,
  },
});
