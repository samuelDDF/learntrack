// Configuración de Vite para el frontend React de LearnTrack (v3.6).
//
// SALIDA (frontend-react/dist), pensada para que Express la sirva con las mismas reglas de seguridad que el frontend
// clásico:
//   dist/index.html              → la única página (Express la entrega en / , /planificador, /panel…; las privadas
//                                  solo con sesión)
//   dist/r/publico/…             → JS y CSS de la parte pública (inicio, acceso, páginas informativas). Sin sesión.
//   dist/r/privado/…             → JS y CSS de Mi panel, Mi agenda, Proyectos, Repaso y Configuración. Express solo
//                                  los entrega con sesión (401 sin ella), igual que la protección de recursos privados del servidor.
//   dist/sw.js, manifest…        → PWA (service worker conservador: solo recursos públicos y estáticos).
//
// Un archivo es PRIVADO si su código sale de src/privado/. tests/integracion/frontend-react.test.js comprueba que
// ningún módulo público importe código privado (salvo la carga diferida de la zona privada en src/App.jsx).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const CARPETA_PRIVADA = path.join(aqui, 'src', 'privado') + path.sep;
const CARPETA_COMPARTIDA = path.join(raiz, 'compartido') + path.sep;
const normal = (id) => path.normalize(id.split('?')[0]);
const esModuloPrivado = (id) => normal(id).startsWith(CARPETA_PRIVADA);
const esModuloCompartido = (id) => normal(id).startsWith(CARPETA_COMPARTIDA);

/**
 * Un chunk es privado si contiene código de src/privado, o si SOLO contiene reglas de compartido/ (que hoy usa solo
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

export default defineConfig(({ mode }) => ({
    root: aqui,
    base: '/',
    publicDir: 'public',
    plugins: [
        react(),
        cssPrivado(),
        VitePWA({
            // El aviso «Nueva versión disponible» lo muestra la app (src/comun/ActualizacionPWA.jsx): nunca se
            // sustituye el código en mitad de una sesión sin que la persona lo acepte.
            registerType: 'prompt',
            injectRegister: false,
            strategies: 'generateSW',
            filename: 'sw.js',
            manifestFilename: 'manifest.webmanifest',
            manifest: {
                id: '/',
                name: 'LearnTrack — Planificador de carga mental',
                short_name: 'LearnTrack',
                description: 'Organiza estudio, trabajo y descanso midiendo tu carga mental, con un asistente de IA local.',
                lang: 'es',
                dir: 'ltr',
                start_url: '/panel',
                scope: '/',
                display: 'standalone',
                orientation: 'any',
                background_color: '#f4f6f9',
                theme_color: '#2b3a67',
                categories: ['education', 'productivity'],
                icons: [
                    { src: '/recursos/iconos/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: '/recursos/iconos/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                    { src: '/recursos/iconos/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: {
                // CACHÉ CONSERVADORA: solo lo público y estático. Nada de /api, nada de r/privado (requiere sesión),
                // y el HTML nunca se sirve desde la caché: las páginas privadas siempre pasan por el servidor.
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
                        options: { precacheFallback: { fallbackURL: '/offline.html' } }
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
        restoreMocks: true
    }
}));
