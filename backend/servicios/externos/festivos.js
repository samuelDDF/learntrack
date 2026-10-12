// Días festivos con la API pública Nager.Date (https://date.nager.at), llamada desde el servidor.
//  · GET /api/v3/AvailableCountries          → [{ countryCode, name }]
//  · GET /api/v3/PublicHolidays/{año}/{país} → [{ date, localName, name, countryCode, global, counties, types }]
// Nager.Date no trabaja por CIUDAD sino por REGIÓN (código ISO 3166-2, p. ej. "ES-MD" = Madrid): un festivo es
// nacional (global = true) o aplica a ciertas regiones (counties). Por eso el selector se llama «Región».
import { pedirJSON } from './http-externo.js';
import { limpiarTextoVisible, esFechaValida } from '../../validacion/index.js';

const base = () => (process.env.NAGER_API_URL || 'https://date.nager.at').replace(/\/$/, '');
const RE_PAIS = /^[A-Z]{2}$/;
const RE_REGION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
export const esCodigoPais = (v) => typeof v === 'string' && RE_PAIS.test(v);
export const esCodigoRegion = (v) => typeof v === 'string' && RE_REGION.test(v);

// La lista de países cambia muy poco: se guarda 24 h en memoria
let cachePaises = null;
export async function listarPaises() {
    if (cachePaises && cachePaises.hasta > Date.now()) return cachePaises.lista;
    const datos = await pedirJSON('El servicio de festivos', `${base()}/api/v3/AvailableCountries`);
    const lista = (Array.isArray(datos) ? datos : [])
        .filter((p) => esCodigoPais(p?.countryCode))
        .map((p) => ({ codigo: p.countryCode, nombre: limpiarTextoVisible(String(p.name ?? p.countryCode), 60) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (lista.length) cachePaises = { lista, hasta: Date.now() + 24 * 3600 * 1000 };
    return lista;
}

/** Quita etiquetas HTML completas (con su contenido si son <script>/<style>): el texto llega limpio, no solo sin < > */
const sinEtiquetas = (v) => String(v ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '');

/** Festivos de un país y año, normalizados (datos externos = no confiables) */
export async function festivosDe(pais, anio) {
    const datos = await pedirJSON('El servicio de festivos', `${base()}/api/v3/PublicHolidays/${anio}/${pais}`);
    return (Array.isArray(datos) ? datos : []).slice(0, 200).flatMap((f) => {
        if (!esFechaValida(f?.date) || !f.date.startsWith(String(anio))) return [];
        const nombre = limpiarTextoVisible(sinEtiquetas(f.localName || f.name), 100);
        if (!nombre) return [];
        const regiones = Array.isArray(f.counties) ? f.counties.filter(esCodigoRegion) : [];
        return [{ fecha: f.date, nombre, nombreIngles: limpiarTextoVisible(sinEtiquetas(f.name), 100), nacional: f.global !== false || regiones.length === 0, regiones }];
    });
}

/** Regiones que tienen festivos propios ese año (para el segundo selector) */
export async function regionesDe(pais, anio) {
    const lista = await festivosDe(pais, anio);
    return [...new Set(lista.flatMap((f) => f.regiones))].sort();
}

/** Festivos que aplican a la región elegida (o solo los nacionales si no se elige región) */
export async function festivosParaImportar(pais, anio, region = null) {
    const lista = await festivosDe(pais, anio);
    return lista.filter((f) => f.nacional || (region && f.regiones.includes(region)));
}
