// Planificador DETERMINISTA de sesiones de estudio (v3.12). El LLM nunca decide fechas ni horas: lo hace este código
// con las mismas reglas que el resto de LearnTrack (carga ≤ 85 %, sin solapamientos de hora, nada en el pasado).
// Funciones puras: reciben actividades, objetivos y capacidades y devuelven sesiones PROPUESTAS (no guardan nada).
import { cargaDelDia, puntosActividad, normalizarActividad, capacidadDe, UMBRAL_ROJO, CAPACIDAD_POR_DEFECTO } from '../../../compartido/carga.js';
import { sumarDias, diasEntre, rangoFechas, fechaLarga, aMinutos, deMinutos } from '../../../compartido/fechas.js';
import { resumenObjetivo, porUrgenciaDeEstudio, ESTADOS_ACTIVOS } from '../../../compartido/estudio.js';
import { seSolapa, horariosLibres } from '../asistente/planificador.js';

export const DIAS_SIN_FECHA = 14;     // ventana cuando el objetivo no tiene fecha límite
export const EXIGENCIA_ESTUDIO = 2;   // «media»: igual que una sesión de estudio creada a mano
const MAX_SESIONES_PLAN = 30;         // lo mismo que admite aplicarCambiosBD en un lote

const leerCapacidad = (capacidades) => (iso) => {
    const c = capacidades instanceof Map ? capacidades.get(iso) : capacidades?.[iso];
    return typeof c === 'number' ? c : c ? capacidadDe(c) : CAPACIDAD_POR_DEFECTO;
};

/** Datos de la actividad que representa una sesión de estudio en el calendario */
export function datosSesion(objetivo, { fecha, hora_inicio, horas }, hoy) {
    return {
        titulo: `Estudio: ${objetivo.tema}`.slice(0, 100), tipo: 'estudio', exigencia: EXIGENCIA_ESTUDIO, horas,
        fecha, fecha_inicio: fecha, fecha_fin: fecha, hora_inicio, hora_fin: deMinutos(aMinutos(hora_inicio) + horas * 60),
        estado: 'pendiente', proyecto: objetivo.proyecto || '', fija: false, fecha_vencimiento: null, fecha_asignacion: hoy,
        objetivoId: objetivo.id
    };
}

/** Ventana en la que se puede estudiar un objetivo: de hoy al día ANTES de su fecha límite (o 14 días si no tiene) */
export function ventanaObjetivo(objetivo, hoy) {
    if (!objetivo.fechaLimite) return { desde: hoy, hasta: sumarDias(hoy, DIAS_SIN_FECHA - 1), aviso: null };
    if (objetivo.fechaLimite < hoy) {
        return { desde: hoy, hasta: sumarDias(hoy, 6), aviso: `La fecha límite de «${objetivo.tema}» (${fechaLarga(objetivo.fechaLimite)}) ya pasó: propongo sesiones para esta semana. Puedes cambiar la fecha en Estudio.` };
    }
    if (objetivo.fechaLimite === hoy) return { desde: hoy, hasta: hoy, aviso: `«${objetivo.tema}» vence hoy: solo queda tiempo para hoy.` };
    return { desde: hoy, hasta: sumarDias(objetivo.fechaLimite, -1), aviso: null };
}

/** Días de la ventana ordenados desde el «ideal» de la pieza k hacia afuera (reparte en vez de amontonar al principio) */
function diasEnOrden(dias, k, n) {
    const paso = dias.length / n;
    const ideal = Math.min(dias.length - 1, Math.floor(k * paso + paso / 2));
    const orden = [];
    for (let delta = 0; orden.length < dias.length; delta++) {
        if (ideal + delta < dias.length) orden.push(dias[ideal + delta]);
        if (delta > 0 && ideal - delta >= 0) orden.push(dias[ideal - delta]);
    }
    return orden;
}

/** Prefiere la misma hora que la sesión anterior del tema; si no, la tarde (14:00–19:00) y luego cualquier hueco */
function elegirHora(libres, preferida) {
    if (preferida && libres.includes(preferida)) return preferida;
    return libres.find((h) => h >= '14:00' && h <= '19:00') ?? libres[0] ?? null;
}

