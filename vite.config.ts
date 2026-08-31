import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

const BENIGN_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECANCELED']);

/** Client disconnects (OAuth redirect, CF tunnel, tab close) must not take down the dev/preview server. */
function attachBenignSocketErrorHandler(httpServer: import('http').Server | null | undefined) {
  httpServer?.on('connection', (socket) => {
    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code && BENIGN_SOCKET_CODES.has(err.code)) return;
      console.warn('[vite] client socket error:', err.message);
    });
  });
}

function attachProxyResilience(proxy: { on: (event: string, handler: (...args: any[]) => void) => void }) {
  proxy.on('error', (err: NodeJS.ErrnoException, _req: unknown, res: { headersSent?: boolean; writeHead?: Function; end?: Function }) => {
    if (err.code && BENIGN_SOCKET_CODES.has(err.code)) return;
    console.warn('[vite-proxy] error:', err.code || err.message);
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502);
      res.end?.();
    }
  });
}

function resilientProxyConfigure(
  proxy: Parameters<NonNullable<import('vite').ProxyOptions['configure']>>[0],
  options: Parameters<NonNullable<import('vite').ProxyOptions['configure']>>[1],
  extra?: (proxy: typeof proxy, options: typeof options) => void
) {
  attachProxyResilience(proxy);
  extra?.(proxy, options);
}

function withForwardedHostProxyConfigure(
  proxy: Parameters<NonNullable<import('vite').ProxyOptions['configure']>>[0],
  options: Parameters<NonNullable<import('vite').ProxyOptions['configure']>>[1]
) {
  resilientProxyConfigure(proxy, options, (p, _o) => {
    p.on('proxyReq', (proxyReq, req, _res) => {
      const forwardedHost = req.headers['x-forwarded-host'];
      const originalHost = req.headers['host'];
      const hostToUse = forwardedHost || originalHost;

      if (hostToUse) {
        proxyReq.setHeader('X-Forwarded-Host', hostToUse);
        proxyReq.setHeader('Host', hostToUse);
        if (originalHost && originalHost !== hostToUse) {
          proxyReq.setHeader('X-Original-Host', originalHost);
        }
      }
    });
  });
}

function ignoreBenignSocketErrors(): Plugin {
  return {
    name: 'agila-ignore-benign-socket-errors',
    configureServer(server: ViteDevServer) {
      attachBenignSocketErrorHandler(server.httpServer);
    },
    configurePreviewServer(server: PreviewServer) {
      attachBenignSocketErrorHandler(server.httpServer);
    },
  };
}

/** Swap the tab icon on the Vite dev server so local tabs are obvious vs production. */
function agilaDevFavicon(): Plugin {
  return {
    name: 'agila-dev-favicon',
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      return html.replaceAll('/agila-favicon.png', '/agila-favicon-dev.png');
    }
  };
}

