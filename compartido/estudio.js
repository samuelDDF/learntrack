// MÓDULO ESTUDIO (v3.12): catálogos y reglas PURAS compartidas por el servidor y el navegador (como carga.js).
// Un «objetivo de aprendizaje» es un tema, habilidad o competencia que la persona quiere dominar, con fecha límite,
// prioridad y horas estimadas. Sus sesiones de estudio son actividades normales del calendario con `objetivoId`:
// así el calendario, la carga mental, la papelera y «Deshacer» funcionan igual que con cualquier otra actividad.
import { diasEntre } from './fechas.js';

export const CATEGORIAS_OBJETIVO = ['tema', 'habilidad', 'competencia'];
export const NOMBRE_CATEGORIA = { tema: 'Tema', habilidad: 'Habilidad', competencia: 'Competencia' };

/** Nivel de conocimiento ('' = sin indicar) */
export const NIVELES = ['', 'basico', 'intermedio', 'avanzado'];
export const NOMBRE_NIVEL = { '': 'Sin indicar', basico: 'Básico', intermedio: 'Intermedio', avanzado: 'Avanzado' };

export const PRIORIDADES_OBJETIVO = [1, 2, 3];
export const NOMBRE_PRIORIDAD_OBJETIVO = { 1: 'Baja', 2: 'Media', 3: 'Alta' };

/**
 * Estados de un objetivo:
 *  · sugerido   → propuesto por la IA; espera que la persona lo acepte, lo posponga o lo descarte
 *  · pendiente  → aceptado, todavía sin estudiar · en_curso → ya tiene horas estudiadas · completado
 *  · descartado → la persona no lo quiere (se conserva para no volver a sugerirlo por contexto)
 */
export const ESTADOS_OBJETIVO = ['sugerido', 'pendiente', 'en_curso', 'completado', 'descartado'];
export const ESTADOS_ACTIVOS = ['pendiente', 'en_curso'];
/** De dónde salió: la persona, el chat, el contexto de un proyecto o el análisis de un documento */
export const ORIGENES_OBJETIVO = ['manual', 'chat', 'proyecto', 'documento'];

/** Días antes de la fecha límite a partir de los cuales un objetivo se considera «próximo a vencer» */
export const DIAS_PROXIMO = 7;
export const HORAS_SESION_POR_DEFECTO = 1;
export const HORAS_ESTIMADAS_POR_DEFECTO = 4;

/** Clave para detectar el mismo tema escrito de otra forma («API REST» = «api rest» = «APIs REST») */
export function claveTema(tema) {
    return String(tema ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9+#.]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
        .join(' ')
        .trim()
        .slice(0, 100);
}

/**
 * Resumen calculado de un objetivo a partir de sus sesiones (actividades con su objetivoId):
 *  progreso  → 100 si está completado; si no, el progreso indicado a mano o el de las horas completadas
 *  situacion → 'completado' | 'atrasado' (pasó la fecha límite) | 'proximo' (vence en ≤ 7 días) | 'en_plazo' | 'sin_fecha'
 */
export function resumenObjetivo(objetivo, sesiones = [], hoy) {
    const propias = sesiones.filter((s) => s.objetivoId === objetivo.id && !s.eliminadaEn);
    const horasCompletadas = propias.filter((s) => s.estado === 'completado').reduce((t, s) => t + Number(s.horas || 0), 0);
    const futuras = propias.filter((s) => s.estado !== 'completado' && (s.fecha_inicio ?? s.fecha) >= hoy)
        .sort((x, y) => `${x.fecha_inicio}${x.hora_inicio ?? ''}`.localeCompare(`${y.fecha_inicio}${y.hora_inicio ?? ''}`));
    const horasProgramadas = futuras.reduce((t, s) => t + Number(s.horas || 0), 0);
    const estimadas = Number(objetivo.horasEstimadas) || HORAS_ESTIMADAS_POR_DEFECTO;
    const calculado = Math.min(100, Math.round((horasCompletadas / estimadas) * 100));
    const progreso = objetivo.estado === 'completado' ? 100
        : Number.isFinite(objetivo.progresoManual) && objetivo.progresoManual !== null ? objetivo.progresoManual : calculado;
    let situacion = 'sin_fecha';
    let diasRestantes = null;
    if (objetivo.estado === 'completado') situacion = 'completado';
    else if (objetivo.fechaLimite) {
        diasRestantes = diasEntre(hoy, objetivo.fechaLimite);
        situacion = diasRestantes < 0 ? 'atrasado' : diasRestantes <= DIAS_PROXIMO ? 'proximo' : 'en_plazo';
    }
    return {
        progreso, horasCompletadas, horasProgramadas, horasEstimadas: estimadas,
        horasPendientes: Math.max(0, Math.round((estimadas - horasCompletadas - horasProgramadas) * 2) / 2),
        sesionesTotales: propias.length, sesionesCompletadas: propias.filter((s) => s.estado === 'completado').length,
        proximaSesion: futuras[0] ?? null, situacion, diasRestantes
    };
}

/** Orden para estudiar: primero lo atrasado y lo que vence antes; a igualdad, mayor prioridad */
export function porUrgenciaDeEstudio(a, b) {
    const fa = a.fechaLimite ?? '9999-12-31', fb = b.fechaLimite ?? '9999-12-31';
    return fa.localeCompare(fb) || (Number(b.prioridad) || 2) - (Number(a.prioridad) || 2) || String(a.tema).localeCompare(String(b.tema), 'es');
}
