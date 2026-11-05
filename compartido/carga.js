// REGLA ÚNICA DE CARGA MENTAL. Módulo ES puro compartido por el servidor (planificador, historial, chat)
// y el navegador (medidor del panel, indicador por día de la agenda). Cambiar la regla aquí la cambia en todas partes.
//
//  · Una actividad aporta `horas` a CADA día de su rango fecha_inicio..fecha_fin: `horas` son horas por día
//    (coherente con hora_inicio–hora_fin repetida cada día).
//  · Puntos = exigencia × horas × 10 (ocio/deporte de recarga, exigencia -2, restan).
//  · Las actividades completadas siguen contando: la energía ya se gastó.
//  · % = puntos / capacidad × 100 (mínimo 0). Capacidad por check-in: alto 120, medio 100, bajo 70; sin check-in, 100.
//  · Semáforo: < 50 verde, 50–85 amarillo, > 85 rojo. El planificador no supera el 85 %.

import { ESTADOS } from './catalogos.js';
import { rangoFechas } from './fechas.js';

const CAPACIDADES = Object.freeze({ alto: 120, medio: 100, bajo: 70 });
export const CAPACIDAD_POR_DEFECTO = 100;
const UMBRAL_AMARILLO = 50;
export const UMBRAL_ROJO = 85;

// Misma regla que la vista "Eventos": exigencia alta o títulos de evaluación/entrega
const RE_HITO = /parcial|examen|exámen|entrega|exposici|sustentaci|quiz|prueba|final|defensa|evaluaci/i;

/** Rango normalizado de una actividad (las antiguas solo tienen `fecha`) */
export function rangoActividad(a) {
    const inicio = a?.fecha_inicio || a?.fecha || null;
    const fin = a?.fecha_fin && inicio && a.fecha_fin >= inicio ? a.fecha_fin : inicio;
    return { inicio, fin };
}

/** Normaliza una actividad (datos antiguos o incompletos) sin inventar contenido */
export function normalizarActividad(a) {
    const { inicio, fin } = rangoActividad(a);
    return {
        ...a,
        fecha: inicio,
        fecha_inicio: inicio,
        fecha_fin: fin,
        hora_inicio: a?.hora_inicio || null,
        hora_fin: a?.hora_fin || null,
        estado: ESTADOS.includes(a?.estado) ? a.estado : 'pendiente',
        proyecto: a?.proyecto || '',
        fija: a?.fija === true,
        exigencia: Number(a?.exigencia),
        horas: Number(a?.horas)
    };
}

const activa = (a) => a && (a.eliminadaEn === null || a.eliminadaEn === undefined);

function cubreDia(a, iso) {
    const { inicio, fin } = rangoActividad(a);
    return Boolean(inicio) && inicio <= iso && iso <= fin;
}

/** Actividades (no eliminadas) que ocupan el día `iso`, incluidas las de rango */
export function actividadesDelDia(lista, iso) {
    return (Array.isArray(lista) ? lista : []).filter((a) => activa(a) && cubreDia(a, iso));
}

export function puntosActividad(a) {
    const p = Number(a?.exigencia) * Number(a?.horas) * 10;
    return Number.isFinite(p) ? p : 0;
}

/** Capacidad a partir de un check-in ({ animo }) o directamente del ánimo ('alto' | 'medio' | 'bajo') */
export function capacidadDe(checkinOAnimo) {
    const animo = typeof checkinOAnimo === 'string' ? checkinOAnimo : checkinOAnimo?.animo;
    return CAPACIDADES[animo] ?? CAPACIDAD_POR_DEFECTO;
}

export function porcentajeCarga(puntos, capacidad = CAPACIDAD_POR_DEFECTO) {
    const cap = Number(capacidad) > 0 ? Number(capacidad) : CAPACIDAD_POR_DEFECTO;
    return Math.max(0, Math.round((puntos / cap) * 100));
}

export function nivelCarga(porcentaje) {
    if (porcentaje < UMBRAL_AMARILLO) return 'verde';
    if (porcentaje <= UMBRAL_ROJO) return 'amarillo';
    return 'rojo';
}

/** Carga de un día: { fecha, puntos, capacidad, porcentaje, nivel, cantidad } */
export function cargaDelDia(lista, iso, capacidad = CAPACIDAD_POR_DEFECTO) {
    const delDia = actividadesDelDia(lista, iso);
    const puntos = delDia.reduce((s, a) => s + puntosActividad(a), 0);
    const porcentaje = porcentajeCarga(puntos, capacidad);
    return { fecha: iso, puntos, capacidad, porcentaje, nivel: nivelCarga(porcentaje), cantidad: delDia.length };
}

/**
 * Cargas de varios días. `capacidades` puede ser un objeto { 'YYYY-MM-DD': capacidad | { animo } },
 * un Map o una función (iso) => capacidad.
 */
export function cargasPorDia(lista, fechas, capacidades = {}) {
    const leer = typeof capacidades === 'function' ? capacidades
        : capacidades instanceof Map ? (iso) => capacidades.get(iso)
        : (iso) => capacidades?.[iso];
    return fechas.map((iso) => {
        const c = leer(iso);
        const cap = typeof c === 'number' ? c : capacidadDe(c);
        return cargaDelDia(lista, iso, cap);
    });
}

/** Actividad que no se debe mover al reorganizar (misma regla que la vista Eventos + campo opcional `fija`) */
export function esHito(a) {
    return a?.fija === true || Number(a?.exigencia) === 3 || RE_HITO.test(a?.titulo ?? '');
}

/**
 * Días del rango de `actividad` que quedarían por encima del 85 % con la lista `lista` (que ya debe incluirla).
 * Lo usan el chat y la papelera para avisar «ojo: el jueves queda en 110 %».
 */
export function diasSaturados(lista, actividad, capacidades = {}) {
    const { inicio, fin } = rangoActividad(actividad);
    if (!inicio) return [];
    return cargasPorDia(lista, rangoFechas(inicio, fin, 62), capacidades).filter((c) => c.porcentaje > UMBRAL_ROJO);
}
