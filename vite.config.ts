import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react(), agilaDevFavicon()],
  envPrefix: ['VITE_', 'DEMO_', 'MULTI_'] as string[],
  // Pre-bundle lazy-route deps. On the demo Vite server, discovering these on first
  // task/profile click invalidates the dep cache and full-reloads mid-render
  // (Firefox: "dispatcher is null" / Invalid hook call).
  optimizeDeps: {
    include: [
      'lucide-react',
      'react-image-crop',
      '@dnd-kit/utilities',
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
      const defaultHosts = ['localhost', '127.0.0.1'];
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
      },
      '/health': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
      },
      '/attachments': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
      },
      '/avatars': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
      },
      '/api/files/attachments': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
      },
      '/api/files/avatars': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.DOCKER_ENV === 'true' ? 'http://localhost:3222' : 'http://localhost:3222',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
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
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Preserve X-Forwarded-Host header from ingress (most reliable)
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            
            if (hostToUse) {
              // Set both headers to ensure tenant routing works
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
              // Also set X-Original-Host as fallback
              if (originalHost && originalHost !== hostToUse) {
                proxyReq.setHeader('X-Original-Host', originalHost);
              }
            }
          });
        },
      },
      '/ready': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
      '/health': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
      '/attachments': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
      '/avatars': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
      '/api/files/attachments': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
      '/api/files/avatars': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
      '/socket.io': {
        target: 'http://localhost:3222',
        changeOrigin: false,
        ws: true, // Enable WebSocket proxying
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const forwardedHost = req.headers['x-forwarded-host'];
            const originalHost = req.headers['host'];
            const hostToUse = forwardedHost || originalHost;
            if (hostToUse) {
              proxyReq.setHeader('X-Forwarded-Host', hostToUse);
              proxyReq.setHeader('Host', hostToUse);
            }
          });
        },
      },
    },
  },
});
