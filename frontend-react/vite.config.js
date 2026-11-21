// Configuración de Vite para LearnTrack: modo monolítico (Express sirve React) y modo estático (GitHub Pages).
// La compilación mantiene chunks diferidos para la zona autenticada, pero en GitHub Pages esos archivos son públicos.
// La seguridad de los datos nunca depende de ocultar el JavaScript: Express valida la sesión en cada endpoint /api.
// VITE_BASE_PATH controla la subruta (por defecto /LearnTrack/ en Pages y / en desarrollo).
// VITE_API_URL apunta al origen HTTPS de Express cuando frontend y API se publican por separado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { ZONA_PRIVADA } from './zonas.config.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const CARPETAS_PRIVADAS = ZONA_PRIVADA.map((c) => path.join(aqui, 'src', ...c.split('/')) + path.sep);
const CARPETA_COMPARTIDA = path.join(raiz, 'compartido') + path.sep;
const normal = (id) => path.normalize(id.split('?')[0]);
const esModuloPrivado = (id) => CARPETAS_PRIVADAS.some((c) => normal(id).startsWith(c));
const esModuloCompartido = (id) => normal(id).startsWith(CARPETA_COMPARTIDA);

/**
 * Un chunk es privado si contiene código de las carpetas de ZONA_PRIVADA (zonas.config.js), o si SOLO contiene reglas de compartido/ (que hoy usa solo
 * la zona privada). Rollup no mezcla en un chunk código que solo usa la zona privada con código de la pública.
 * tests/integracion/frontend-react.test.js comprueba que todo lo que necesita la zona pública queda en r/publico.
 */
const chunkPrivado = (chunk) => {
    const ids = (chunk.moduleIds ?? Object.keys(chunk.modules ?? {})).filter((id) => !id.startsWith('\0'));
    return ids.some(esModuloPrivado) || (ids.length > 0 && ids.every(esModuloCompartido));
};

/**
 * Coloca el CSS de los chunks privados en r/privado/ (Vite le pone el nombre del chunk, no sabe nada de carpetas).
 * Recorre el paquete final: cada CSS importado SOLO por chunks privados se mueve y se reescriben sus referencias.
 */
function cssPrivado() {
    return {
        name: 'learntrack-css-privado',
        enforce: 'post',
        generateBundle(_opciones, paquete) {
            const usos = new Map();                                   // css → { privado: bool, publico: bool }
            for (const salida of Object.values(paquete)) {
                if (salida.type !== 'chunk') continue;
                const privado = salida.fileName.startsWith('r/privado/');
                for (const css of salida.viteMetadata?.importedCss ?? []) {
                    const u = usos.get(css) ?? { privado: false, publico: false };
                    u[privado ? 'privado' : 'publico'] = true;
                    usos.set(css, u);
                }
            }
            const renombrar = new Map();
            for (const [css, u] of usos) {
                if (u.privado && !u.publico && css.startsWith('r/publico/')) renombrar.set(css, css.replace('r/publico/', 'r/privado/'));
            }
            if (!renombrar.size) return;
            for (const [antes, despues] of renombrar) {
                const asset = paquete[antes];
                asset.fileName = despues;
                paquete[despues] = asset;
                delete paquete[antes];
            }
            for (const salida of Object.values(paquete)) {
                if (salida.type === 'chunk') {
                    for (const [antes, despues] of renombrar) {
                        // Rutas relativas entre chunks (../publico/x.css) y absolutas (/r/publico/x.css)
                        salida.code = salida.code.split(antes).join(despues).split(`../publico/${path.basename(antes)}`).join(`../privado/${path.basename(despues)}`);
                        if (salida.viteMetadata?.importedCss?.has(antes)) {
                            salida.viteMetadata.importedCss.delete(antes);
                            salida.viteMetadata.importedCss.add(despues);
                        }
                    }
                } else if (salida.fileName.endsWith('.html')) {
                    for (const [antes, despues] of renombrar) salida.source = String(salida.source).split(antes).join(despues);
                }
            }
        }
    };
}

