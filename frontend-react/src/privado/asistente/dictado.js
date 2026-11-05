// Dictado por voz (Speech-to-Text, Web Speech API). Lógica pura separada del componente para poder probarla.
//
// CORRECCIÓN v3.6: en la 3.4.2, reconocedor.onresult usaba variables que no existían (btnMicrofono, divRespuesta),
// escribía con innerHTML (riesgo de XSS: el texto dictado se interpretaba como HTML) y no ponía nada en el cuadro
// de texto. Aquí el resultado (incluidos los parciales) se escribe en el VALOR del cuadro de texto, nunca como HTML.

/**
 * «mañana estudio y luego entreno» → «mañana estudio, luego entreno». Separa las actividades que la persona encadena
 * con «y luego», «luego», «también» o «y» + fecha/hora, para que el asistente las distinga (idea de la 3.4.2).
 */
export function separarConectores(texto) {
    return String(texto ?? '')
        .replace(/\s+y luego\s+/gi, ', luego ')
        .replace(/(^|[^,])\s+luego\s+/gi, '$1, luego ')
        .replace(/\s+tambi[eé]n\s+/gi, ', también ')
        .replace(/\s+y\s+(?=(mañana|hoy|el|la|las|los|a las|de \d|despu[eé]s)\b)/gi, ', ');
}

/** Texto completo a partir de event.results (resultados finales y parciales) */
export const textoDeResultados = (results) => Array.from(results ?? []).map((r) => r?.[0]?.transcript ?? '').join('');

/** Lo que queda en el cuadro: lo que ya había escrito (base) + lo dictado, con el máximo de 500 caracteres */
export const componerEntrada = (base, results, max = 500) => (base + separarConectores(textoDeResultados(results))).slice(0, max);

export const ERRORES_VOZ = {
    'not-allowed': 'Sin permiso para usar el micrófono. Actívalo en la configuración del sitio (icono del candado).',
    'service-not-allowed': 'El navegador no permite el dictado en esta página.',
    'no-speech': 'No te escuché. Pulsa 🎤 e inténtalo de nuevo.',
    'audio-capture': 'No encontré ningún micrófono.',
    network: 'El servicio de dictado del navegador no respondió (error de red).'
};

/** Constructor del reconocedor del navegador, o null si no hay (Firefox, por ejemplo) */
export const reconocedorDisponible = () => (typeof window === 'undefined' ? null : (window.SpeechRecognition || window.webkitSpeechRecognition || null));
