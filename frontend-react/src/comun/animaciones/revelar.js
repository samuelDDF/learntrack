// Núcleo del sistema de animaciones de LearnTrack (v3.8). Sin dependencias: CSS + IntersectionObserver + Web Animations.
//
//  · Animaciones de entrada: los elementos con data-revelar (o data-revelar-grupo) se animan al entrar en pantalla.
//    UN SOLO IntersectionObserver para toda la aplicación; cada elemento se observa una vez y se deja de observar en
//    cuanto aparece (o al desmontarse). Si el navegador no tiene IntersectionObserver o la persona prefiere menos
//    movimiento, NO se oculta nada: la clase lt-js (que activa el estado inicial oculto) solo se pone cuando todo
//    está disponible. Si este archivo no llega a ejecutarse, el contenido simplemente se ve sin animación.
//  · Contadores (Contador.jsx): registra la propiedad CSS --lt-n como entero para poder animarla en CSS puro.
//  · animarCambio(): animación breve con la Web Animations API (solo transform y opacity) para cambios de mes,
//    destellos al editar o salidas al eliminar. Respeta «reducir movimiento» y no hace nada si el navegador no la tiene.

const CLASE_VISIBLE = 'lt-visible';
let observador = null;

/** true si la persona pidió reducir el movimiento (en el sistema operativo o el navegador) */
export function prefiereMenosMovimiento() {
    try {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
}

const hayObservador = () => typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';

function obtenerObservador() {
    if (observador || !hayObservador()) return observador;
    observador = new window.IntersectionObserver((entradas) => {
        for (const e of entradas) {
            if (!e.isIntersecting) continue;
            e.target.classList.add(CLASE_VISIBLE);
            observador.unobserve(e.target);              // una sola vez: después ya no cuesta nada
        }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    return observador;
}

/**
 * Prepara el documento (una vez, en main.jsx). Activa el estado inicial oculto SOLO si se puede revelar después.
 * Devuelve true si las animaciones de entrada quedan activas.
 */
export function iniciarAnimaciones(raiz = document.documentElement) {
    registrarPropiedadContador();
    if (!hayObservador() || prefiereMenosMovimiento()) {
        raiz.classList.remove('lt-js');
        return false;
    }
    raiz.classList.add('lt-js');
    // Si la preferencia cambia con la página abierta, se respeta al momento (y no queda nada oculto)
    try {
        window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => {
            raiz.classList.toggle('lt-js', !e.matches);
        });
    } catch { /* navegadores antiguos */ }
    return true;
}

/** Empieza a vigilar un elemento. Sin observador disponible lo muestra al instante. */
export function observar(el) {
    if (!el) return;
    const io = obtenerObservador();
    if (!io) { el.classList.add(CLASE_VISIBLE); return; }
    if (el.classList.contains(CLASE_VISIBLE)) return;
    io.observe(el);
}

/** Deja de vigilar (al desmontar el componente) */
export function dejarDeObservar(el) {
    if (el && observador) observador.unobserve(el);
}

let contadorRegistrado = false;
/** --lt-n como <integer>: permite que CSS interpole números (contadores) sin JavaScript por fotograma */
export function registrarPropiedadContador(raiz = document.documentElement) {
    if (contadorRegistrado) return true;
    try {
        if (typeof window.CSS?.registerProperty !== 'function') return false;
        window.CSS.registerProperty({ name: '--lt-n', syntax: '<integer>', inherits: true, initialValue: '0' });
    } catch (e) {
        // InvalidModificationError: ya estaba registrada (recarga en caliente de Vite). Cualquier otro error: sin contadores.
        if (e?.name !== 'InvalidModificationError') return false;
    }
    contadorRegistrado = true;
    raiz.classList.add('lt-contadores');
    return true;
}

/** Recorridos predefinidos (solo transform/opacity: se componen en la GPU y no recalculan el diseño) */
const RECORRIDOS = {
    adelante: [{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }],
    atras: [{ opacity: 0, transform: 'translateX(-18px)' }, { opacity: 1, transform: 'none' }],
    aparecer: [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
    destello: [{ transform: 'scale(1)' }, { transform: 'scale(1.035)', offset: 0.35 }, { transform: 'scale(1)' }],
    salir: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }]
};

/**
 * Anima un elemento con la Web Animations API. Devuelve la animación (o null si no corresponde animar).
 * Las animaciones no bloquean nada: el estado de React ya cambió; esto solo suaviza la transición visual.
 */
export function animarCambio(el, tipo, { duracion = 260, easing = 'cubic-bezier(0.22, 1, 0.36, 1)' } = {}) {
    if (!el || typeof el.animate !== 'function' || prefiereMenosMovimiento()) return null;
    const pasos = RECORRIDOS[tipo];
    if (!pasos) return null;
    try {
        return el.animate(pasos, { duration: duracion, easing, fill: tipo === 'salir' ? 'forwards' : 'none' });
    } catch {
        return null;
    }
}

/** Espera a que termine una salida (o no espera si no se anima); nunca rechaza */
export function esperarSalida(el, duracion = 200) {
    const a = animarCambio(el, 'salir', { duracion, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    if (!a) return Promise.resolve(null);
    return a.finished.then(() => a, () => a);
}

/** Solo para pruebas: olvida el observador compartido */
export function _reiniciarParaPruebas() {
    observador?.disconnect();
    observador = null;
    contadorRegistrado = false;
}
