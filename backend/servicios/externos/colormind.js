// Paleta de colores con la API de Colormind (http://colormind.io/api/), llamada DESDE EL SERVIDOR:
//  · su API solo funciona por HTTP: desde una página HTTPS el navegador la bloquearía (contenido mixto);
//  · la CSP de LearnTrack (connect-src 'self') no deja al navegador hablar con dominios externos.
// Petición: POST { model: "default", input: [[r, g, b], "N", "N", "N", "N"] }  → la semilla queda fija en la
// posición 0 y Colormind completa las otras 4 ("N"). Respuesta: { result: [[r, g, b] × 5] }.
// Si Colormind no responde se usa una paleta armónica local (compartido/paleta.js) y se avisa.
import { pedirJSON, ErrorServicioExterno } from './http-externo.js';
import { hexARgb, rgbAHex, paletaArmonica, variablesDePaleta } from '../../../compartido/paleta.js';

const url = () => process.env.COLORMIND_API_URL || 'http://colormind.io/api/';

const esRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

/** Devuelve { colores: [5 hex], variables, fuente: 'colormind' | 'local' } */
export async function generarPaleta(semilla) {
    let colores = null;
    let fuente = 'colormind';
    try {
        const r = await pedirJSON('Colormind', url(), {
            method: 'POST', ms: 6000,
            body: { model: 'default', input: [hexARgb(semilla), 'N', 'N', 'N', 'N'] }
        });
        if (r && Array.isArray(r.result) && r.result.length === 5 && r.result.every(esRgb)) {
            colores = r.result.map(rgbAHex);
            colores[0] = semilla.toLowerCase();      // la semilla elegida manda (Colormind la devuelve aproximada)
        }
    } catch (e) {
        if (!(e instanceof ErrorServicioExterno)) throw e;
    }
    if (!colores) { colores = paletaArmonica(semilla); fuente = 'local'; }
    return { colores, variables: variablesDePaleta(colores), fuente };
}