export default defineConfig({
  plugins: [react(), agilaDevFavicon(), ignoreBenignSocketErrors()],
  envPrefix: ['VITE_', 'DEMO_', 'MULTI_'] as string[],
  // A second React copy makes every hook call fail ("dispatcher is null")
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  // Pre-bundle lazy-route deps. On the demo Vite server, discovering these on first
  // task/profile click invalidates the dep cache and full-reloads mid-render
  // (Firefox: "dispatcher is null" / Invalid hook call).
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-i18next',
      'i18next',
      'i18next-browser-languagedetector',
      'lucide-react',
      'react-image-crop',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/modifiers',
      '@dnd-kit/utilities',
      'axios',
      'dompurify',
      'socket.io-client',
      'recharts',
      'react-joyride',
      'marked',
      'exceljs',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/extension-link',
      '@tiptap/extension-underline',
      '@tiptap/extension-text-align',
      '@tiptap/extension-bullet-list',
      '@tiptap/extension-ordered-list',
      '@tiptap/extension-list-item',
      '@tiptap/extension-image',
      '@tiptap/extension-heading',
      '@tiptap/extension-strike',
      '@tiptap/extension-code',
      '@tiptap/extension-code-block',
      '@tiptap/extension-table',
      '@tiptap/extension-table-row',
      '@tiptap/extension-table-header',
      '@tiptap/extension-table-cell',
    ],
  },
  define: {
    // Always emit string literals (undefined would skip replacement and break demo UI)
    'process.env.DEMO_ENABLED': JSON.stringify(process.env.DEMO_ENABLED === 'true' ? 'true' : 'false'),
    'process.env.MULTI_TENANT': JSON.stringify(process.env.MULTI_TENANT === 'true' ? 'true' : 'false'),
  },
  build: {
    // Ensure proper code splitting and asset handling
    rollupOptions: {
      output: {
        // Ensure dynamic imports are properly transformed
        manualChunks: undefined, // Let Vite handle chunking automatically
      },
    },
    // Ensure source maps don't interfere with production builds
    sourcemap: false,
    // Ensure proper minification
    minify: 'esbuild',
  },
  server: {
    // Demo stacks disable HMR/watch to avoid churn + Socket.IO noise; normal dev keeps file watching
    ...(process.env.DEMO_ENABLED === 'true'
      ? { watch: { ignored: ['**/*'] } }
      : {}),
    host: '0.0.0.0',
    port: 3010,
    hmr: false, // Disable Hot Module Reload to prevent Socket.IO connection loops
    ws: false, // Disable WebSocket completely
    allowedHosts: (() => {
      // Extract hostnames from ALLOWED_ORIGINS (which may contain full URLs)
      const defaultHosts = ['localhost', '127.0.0.1', 'auth.agila.dev'];
      if (process.env.ALLOWED_ORIGINS) {
        const hosts = new Set(defaultHosts);
        process.env.ALLOWED_ORIGINS.split(',').forEach(origin => {
          // Remove protocol (http:// or https://) and port if present
          const hostname = origin.trim()
            .replace(/^https?:\/\//, '') // Remove protocol
            .replace(/:\d+$/, '') // Remove port
            .split('/')[0]; // Take only the hostname part
          if (hostname && hostname !== 'true' && hostname !== 'false') {
            hosts.add(hostname);
          }
        });
        return Array.from(hosts);
      }
      return defaultHosts;
    })(),
    // CORS headers removed - let Express handle all CORS
    proxy: {
      '/api': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
      '/health': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
      '/attachments': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
      '/avatars': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
      '/api/files/attachments': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
      '/api/files/avatars': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
      '/socket.io': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
        configure: (proxy, options) => resilientProxyConfigure(proxy, options),
      },
    },
  },
  // Preview server configuration (for production)
  preview: {
    host: '0.0.0.0',
    port: 3010,
    // Allow all hosts in preview mode (needed for multi-tenant deployments)
    // In multi-tenant mode, we don't know all hostnames in advance (e.g., tenant.agila.dev, app.agila.dev, etc.)
    // Security is handled by nginx reverse proxy which validates hostnames before forwarding requests
    // Use true to disable host checking (allows all hosts)
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3222',
        changeOrigin: false, // Preserve original Host header for tenant routing
        headers: {
          // Preserve the original Host header from the incoming request
          // This allows tenant routing to extract tenant ID from hostname
        },
        configure: withForwardedHostProxyConfigure,
      },
      '/ready': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: withForwardedHostProxyConfigure,
      },
      '/health': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: withForwardedHostProxyConfigure,
      },
      '/attachments': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: withForwardedHostProxyConfigure,
      },
      '/avatars': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: withForwardedHostProxyConfigure,
      },
      '/api/files/attachments': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: withForwardedHostProxyConfigure,
      },
      '/api/files/avatars': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: withForwardedHostProxyConfigure,
      },
      '/socket.io': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        ws: true, // Enable WebSocket proxying
        configure: withForwardedHostProxyConfigure,
      },
    },
  },
});
