// Registro del service worker (vite-plugin-pwa). Solo en producción y en contexto seguro (HTTPS o localhost).
// El SW se sirve en /sw.js con alcance «/»: precachea SOLO recursos públicos y estáticos (ver vite.config.js).
export function registrarPWA({ alHaberNueva }) {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    import('virtual:pwa-register').then(({ registerSW }) => {
        const actualizar = registerSW({
            immediate: true,
            onNeedRefresh() { alHaberNueva(() => actualizar(true)); },
            onRegisterError(e) { console.warn('No se pudo registrar el service worker:', e?.message ?? e); }
        });
    }).catch(() => { /* sin PWA: la web funciona igual */ });
}
