// LIMPIEZA AUTOMÁTICA con node-cron: cada noche archiva las actividades COMPLETADAS cuya fecha de vencimiento ya
// pasó (si no tienen vencimiento, su último día). Archivar ≠ borrar: salen de la agenda pero siguen en la base
// (la página de Proyectos las muestra y se pueden devolver a la agenda). Configurable en .env:
//   LIMPIEZA_MODO          archivar (por defecto) | eliminar (a la papelera, se purga sola) | desactivado
//   LIMPIEZA_CRON          expresión cron (por defecto "15 3 * * *": todos los días a las 03:15)
//   LIMPIEZA_DIAS_GRACIA   días de margen tras el vencimiento (por defecto 0)
//   ZONA_HORARIA           zona con la que se calcula «hoy» y se programa el cron (por defecto America/Bogota)
import cron from 'node-cron';
import * as db from '../../datos/index.js';
import { ahoraEn, zonaPorDefecto } from '../tiempo.js';

export function configuracionLimpieza(env = process.env) {
    const modo = ['archivar', 'eliminar', 'desactivado'].includes(env.LIMPIEZA_MODO) ? env.LIMPIEZA_MODO : 'archivar';
    const gracia = Number(env.LIMPIEZA_DIAS_GRACIA);
    const expresion = env.LIMPIEZA_CRON && cron.validate(env.LIMPIEZA_CRON) ? env.LIMPIEZA_CRON : '15 3 * * *';
    return { modo, expresion, diasGracia: Number.isInteger(gracia) && gracia >= 0 && gracia <= 365 ? gracia : 0, zona: zonaPorDefecto() };
}

/** Una pasada de limpieza. Devuelve { modo, hoy, cambiadas }. La usan el cron, el arranque y las pruebas. */
export async function ejecutarLimpieza({ modo, diasGracia, zona } = configuracionLimpieza(), instante = new Date()) {
    const hoy = ahoraEn(zona, instante).fecha;
    if (modo === 'desactivado') return { modo, hoy, cambiadas: 0 };
    const cambiadas = await db.archivarCompletadasBD({ hoy, diasGracia, modo });
    return { modo, hoy, cambiadas };
}

/** Programa la tarea (y hace una pasada al arrancar). Devuelve la tarea de node-cron (o null si está desactivada). */
export function iniciarLimpiezaAutomatica(config = configuracionLimpieza(), { registrar = console } = {}) {
    if (config.modo === 'desactivado') { registrar.log('🧹 Limpieza automática desactivada (LIMPIEZA_MODO=desactivado).'); return null; }
    const pasada = () => ejecutarLimpieza(config)
        .then((r) => { if (r.cambiadas) registrar.log(`🧹 Limpieza: ${r.cambiadas} actividad(es) completada(s) ${config.modo === 'eliminar' ? 'enviadas a la papelera' : 'archivadas'}.`); })
        .catch((e) => registrar.error('🧹 La limpieza automática falló:', e.message));
    const tarea = cron.schedule(config.expresion, pasada, { timezone: config.zona, name: 'limpieza-actividades', noOverlap: true });
    pasada();
    registrar.log(`🧹 Limpieza automática: ${config.modo} completadas vencidas (cron "${config.expresion}", ${config.zona}).`);
    return tarea;
}
