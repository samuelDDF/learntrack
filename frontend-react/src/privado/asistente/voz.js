// Voz del asistente (Text-to-Speech con speechSynthesis). La comparten el chat y Configuración › Voz de la IA.
// La voz elegida se guarda en la cuenta (vozAsistente) y llega por /api/auth/me.
import { obtenerUsuario } from '../../comun/sesion.js';

const sintesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
export const sintesisDisponible = () => Boolean(sintesis && window.SpeechSynthesisUtterance);

let preferida = null;            // nombre de la voz guardada en la cuenta ('' = la del navegador)
let cargaPreferencia = null;

/** Lee una vez la voz guardada en la cuenta */
export function cargarVozPreferida() {
    cargaPreferencia ??= obtenerUsuario()
        .then((u) => { preferida = u?.vozAsistente ?? ''; return preferida; })
        .catch(() => { preferida = ''; return preferida; });
    return cargaPreferencia;
}
/** Configuración la cambia al guardar, sin recargar la página */
export const fijarVozPreferida = (nombre) => { preferida = nombre ?? ''; cargaPreferencia = Promise.resolve(preferida); };

/** Voces del sistema (las de español primero). Algunos navegadores las cargan tarde: se espera a `voiceschanged`. */
export function vocesDisponibles() {
    if (!sintesisDisponible()) return Promise.resolve([]);
    const ordenar = (lista) => [...lista].sort((a, b) =>
        Number(b.lang.startsWith('es')) - Number(a.lang.startsWith('es')) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    const ya = sintesis.getVoices();
    if (ya.length) return Promise.resolve(ordenar(ya));
    return new Promise((ok) => {
        const listo = () => { sintesis.removeEventListener('voiceschanged', listo); ok(ordenar(sintesis.getVoices())); };
        sintesis.addEventListener('voiceschanged', listo);
        setTimeout(listo, 1500);           // sin voces (p. ej. navegador sin motor de voz): lista vacía
    });
}

/** Quita emojis y símbolos que el motor de voz leería en voz alta («marca de verificación…») */
export function textoParaVoz(texto) {
    return String(texto ?? '')
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
        .replace(/[«»"“”*_#>]/g, '')
        .replace(/\s*[·•→]\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Frases de hasta ~180 caracteres: Chrome corta las locuciones largas */
function frases(texto) {
    const partes = texto.match(/[^.!?¿¡;:]+[.!?;:]*/g) ?? [texto];
    const salida = [];
    for (const p of partes) {
        const t = p.trim();
        if (!t) continue;
        if (salida.length && (salida.at(-1) + ' ' + t).length <= 180) salida[salida.length - 1] += ` ${t}`;
        else salida.push(t.slice(0, 400));
    }
    return salida;
}

let turno = 0;
/**
 * Habla el texto con la voz preferida (o con `voz`, para «Probar voz» en Configuración). Devuelve una promesa que
 * se resuelve al terminar (o al interrumpirse).
 */
export async function hablar(texto, { voz: vozPedida } = {}) {
    if (!sintesisDisponible()) return;
    const limpio = textoParaVoz(texto);
    if (!limpio) return;
    const miTurno = ++turno;
    sintesis.cancel();                                   // una respuesta nueva corta la anterior
    const [voces, nombre] = await Promise.all([vocesDisponibles(), cargarVozPreferida()]);
    const buscada = vozPedida ?? nombre;
    const voz = voces.find((v) => v.name === buscada) ?? voces.find((v) => v.lang.startsWith('es')) ?? null;
    for (const frase of frases(limpio)) {
        if (miTurno !== turno) return;                   // alguien llamó a callar() o a hablar() de nuevo
        await new Promise((ok) => {
            const u = new SpeechSynthesisUtterance(frase);
            if (voz) { u.voice = voz; u.lang = voz.lang; } else u.lang = 'es-ES';
            u.onend = ok; u.onerror = ok;
            sintesis.speak(u);
        });
    }
}

export function callar() { turno++; if (sintesisDisponible()) sintesis.cancel(); }
export const hablando = () => Boolean(sintesis?.speaking);
