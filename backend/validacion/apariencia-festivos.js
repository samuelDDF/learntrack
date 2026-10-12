// Generación de paletas (Colormind) e importación de días festivos (Nager.Date).
import { esHex } from '../../compartido/paleta.js';
import { esObjeto } from './texto.js';

const RE_PAIS = /^[A-Z]{2}$/;
const RE_REGION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

/** POST /api/perfil/paleta: { color: "#rrggbb" } */
export function validarColorSemilla(body) {
    return esHex(body?.color) ? { valor: body.color.toLowerCase() } : { error: 'Elige un color base válido (#rrggbb).' };
}

/** Año aceptado para festivos: del año pasado al de dentro de dos años */
export function validarAnio(valor, hoy = new Date()) {
    const anio = Number(valor);
    const actual = hoy.getFullYear();
    return Number.isInteger(anio) && anio >= actual - 1 && anio <= actual + 2 ? anio : null;
}

/** POST /api/festivos/importar: { pais: "CO", region?: "ES-MD", anio } */
export function validarImportarFestivos(body) {
    if (!esObjeto(body)) return { error: 'Datos no válidos.' };
    const pais = typeof body.pais === 'string' ? body.pais.toUpperCase() : '';
    if (!RE_PAIS.test(pais)) return { error: 'Elige un país.' };
    let region = null;
    if (body.region !== undefined && body.region !== null && body.region !== '') {
        region = typeof body.region === 'string' ? body.region.toUpperCase() : '';
        if (!RE_REGION.test(region) || !region.startsWith(`${pais}-`)) return { error: 'La región no pertenece a ese país.' };
    }
    const anio = validarAnio(body.anio);
    if (!anio) return { error: 'Elige un año entre el pasado y dentro de dos años.' };
    return { valor: { pais, region, anio } };
}
