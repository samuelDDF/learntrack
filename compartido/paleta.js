// PALETAS DE COLOR (módulo ES puro, servidor y navegador).
//  · paletaArmonica(semilla): 5 colores armónicos generados en local (respaldo cuando Colormind no responde).
//  · variablesDePaleta(colores): convierte 5 colores cualesquiera (de Colormind o locales) en las variables CSS
//    de un tema LEGIBLE: el texto siempre tiene contraste >= 7:1 con el fondo y los botones >= 4.5:1.

export const RE_HEX = /^#[0-9a-f]{6}$/i;
export const esHex = (v) => typeof v === 'string' && RE_HEX.test(v);

// ---------- conversiones ----------
export function hexARgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbAHex = (rgb) => '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');

function rgbAHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}
function hslARgb([h, s, l]) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const canal = (t) => {
        t = (t + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255];
}
const hsl = (hex) => rgbAHsl(hexARgb(hex));
const deHsl = (h, s, l) => rgbAHex(hslARgb([h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l))]));

/** Mezcla dos colores: t = 0 → a, t = 1 → b */
export const mezclar = (a, b, t) => rgbAHex(hexARgb(a).map((c, i) => c + (hexARgb(b)[i] - c) * t));

/** Luminancia relativa y contraste WCAG */
export function luminancia(hex) {
    const [r, g, b] = hexARgb(hex).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contraste(a, b) {
    const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
}

/** Oscurece (o aclara) `color` hasta alcanzar el contraste pedido contra `fondo` */
function conContraste(color, fondo, minimo) {
    let c = color;
    const haciaNegro = luminancia(fondo) > 0.4;
    for (let i = 0; i < 20 && contraste(c, fondo) < minimo; i++) c = mezclar(c, haciaNegro ? '#000000' : '#ffffff', 0.12);
    return c;
}

// ---------- paleta local ----------
/** 5 colores armónicos a partir de la semilla: semilla, análogo, complementario, tinte claro y sombra oscura */
export function paletaArmonica(semilla) {
    const [h, s, l] = hsl(semilla);
    const sat = Math.max(0.45, s);
    return [
        semilla.toLowerCase(),
        deHsl(h + 32, sat * 0.9, Math.min(0.62, Math.max(0.42, l + 0.08))),
        deHsl(h + 180, sat * 0.85, 0.5),
        deHsl(h + 10, sat * 0.35, 0.95),
        deHsl(h - 10, sat * 0.5, 0.16)
    ];
}

// ---------- de paleta a tema ----------
/**
 * Variables CSS (las mismas que define temas.css) a partir de 5 colores. La semilla (colores[0]) es el primario;
 * los demás se reparten por luminancia y saturación. Se fuerza el contraste para que el resultado sea legible.
 */
export function variablesDePaleta(colores) {
    const lista = colores.filter(esHex).map((c) => c.toLowerCase());
    if (lista.length < 3) return null;
    const porLuz = [...lista].sort((a, b) => luminancia(b) - luminancia(a));
    const claro = porLuz[0], oscuro = porLuz.at(-1);
    const fondo = mezclar(claro, '#ffffff', 0.7);
    const superficie = mezclar(fondo, '#ffffff', 0.75);
    const intermedios = lista.filter((c) => c !== claro && c !== oscuro);
    const saturacion = (c) => hsl(c)[1];
    const [semilla] = lista;
    const resto = intermedios.filter((c) => c !== semilla).sort((a, b) => saturacion(b) - saturacion(a));
    const primario = conContraste(semilla, superficie, 4.5);
    const secundario = conContraste(resto[0] ?? mezclar(semilla, oscuro, 0.4), superficie, 3);
    const acento = resto[1] ?? mezclar(semilla, '#ffffff', 0.35);
    const texto = conContraste(mezclar(oscuro, '#000000', 0.45), fondo, 7);
    const sobre = (c) => (contraste('#ffffff', c) >= 4.5 ? '#ffffff' : '#111111');
    return {
        '--color-fondo': fondo,
        '--color-primario': primario,
        '--color-secundario': secundario,
        '--color-acento': acento,
        '--color-superficie': superficie,
        '--color-texto': texto,
        '--color-texto-suave': conContraste(mezclar(texto, fondo, 0.35), superficie, 4.5),
        '--color-borde': mezclar(texto, fondo, 0.85),
        '--color-suave': mezclar(primario, fondo, 0.93),
        '--sobre-primario': sobre(primario),
        '--sobre-acento': sobre(acento),
        '--burbuja-ia': mezclar(primario, superficie, 0.86),
        '--sombra': 'rgba(0, 0, 0, .10)',
        '--cabecera-fondo': `linear-gradient(135deg, ${primario}, ${mezclar(secundario, '#000000', 0.3)})`,
        '--cabecera-texto': sobre(primario)
    };
}
