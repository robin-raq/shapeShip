import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Read API port from environment or .ports file (created by scripts/dev.sh)
function getApiPort(): number {
  // Check for explicit API_PORT env var first (used by testcontainers)
  if (process.env.API_PORT) {
    return parseInt(process.env.API_PORT, 10);
  }

  const portsFile = resolve(__dirname, '../.ports');
  if (existsSync(portsFile)) {
    const content = readFileSync(portsFile, 'utf-8');
    const match = content.match(/^API=(\d+)/m);
    if (match) return parseInt(match[1], 10);
  }
  // Fallback to default
  return 3000;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiPort = getApiPort();

  // Proxy configuration shared between dev and preview servers
  const proxyConfig = {
    '/api': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
    },
    '/collaboration': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
      ws: true,
    },
    '/events': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
      ws: true,
    },
  };

  return {
    plugins: [
      react(),
      process.env.BUNDLE_ANALYZE === '1' &&
        visualizer({
          filename: resolve(__dirname, '../../audit/stats.html'),
          open: false,
          gzipSize: true,
          brotliSize: true,
        }),
      svgr({
        // Allow importing SVGs as React components with ?react suffix
        // e.g., import CheckIcon from '@uswds/uswds/dist/img/usa-icons/check.svg?react'
        svgrOptions: {
          // Use currentColor for fill to match existing icon patterns
          plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
          svgoConfig: {
            plugins: [
              {
                name: 'preset-default',
                params: {
                  overrides: {
                    removeViewBox: false,
                  },
                },
              },
              // Replace hardcoded colors with currentColor
              {
                name: 'convertColors',
                params: {
                  currentColor: true,
                },
              },
            ],
          },
        },
      }),
    ],
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            // React + Router + Query — loaded on every route
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router-dom/') ||
              id.includes('@tanstack/react-query')
            ) {
              return 'vendor-react';
            }

            // Editor core — only needed on document editing routes
            if (
              id.includes('@tiptap') ||
              id.includes('prosemirror') ||
              id.includes('lowlight') ||
              id.includes('highlight.js')
            ) {
              return 'vendor-editor';
            }

            // Collaboration stack — only needed alongside the editor
            if (
              id.includes('/yjs/') ||
              id.includes('/y-websocket/') ||
              id.includes('/y-indexeddb/') ||
              id.includes('/lib0/')
            ) {
              return 'vendor-collab';
            }

            // UI primitives — dialogs, tooltips, drag-and-drop, command palette
            if (
              id.includes('@dnd-kit') ||
              id.includes('/cmdk/') ||
              id.includes('@radix-ui')
            ) {
              return 'vendor-ui';
            }

            // Emoji picker — only loaded when user opens the picker
            if (id.includes('emoji-picker-react')) {
              return 'vendor-emoji';
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: parseInt(env.VITE_PORT || '5173'),
      strictPort: true,
      proxy: proxyConfig,
    },
    // Preview server config - used by `vite preview` for E2E tests
    // This is MUCH lighter weight than the dev server (no HMR, no watchers)
    preview: {
      port: parseInt(env.VITE_PORT || '4173'),
      strictPort: true,
      proxy: proxyConfig,
    },
  };
});