/**
 * Propone sesiones para los objetivos elegidos.
 *  · Orden: lo que vence antes y, a igualdad, mayor prioridad (porUrgenciaDeEstudio).
 *  · Horas a programar = estimadas − completadas − ya programadas (no duplica lo que ya está en el calendario).
 *  · Cada sesión: un hueco libre del día (sin cruzarse con nada), como máximo una por tema y `maxPorDia` de estudio
 *    por día, sin pasar del 85 % de carga, y repartidas a lo largo de la ventana.
 * Devuelve { sesiones: [{ objetivoId, tema, fecha, hora_inicio, hora_fin, horas, carga, motivo }], avisos, explicaciones }.
 */
export function planificarEstudio({ actividades, objetivos, hoy, horaActual = null, capacidades = {}, horasPorSesion = 1, maxPorDia = 2 }) {
    const lista = actividades.filter((a) => !a.eliminadaEn).map((a) => normalizarActividad(a));
    const cap = leerCapacidad(capacidades);
    const sesiones = [], avisos = [], explicaciones = [];
    const ordenados = objetivos.filter((o) => ESTADOS_ACTIVOS.includes(o.estado) || o.estado === 'sugerido').sort(porUrgenciaDeEstudio);
    for (const o of objetivos) if (!ordenados.includes(o)) avisos.push(`«${o.tema}» está ${o.estado === 'completado' ? 'completado' : 'descartado'}: no lo planifiqué.`);

    for (const objetivo of ordenados) {
        const r = resumenObjetivo(objetivo, lista, hoy);
        if (r.horasPendientes <= 0) {
            avisos.push(`«${objetivo.tema}» ya tiene en el calendario todas sus horas estimadas (${r.horasEstimadas} h). Si necesitas más, sube las horas estimadas.`);
            continue;
        }
        const { desde, hasta, aviso } = ventanaObjetivo(objetivo, hoy);
        if (aviso) avisos.push(aviso);
        const dias = rangoFechas(desde, hasta);
        const piezas = [];
        for (let resto = r.horasPendientes; resto > 0; resto -= horasPorSesion) piezas.push(Math.max(0.5, Math.min(horasPorSesion, resto)));
        let horaPreferida = null, colocadas = 0, horasColocadas = 0;

        piezas.forEach((horas, k) => {
            if (sesiones.length >= MAX_SESIONES_PLAN) return;
            for (const d of diasEnOrden(dias, k, piezas.length)) {
                const delDia = lista.filter((a) => a.fecha_inicio <= d && d <= a.fecha_fin);
                if (delDia.some((a) => a.objetivoId === objetivo.id)) continue;                 // 1 sesión por tema y día
                if (delDia.filter((a) => a.objetivoId).length >= maxPorDia) continue;           // sin atracones
                const prueba = { exigencia: EXIGENCIA_ESTUDIO, horas };
                const carga = Math.round(((cargaDelDia(lista, d, cap(d)).puntos + puntosActividad(prueba)) / cap(d)) * 100);
                if (carga > UMBRAL_ROJO) continue;                                              // no sobrecargar el día
                const hora = elegirHora(horariosLibres({ actividades: lista, fecha: d, horas, hoy, horaActual, cuantos: 6 }), horaPreferida);
                if (!hora || aMinutos(hora) + horas * 60 > 23 * 60) continue;
                const s = datosSesion(objetivo, { fecha: d, hora_inicio: hora, horas }, hoy);
                if (seSolapa(lista, { ...s, id: '__nueva__' }, d)) continue;                    // doble comprobación
                lista.push(normalizarActividad({ ...s, id: `plan-${sesiones.length}` }));
                horaPreferida = hora;
                colocadas++; horasColocadas += horas;
                sesiones.push({
                    objetivoId: objetivo.id, tema: objetivo.tema, fecha: d, hora_inicio: hora, hora_fin: s.hora_fin, horas, carga,
                    motivo: `${fechaLarga(d)} a las ${hora}: hueco libre y el día queda en ${carga} % de carga.`
                });
                return;
            }
        });
        const faltan = Math.round((r.horasPendientes - horasColocadas) * 2) / 2;
        const plazo = objetivo.fechaLimite && objetivo.fechaLimite > hoy ? `antes del ${fechaLarga(objetivo.fechaLimite)}` : `en los próximos ${dias.length} días`;
        if (colocadas) explicaciones.push(`«${objetivo.tema}»: ${colocadas} ${colocadas === 1 ? 'sesión' : 'sesiones'} (${horasColocadas} h) ${plazo}${r.horasProgramadas ? `, además de las ${r.horasProgramadas} h que ya tenías programadas` : ''}.`);
        if (faltan > 0) {
            avisos.push(`No encontré hueco para ${faltan} h de «${objetivo.tema}» ${plazo} sin pasar del 85 % de carga ni cruzarme con tus actividades. Puedes alargar la fecha límite, sesiones más largas o liberar algún día.`);
        }
    }
    if (sesiones.length >= MAX_SESIONES_PLAN) avisos.push(`El plan se limita a ${MAX_SESIONES_PLAN} sesiones; cuando avances, vuelve a planificar el resto.`);
    if (sesiones.length) explicaciones.unshift('Primero va lo que vence antes y, a igualdad, lo de mayor prioridad. Nada se guarda hasta que lo confirmes.');
    sesiones.sort((a, b) => `${a.fecha}${a.hora_inicio}`.localeCompare(`${b.fecha}${b.hora_inicio}`));
    return { sesiones, avisos, explicaciones };
}