export default defineConfig(({ mode }) => {
    const entorno = loadEnv(mode, raiz, '');
    const apiUrl = String(process.env.VITE_API_URL ?? entorno.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
    // Las pruebas (vitest, modo «test») usan SIEMPRE la API local y la base «/»: así no dependen de las variables de
    // GitHub Pages que haya en la terminal o en el .env (p. ej. tras «npm run build:pages»), que las rompían todas.
    const enPruebas = mode === 'test';
    const base = enPruebas ? '/' : process.env.VITE_BASE_PATH || entorno.VITE_BASE_PATH || (mode === 'github-pages' ? '/LearnTrack/' : '/');
    const rutaBase = (ruta) => `${base}${String(ruta).replace(/^\/+/, '')}`;
    return ({
    root: aqui,
    base,
    publicDir: 'public',
    plugins: [
        { name: 'learntrack-html-env', transformIndexHtml: (html) => html.replaceAll('%VITE_API_URL%', apiUrl) },
        react(),
        cssPrivado(),
        VitePWA({
            // Sin aviso de «versión nueva» (src/app/ActualizacionPWA.jsx): el SW nuevo espera (skipWaiting: false) y
            // se activa solo al cerrar la app, así nunca se sustituye el código en mitad de una sesión.
            registerType: 'prompt',
            injectRegister: false,
            strategies: 'generateSW',
            filename: 'sw.js',
            manifestFilename: 'manifest.webmanifest',
            manifest: {
                id: base,
                name: 'LearnTrack — Planificador de carga mental',
                short_name: 'LearnTrack',
                description: 'Organiza estudio, trabajo y descanso midiendo tu carga mental, con un asistente de IA local.',
                lang: 'es',
                dir: 'ltr',
                start_url: rutaBase('panel'),
                scope: base,
                display: 'standalone',
                orientation: 'any',
                background_color: '#f4f6f9',
                theme_color: '#2b3a67',
                categories: ['education', 'productivity'],
                icons: [
                    { src: rutaBase('recursos/iconos/pwa-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: rutaBase('recursos/iconos/pwa-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
                    { src: rutaBase('recursos/iconos/pwa-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: {
                // CACHÉ CONSERVADORA: recursos estáticos públicos. La API nunca se cachea; la autorización de datos se hace en Express.
                globPatterns: ['r/publico/**/*.{js,css,woff2}', 'recursos/**/*.{svg,ico,png,avif}', 'offline.html', 'offline.css', 'tema-inicial.js'],
                globIgnores: ['r/privado/**', 'index.html', '**/imagenes/fondo.png'],
                maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
                navigateFallback: null,
                cleanupOutdatedCaches: true,
                clientsClaim: false,
                skipWaiting: false,
                runtimeCaching: [
                    {
                        // Navegaciones: SIEMPRE a la red (sesión, redirecciones y 404 los decide Express). Sin red: offline.html
                        urlPattern: ({ request }) => request.mode === 'navigate',
                        handler: 'NetworkOnly',
                        options: { precacheFallback: { fallbackURL: rutaBase('offline.html') } }
                    }
                ]
            },
            devOptions: { enabled: false }
        })
    ],
    resolve: {
        alias: { '@compartido': path.join(raiz, 'compartido') }
    },
    server: {
        port: 5173,
        strictPort: true,
        fs: { allow: [aqui, path.join(raiz, 'compartido'), path.join(raiz, 'node_modules')] },
        // Solo en desarrollo: Vite reenvía la API a Express SIN cambiar Host ni Origin (changeOrigin: false), así la
        // comprobación de Origin del servidor (CSRF) sigue activa y la cookie SameSite=Strict funciona en localhost:5173.
        proxy: {
            '/api': { target: `http://localhost:${process.env.PORT || 3000}`, changeOrigin: false }
        }
    },
    preview: { port: 4173 },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        assetsDir: 'r/publico',
        sourcemap: mode === 'development',
        target: 'es2022',
        cssCodeSplit: true,
        rollupOptions: {
            output: {
                entryFileNames: 'r/publico/[name]-[hash].js',
                chunkFileNames: (chunk) => (chunkPrivado(chunk) ? 'r/privado/[name]-[hash].js' : 'r/publico/[name]-[hash].js'),
                assetFileNames: 'r/publico/[name]-[hash][extname]'
            }
        }
    },
    test: {
        environment: 'jsdom',
        globals: false,
        setupFiles: ['./src/pruebas/preparar.js'],
        include: ['src/**/*.test.{js,jsx}'],
        css: false,
        restoreMocks: true,
        env: { VITE_API_URL: '', VITE_BASE_PATH: '/' }
    }
    });
});
