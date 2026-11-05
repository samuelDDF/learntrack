// ============================================================================================
// REPASO ESPACIADO — Algoritmo SuperMemo-2 (SM-2) puro
// ============================================================================================
// Módulo sin dependencias externas: recibe los parámetros actuales de una tarjeta y la calificación
// del usuario (0–5), y devuelve los nuevos valores calculados. Todas las fechas son cadenas
// "YYYY-MM-DD" en la zona local del usuario (igual que el resto de LearnTrack).
//
// Fórmulas (Piotr Woźniak, 1987):
//
//   Factor de Facilidad (EF):
//     EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
//     donde q = calificación (0–5). EF nunca baja de 1.3.
//
//   Intervalo (I):
//     Si q < 3 (respuesta incorrecta):
//       repeticiones = 0, intervalo = 1 día (se reinicia la tarjeta)
//     Si q ≥ 3 (respuesta correcta):
//       repetición 1 → I = 1
//       repetición 2 → I = 6
//       repetición n → I = I_anterior × EF   (redondeado al entero más cercano, mín. 1)
//
//   Repeticiones:
//     Si q < 3 → repeticiones = 0 (reinicio)
//     Si q ≥ 3 → repeticiones += 1
//
// ============================================================================================
import { sumarDias } from '../../compartido/fechas.js';

// ---- Constantes del algoritmo ----
const EF_MINIMO = 1.3;            // factor de facilidad mínimo (SM-2)
const EF_INICIAL = 2.5;           // factor de facilidad por defecto para tarjetas nuevas
const CALIFICACION_MIN = 0;
const CALIFICACION_MAX = 5;
const UMBRAL_CORRECTA = 3;        // q ≥ 3 → respuesta correcta
const INTERVALO_INICIAL = 1;      // primer intervalo (días)
const INTERVALO_SEGUNDO = 6;      // segundo intervalo (días)

/**
 * Calcula el nuevo Factor de Facilidad según SM-2.
 *
 * Fórmula:
 *   EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
 *
 * Desarrollo paso a paso (q = calificación):
 *   1. diferencia = 5 − q
 *   2. penalizacion = diferencia × (0.08 + diferencia × 0.02)
 *   3. delta = 0.1 − penalizacion
 *   4. EF' = max(EF_MINIMO, EF + delta)
 *
 * @param {number} efAnterior  Factor de facilidad actual (≥ 1.3, típicamente 2.5)
 * @param {number} calificacion  Calificación del usuario (0–5)
 * @returns {number}  Nuevo factor de facilidad (≥ 1.3), redondeado a 2 decimales
 */
export function calcularFactorFacilidad(efAnterior, calificacion) {
    const diferencia = CALIFICACION_MAX - calificacion;
    const penalizacion = diferencia * (0.08 + diferencia * 0.02);
    const delta = 0.1 - penalizacion;
    const efNuevo = efAnterior + delta;
    return Math.round(Math.max(EF_MINIMO, efNuevo) * 100) / 100;
}

/**
 * Calcula el intervalo de repaso según SM-2 (número de días hasta la próxima revisión).
 *
 * Reglas:
 *   - Si q < 3 (fallo) → se reinicia a 1 día
 *   - repetición 1  → 1 día
 *   - repetición 2  → 6 días
 *   - repetición n  → intervalo_anterior × EF  (redondeado, mínimo 1)
 *
 * @param {number} repeticionesNuevas  Número de repeticiones DESPUÉS de este repaso (ya incrementado)
 * @param {number} intervaloAnterior   Intervalo actual en días
 * @param {number} efNuevo             Factor de facilidad ya recalculado
 * @param {boolean} esCorrecta         true si la calificación ≥ 3
 * @returns {number}  Nuevo intervalo en días (entero ≥ 1)
 */
export function calcularIntervalo(repeticionesNuevas, intervaloAnterior, efNuevo, esCorrecta) {
    if (!esCorrecta) return INTERVALO_INICIAL;
    if (repeticionesNuevas === 1) return INTERVALO_INICIAL;
    if (repeticionesNuevas === 2) return INTERVALO_SEGUNDO;
    return Math.max(1, Math.round(intervaloAnterior * efNuevo));
}

/**
 * Función principal: recibe el estado actual de la tarjeta y la calificación del repaso,
 * y retorna los nuevos valores calculados + la próxima fecha de repaso.
 *
 * @param {object} parametros
 * @param {number} parametros.intervalo       Intervalo actual en días (≥ 0; 0 = tarjeta nueva)
 * @param {number} parametros.facilidad       Factor de facilidad actual (≥ 1.3; 2.5 para nuevas)
 * @param {number} parametros.repeticiones    Número de repeticiones acumuladas (≥ 0)
 * @param {number} parametros.calificacion    Calificación del usuario (0–5 entero)
 * @param {string} parametros.fechaRepaso     Fecha del repaso actual "YYYY-MM-DD" (zona local del usuario)
 * @returns {{ intervalo: number, facilidad: number, repeticiones: number, proximaFecha: string }}
 * @throws {Error} si la calificación está fuera de rango o la fecha es inválida
 */
export function calcularRepaso({ intervalo, facilidad, repeticiones, calificacion, fechaRepaso }) {
    // ---- Validaciones ----
    if (!Number.isInteger(calificacion) || calificacion < CALIFICACION_MIN || calificacion > CALIFICACION_MAX) {
        throw new Error(`La calificación debe ser un entero entre ${CALIFICACION_MIN} y ${CALIFICACION_MAX}.`);
    }
    if (typeof fechaRepaso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaRepaso)) {
        throw new Error('La fecha de repaso debe tener formato YYYY-MM-DD.');
    }

    // Valores por defecto para tarjetas nuevas
    const efAnterior = (typeof facilidad === 'number' && facilidad >= EF_MINIMO) ? facilidad : EF_INICIAL;
    const repsAnteriores = (typeof repeticiones === 'number' && repeticiones >= 0) ? repeticiones : 0;
    const intAnterior = (typeof intervalo === 'number' && intervalo >= 0) ? intervalo : 0;

    // ---- Paso 1: ¿Respuesta correcta? ----
    const esCorrecta = calificacion >= UMBRAL_CORRECTA;

    // ---- Paso 2: Nuevo factor de facilidad ----
    const efNuevo = calcularFactorFacilidad(efAnterior, calificacion);

    // ---- Paso 3: Nuevas repeticiones ----
    const repsNuevas = esCorrecta ? repsAnteriores + 1 : 0;

    // ---- Paso 4: Nuevo intervalo ----
    const intNuevo = calcularIntervalo(repsNuevas, intAnterior, efNuevo, esCorrecta);

    // ---- Paso 5: Próxima fecha de repaso ----
    const proximaFecha = sumarDias(fechaRepaso, intNuevo);

    return {
        intervalo: intNuevo,
        facilidad: efNuevo,
        repeticiones: repsNuevas,
        proximaFecha
    };
}

// ---- Exportaciones de constantes (para las pruebas y la documentación) ----
export { EF_MINIMO, EF_INICIAL, CALIFICACION_MIN, CALIFICACION_MAX, UMBRAL_CORRECTA };