/**
 * Comprueba las sesiones que la persona CONFIRMA (puede haber cambiado días, horas o duraciones) contra el calendario
 * ACTUAL. Devuelve { conflictos: [{ indice, motivo }], avisos, datos } — si hay conflictos no se guarda nada.
 */
export function revisarSesionesConfirmadas({ actividades, objetivosPorId, sesiones, hoy, horaActual = null, capacidades = {} }) {
    const lista = actividades.filter((a) => !a.eliminadaEn).map((a) => normalizarActividad(a));
    const cap = leerCapacidad(capacidades);
    const conflictos = [], avisos = [], datos = [];
    sesiones.forEach((s, indice) => {
        const objetivo = objetivosPorId.get(s.objetivoId);
        const n = `Sesión ${indice + 1}`;
        if (!objetivo) return conflictos.push({ indice, motivo: `${n}: el tema ya no existe.` });
        if (!ESTADOS_ACTIVOS.includes(objetivo.estado)) return conflictos.push({ indice, motivo: `${n}: «${objetivo.tema}» no está activo (acéptalo o reactívalo primero).` });
        if (s.fecha < hoy || (s.fecha === hoy && horaActual && s.hora_inicio <= horaActual)) return conflictos.push({ indice, motivo: `${n}: ${fechaLarga(s.fecha)} a las ${s.hora_inicio} ya pasó.` });
        if (diasEntre(hoy, s.fecha) > 366) return conflictos.push({ indice, motivo: `${n}: la fecha está demasiado lejos.` });
        if (aMinutos(s.hora_inicio) + s.horas * 60 > 24 * 60) return conflictos.push({ indice, motivo: `${n}: termina después de medianoche.` });
        const d = datosSesion(objetivo, s, hoy);
        if (lista.some((a) => a.objetivoId === objetivo.id && a.fecha_inicio <= s.fecha && s.fecha <= a.fecha_fin && a.estado !== 'completado')) {
            return conflictos.push({ indice, motivo: `${n}: ya hay una sesión de «${objetivo.tema}» el ${fechaLarga(s.fecha)}.` });
        }
        if (seSolapa(lista, { ...d, id: '__nueva__' }, s.fecha)) {
            const choca = lista.find((a) => a.hora_inicio && a.fecha_inicio <= s.fecha && s.fecha <= a.fecha_fin && seSolapa([a], { ...d, id: '__nueva__' }, s.fecha));
            return conflictos.push({ indice, motivo: `${n}: a las ${s.hora_inicio} del ${fechaLarga(s.fecha)} se cruza con «${choca?.titulo ?? 'otra actividad'}».` });
        }
        lista.push(normalizarActividad({ ...d, id: `confirmada-${indice}` }));
        const carga = cargaDelDia(lista, s.fecha, cap(s.fecha)).porcentaje;
        if (carga > UMBRAL_ROJO) avisos.push(`Ojo: el ${fechaLarga(s.fecha)} queda en ${carga} % de carga.`);
        datos.push(d);
    });
    return { conflictos, avisos: [...new Set(avisos)], datos };
}
