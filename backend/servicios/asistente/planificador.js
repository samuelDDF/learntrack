// Planificador DETERMINISTA: decide fechas en código (el LLM nunca coloca actividades).
// Usa la regla única de carga (compartido/carga.js). Funciones puras: reciben las actividades y las capacidades
// por día y devuelven operaciones + una frase de explicación por cada decisión.
import {
    actividadesDelDia, cargaDelDia, esHito, puntosActividad, nivelCarga, normalizarActividad,
    UMBRAL_ROJO, CAPACIDAD_POR_DEFECTO, capacidadDe
} from '../../../compartido/carga.js';
import { sumarDias, diasEntre, rangoFechas, fechaLarga, fechaCorta, aMinutos, deMinutos } from '../../../compartido/fechas.js';
import { vencimientoDe, porUrgencia } from '../../../compartido/prioridad.js';

export const VENTANA_DIAS = 7;
const MAX_OPS = 30;
const PESO_DISTANCIA = 4;

/** capacidades: objeto { iso: número | { animo } }, Map o función → función iso => número */
function lectorCapacidades(capacidades) {
    if (typeof capacidades === 'function') return (iso) => Number(capacidades(iso)) || CAPACIDAD_POR_DEFECTO;
    const leer = capacidades instanceof Map ? (iso) => capacidades.get(iso) : (iso) => capacidades?.[iso];
    return (iso) => { const c = leer(iso); return typeof c === 'number' ? c : capacidadDe(c); };
}

const intervalo = (a) => {
    if (!a.hora_inicio) return null;
    const ini = aMinutos(a.hora_inicio);
    const fin = a.hora_fin ? aMinutos(a.hora_fin) : ini + Math.round(Number(a.horas) * 60);
    return [ini, Math.max(fin, ini + 15)];
};

/** ¿La actividad (con hora) se cruza con otra del mismo día? */
export function seSolapa(lista, act, iso, excluirId = act.id) {
    const propio = intervalo(act);
    if (!propio) return false;
    return actividadesDelDia(lista, iso).some((o) => {
        if (o.id === excluirId) return false;
        const otro = intervalo(o);
        return otro && propio[0] < otro[1] && otro[0] < propio[1];
    });
}

class Simulacion {
    constructor(actividades, capacidades) {
        this.lista = actividades.map((a) => normalizarActividad(a));
        this.cap = lectorCapacidades(capacidades);
    }
    carga(iso) { return cargaDelDia(this.lista, iso, this.cap(iso)).porcentaje; }
    puntos(iso) { return cargaDelDia(this.lista, iso, this.cap(iso)).puntos; }
    /** % del día si se añadiera `act` */
    cargaCon(iso, act) { return Math.max(0, Math.round(((this.puntos(iso) + puntosActividad(act)) / this.cap(iso)) * 100)); }
    buscar(id) { return this.lista.find((a) => a.id === id); }
    mover(id, inicio, extra = {}) {
        const a = this.buscar(id);
        const dur = diasEntre(a.fecha_inicio, a.fecha_fin);
        Object.assign(a, { fecha_inicio: inicio, fecha: inicio, fecha_fin: sumarDias(inicio, dur) }, extra);
    }
    quitar(id) { this.lista = this.lista.filter((a) => a.id !== id); }
    agregar(act) { this.lista.push(normalizarActividad(act)); }
}

/**
 * Mejor día para una actividad (se desplaza el rango completo conservando su duración).
 * Criterios: dentro de [desde, hasta], nunca antes de hoy, sin días excluidos, sin solapamientos de hora,
 * ≤ 85 % en todos los días del rango (salvo permitirExceso), ocio/deporte no van a días ya saturados,
 * y entre los válidos se prefiere menos carga y más cercanía.
 */
function buscarHueco(sim, act, { desde, hasta, excluir = new Set(), referencia, permitirExceso = false, ignorarHora = false }) {
    const dur = diasEntre(act.fecha_inicio, act.fecha_fin);
    const prueba = ignorarHora ? { ...act, hora_inicio: null, hora_fin: null } : act;
    let mejor = null;
    for (const d of rangoFechas(desde, hasta)) {
        const dias = rangoFechas(d, sumarDias(d, dur));
        if (dias.some((x) => excluir.has(x))) continue;
        if (act.exigencia < 0 && dias.some((x) => sim.carga(x) > UMBRAL_ROJO)) continue;
        if (dias.some((x) => seSolapa(sim.lista, prueba, x))) continue;
        const despues = Math.max(...dias.map((x) => sim.cargaCon(x, prueba)));
        if (!permitirExceso && despues > UMBRAL_ROJO) continue;
        const antes = Math.max(...dias.map((x) => sim.carga(x)));
        const puntaje = despues + PESO_DISTANCIA * Math.abs(diasEntre(referencia, d));
        if (!mejor || puntaje < mejor.puntaje) mejor = { fecha: d, antes, despues, puntaje, sinHora: ignorarHora && Boolean(act.hora_inicio) };
    }
    return mejor;
}

/**
 * Último día al que se puede aplazar una actividad (URGENCIA):
 *  · su propia fecha de vencimiento (una tarea nunca se aplaza más allá de su entrega);
 *  · si pertenece a un proyecto con un hito posterior, el día anterior a ese hito.
 */
function limiteDeProyecto(lista, act) {
    const limites = [];
    if (act.fecha_vencimiento && act.fecha_vencimiento >= act.fecha_fin) limites.push(sumarDias(act.fecha_vencimiento, -diasEntre(act.fecha_inicio, act.fecha_fin)));
    if (act.proyecto) {
        const hitos = lista.filter((o) => o.id !== act.id && o.proyecto === act.proyecto && esHito(o) && o.fecha_inicio > act.fecha_fin)
            .map((o) => o.fecha_inicio).sort();
        if (hitos.length) limites.push(sumarDias(hitos[0], -1));
    }
    return limites.length ? limites.sort()[0] : null;
}

// ---------------------------------------------------------------- horarios libres (v3.4)
const FRANJAS = [
    { nombre: 'mañana', anclas: ['08:00', '09:00', '10:00', '07:00', '11:00'] },
    { nombre: 'tarde', anclas: ['14:00', '15:00', '16:00', '13:00', '17:00'] },
    { nombre: 'noche', anclas: ['18:00', '19:00', '20:00', '21:00'] }
];
/**
 * 2 o 3 horarios LIBRES para una actividad sin hora (uno por franja: mañana, tarde, noche), sin cruzarse con las
 * actividades con hora de ese día y, si es hoy, después de la hora actual. Devuelve ['08:00', '14:00', '18:00'].
 */
export function horariosLibres({ actividades, fecha, horas = 1, hoy, horaActual = null, cuantos = 3 }) {
    const lista = actividades.map((a) => normalizarActividad(a));
    const dur = Math.max(30, Math.round(Number(horas) * 60) || 60);
    const minimo = fecha === hoy && horaActual ? Math.ceil((aMinutos(horaActual) + 30) / 30) * 30 : 0;
    const libre = (hora) => {
        const ini = aMinutos(hora);
        if (ini < minimo || ini + dur > 23 * 60) return false;
        return !seSolapa(lista, { id: '__hueco__', hora_inicio: hora, hora_fin: deMinutos(ini + dur), horas: dur / 60, fecha_inicio: fecha, fecha_fin: fecha }, fecha);
    };
    const elegidos = [];
    for (const franja of FRANJAS) {
        const h = franja.anclas.find(libre);
        if (h) elegidos.push(h);
    }
    // Si alguna franja está llena, se completa con cualquier media hora libre entre las 07:00 y las 22:00
    for (let m = 7 * 60; elegidos.length < Math.min(cuantos, 2) && m <= 22 * 60; m += 30) {
        const h = deMinutos(m);
        if (!elegidos.includes(h) && libre(h)) elegidos.push(h);
    }
    return elegidos.sort().slice(0, cuantos);
}

const cambiosDeMovimiento = (sim, id, fecha, sinHora) => {
    const a = sim.buscar(id);
    const dur = diasEntre(a.fecha_inicio, a.fecha_fin);
    const c = { fecha_inicio: fecha, fecha, fecha_fin: sumarDias(fecha, dur) };
    if (sinHora) Object.assign(c, { hora_inicio: null, hora_fin: null });
    return c;
};
const etiquetaRango = (ini, fin) => (fin && fin !== ini ? `${fechaCorta(ini)}–${fechaCorta(fin)}` : fechaCorta(ini));
const diaODias = (act, fecha) => (act.fecha_fin !== act.fecha_inicio ? `a partir del ${fechaLarga(fecha)}` : `al ${fechaLarga(fecha)}`);
const eseDia = (act) => (act.fecha_fin !== act.fecha_inicio ? 'esos días tienes como máximo' : 'ese día tienes');

function reubicar(sim, act, { desde, hasta, excluir, hoy, explicaciones, avisos, movimientos }) {
    const referencia = act.fecha_inicio < hoy ? hoy : act.fecha_inicio;
    const opciones = { desde, hasta, excluir, referencia };
    let r = buscarHueco(sim, act, opciones);
    let motivo;
    if (r) motivo = `Moví «${act.titulo}» ${diaODias(act, r.fecha)} porque ${eseDia(act)} ${r.antes} % de carga.`;
    else if ((r = buscarHueco(sim, act, { ...opciones, permitirExceso: true }))) {
        motivo = `Moví «${act.titulo}» ${diaODias(act, r.fecha)}, aunque queda en ${r.despues} %: era la opción menos cargada.`;
        avisos.push(`No encontré un día por debajo del 85 % para «${act.titulo}»; te propongo lo menos malo.`);
    } else if ((r = buscarHueco(sim, act, { ...opciones, permitirExceso: true, ignorarHora: true }))) {
        motivo = `Moví «${act.titulo}» ${diaODias(act, r.fecha)} sin hora fija: a esa hora no había hueco libre.`;
        avisos.push(`«${act.titulo}» pierde su horario porque no había un hueco libre a la misma hora.`);
    } else {
        avisos.push(`No encontré dónde poner «${act.titulo}» entre ${fechaCorta(desde)} y ${fechaCorta(hasta)}; la dejé donde está.`);
        return false;
    }
    const de = { fecha_inicio: act.fecha_inicio, fecha_fin: act.fecha_fin, hora_inicio: act.hora_inicio, hora_fin: act.hora_fin };
    const cambios = cambiosDeMovimiento(sim, act.id, r.fecha, r.sinHora);
    sim.mover(act.id, r.fecha, r.sinHora ? { hora_inicio: null, hora_fin: null } : {});
    movimientos.push({ id: act.id, titulo: act.titulo, cambios, de, motivo, detalle: `${etiquetaRango(de.fecha_inicio, de.fecha_fin)} → ${etiquetaRango(cambios.fecha_inicio, cambios.fecha_fin)}` });
    explicaciones.push(motivo);
    return true;
}

/**
 * A) Liberar un día: TODAS las actividades pendientes de esa jornada reciben una decisión (aplazar o eliminar).
 * modo 'aplazar' (por defecto) reubica en los 7 días siguientes (o hasta `hasta`, sin pasar del vencimiento de
 * cada una; lo más urgente se coloca primero); modo 'eliminar' manda a la papelera.
 * Los hitos y las fijas (exámenes, entregas) también se incluyen, pero DESMARCADOS (`marcado: false`) y con aviso:
 * así la propuesta cubre toda la jornada y la persona decide si de verdad cambiaron. Las completadas no se tocan.
 */
export function liberarDia({ actividades, fecha, hoy, capacidades = {}, modo = 'aplazar', hasta = null }) {
    const sim = new Simulacion(actividades, capacidades);
    const delDia = actividadesDelDia(sim.lista, fecha);
    const explicaciones = [], avisos = [], movimientos = [], eliminaciones = [];
    const hechas = delDia.filter((a) => a.estado === 'completado');
    // Lo urgente primero (vence antes), y a igual urgencia lo más pesado
    const pendientes = delDia.filter((a) => a.estado !== 'completado')
        .sort((a, b) => porUrgencia(hoy)(a, b) || puntosActividad(b) - puntosActividad(a) || a.titulo.localeCompare(b.titulo, 'es'));
    const AVISO_HITO = 'Es un examen, una entrega o una actividad fija: márcala solo si de verdad cambió de fecha.';

    for (const a of hechas) explicaciones.push(`«${a.titulo}» ya está completada; la dejé donde está.`);

    if (modo === 'eliminar') {
        for (const a of pendientes.slice(0, MAX_OPS)) {
            const hito = esHito(a);
            eliminaciones.push({ id: a.id, titulo: a.titulo, motivo: 'Va a la papelera (puedes restaurarla).', detalle: etiquetaRango(a.fecha_inicio, a.fecha_fin), marcado: !hito, aviso: hito ? AVISO_HITO : null });
        }
        if (eliminaciones.length) explicaciones.unshift(`Mandaré ${eliminaciones.length} ${eliminaciones.length === 1 ? 'actividad' : 'actividades'} del ${fechaLarga(fecha)} a la papelera.`);
    } else {
        const desde = sumarDias(fecha < hoy ? hoy : fecha, fecha < hoy ? 0 : 1);
        for (const a of pendientes.slice(0, MAX_OPS)) {
            const limite = limiteDeProyecto(sim.lista, a);
            let hastaVentana = hasta ?? sumarDias(desde, VENTANA_DIAS - 1);
            if (limite && limite < hastaVentana) hastaVentana = limite;
            if (hastaVentana < desde) {
                avisos.push(`Ojo: «${a.titulo}» vence el ${fechaLarga(vencimientoDe(a) ?? fecha)}: si la aplazas, llega tarde.`);
                hastaVentana = desde;
            }
            const antes = movimientos.length;
            reubicar(sim, a, { desde, hasta: hastaVentana, excluir: new Set([fecha]), hoy, explicaciones, avisos, movimientos });
            if (movimientos.length > antes && esHito(a)) Object.assign(movimientos.at(-1), { marcado: false, aviso: AVISO_HITO });
        }
    }
    if (pendientes.length === 0) avisos.push(`El ${fechaLarga(fecha)} no tiene actividades pendientes que se puedan ${modo === 'eliminar' ? 'eliminar' : 'mover'}.`);
    return { mover: movimientos, eliminar: eliminaciones, crear: [], explicaciones, avisos, simulado: sim.lista };
}

/**
 * B) Reorganizar/balancear: mientras un día supere el 85 % se mueve su actividad movible más pesada al mejor
 * día de la ventana; si aun así sigue saturado, se inserta 1 h de descanso (ocio, recarga) ese día.
 */
export function reorganizar({ actividades, desde, hasta, hoy, capacidades = {} }) {
    const sim = new Simulacion(actividades, capacidades);
    const inicio = desde < hoy ? hoy : desde;
    const dias = rangoFechas(inicio, hasta < inicio ? inicio : hasta);
    const explicaciones = [], avisos = [], movimientos = [], creaciones = [];
    const descartadas = new Set();
    const saturadosIniciales = dias.filter((d) => sim.carga(d) > UMBRAL_ROJO);
    if (saturadosIniciales.length === 0) {
        return { mover: [], eliminar: [], crear: [], explicaciones: ['Tu semana ya está equilibrada: ningún día pasa del 85 %. 🎉'], avisos, simulado: sim.lista };
    }
    let vueltas = 0;
    while (movimientos.length + creaciones.length < MAX_OPS && vueltas++ < 60) {
        const saturado = dias.filter((d) => sim.carga(d) > UMBRAL_ROJO && !descartadas.has(d)).sort((a, b) => sim.carga(b) - sim.carga(a))[0];
        if (!saturado) break;
        const candidatas = actividadesDelDia(sim.lista, saturado)
            .filter((a) => !esHito(a) && a.estado !== 'completado' && a.exigencia > 0 && !movimientos.some((m) => m.id === a.id))
            .sort((a, b) => diasEntre(a.fecha_inicio, a.fecha_fin) - diasEntre(b.fecha_inicio, b.fecha_fin) || puntosActividad(b) - puntosActividad(a));
        let movida = false;
        for (const a of candidatas) {
            const antesDia = sim.carga(saturado);
            const r = buscarHueco(sim, a, { desde: inicio, hasta: dias.at(-1), excluir: new Set([saturado]), referencia: a.fecha_inicio });
            if (!r) continue;
            const de = { fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin };
            const cambios = cambiosDeMovimiento(sim, a.id, r.fecha, false);
            sim.mover(a.id, r.fecha);
            const motivo = `Moví «${a.titulo}» del ${fechaLarga(saturado)} (${antesDia} %) ${diaODias(a, r.fecha)} porque ${eseDia(a)} ${r.antes} % de carga.`;
            movimientos.push({ id: a.id, titulo: a.titulo, cambios, de, motivo, detalle: `${etiquetaRango(de.fecha_inicio, de.fecha_fin)} → ${etiquetaRango(cambios.fecha_inicio, cambios.fecha_fin)}` });
            explicaciones.push(motivo);
            movida = true;
            break;
        }
        if (!movida) descartadas.add(saturado);
    }
    for (const d of dias) {
        const pct = sim.carga(d);
        if (pct <= UMBRAL_ROJO || movimientos.length + creaciones.length >= MAX_OPS) continue;
        const descanso = {
            titulo: 'Pausa de descanso', tipo: 'ocio', exigencia: -2, horas: 1, fecha: d, fecha_inicio: d, fecha_fin: d,
            hora_inicio: null, hora_fin: null, estado: 'pendiente', proyecto: '', fija: false
        };
        sim.agregar({ ...descanso, id: `nuevo-${creaciones.length}` });
        const motivo = `El ${fechaLarga(d)} sigue en ${pct} % (lo que queda no se puede mover): añadí 1 h de descanso para recuperar energía.`;
        creaciones.push({ datos: descanso, motivo, detalle: fechaLarga(d), marcado: true });
        explicaciones.push(motivo);
    }
    return { mover: movimientos, eliminar: [], crear: creaciones, explicaciones, avisos, simulado: sim.lista };
}

/**
 * C) Desglose de proyecto: agenda las tareas (ya validadas) en orden, antes de la fecha límite, dejando 1 día de
 * colchón, sin pasar de `horasDia` del proyecto por día ni del 85 % de carga. Bloques consecutivos con las mismas
 * horas se agrupan en un rango (horas = horas por día). Los hitos (entrega) van el día de la fecha límite, fijos.
 */
export function planificarProyecto({ actividades, tareas, nombre, fechaLimite, horasDia = 2, hoy, capacidades = {}, horario = null, desde = null }) {
    const sim = new Simulacion(actividades, capacidades);
    const explicaciones = [], avisos = [], creaciones = [];
    const proyecto = String(nombre || 'Proyecto').slice(0, 60);
    let ultimo = sumarDias(fechaLimite, -2);
    if (fechaLimite <= hoy) {
        avisos.push('La fecha límite es hoy o ya pasó: agendé todo lo antes posible y sin colchón.');
        ultimo = sumarDias(hoy, 6);
    } else if (ultimo < hoy) {
        ultimo = sumarDias(fechaLimite, -1);
        if (ultimo < hoy) ultimo = hoy;
        avisos.push('No hay tiempo para dejar un día de colchón antes de la entrega.');
    }
    const ventanaHorario = horario?.hora_inicio && horario?.hora_fin ? [aMinutos(horario.hora_inicio), aMinutos(horario.hora_fin)] : null;
    const maxDia = Math.max(0.5, Math.min(8, ventanaHorario ? Math.min(horasDia, (ventanaHorario[1] - ventanaHorario[0]) / 60) : horasDia));
    const usado = new Map();
    const trabajo = tareas.filter((t) => !t.hito);
    const hitos = tareas.filter((t) => t.hito);
    let puntero = desde && desde > hoy ? desde : hoy;     // `desde`: p. ej. preparar un examen los días previos
    let desbordes = 0;

    const capacidadRestante = (d, exig) => {
        if (exig <= 0) return 12;
        const libres = (UMBRAL_ROJO / 100) * sim.cap(d) - sim.puntos(d);
        return Math.floor((libres / (exig * 10)) * 2) / 2;
    };
    const bloque = (t, d, h, inicioMin) => ({
        titulo: t.titulo, tipo: t.tipo, exigencia: t.exigencia, horas: h, fecha: d, fecha_inicio: d, fecha_fin: d,
        hora_inicio: inicioMin !== null ? deMinutos(inicioMin) : null,
        hora_fin: inicioMin !== null ? deMinutos(inicioMin + h * 60) : null,
        estado: 'pendiente', proyecto, fija: false
    });

    for (const t of trabajo) {
        let restante = t.horas;
        const piezas = [];
        for (let d = puntero; d <= ultimo && restante > 0; d = sumarDias(d, 1)) {
            const libreProyecto = maxDia - (usado.get(d) ?? 0);
            let h = Math.min(restante, libreProyecto, capacidadRestante(d, t.exigencia));
            h = Math.floor(h * 2) / 2;
            if (h < 0.5) continue;
            let inicioMin = null;
            if (ventanaHorario) {
                inicioMin = ventanaHorario[0] + (usado.get(d) ?? 0) * 60;
                const prueba = bloque(t, d, h, inicioMin);
                if (seSolapa(sim.lista, prueba, d, '__nuevo__')) continue;
            }
            const b = bloque(t, d, h, inicioMin);
            sim.agregar({ ...b, id: `p-${creaciones.length}-${piezas.length}` });
            usado.set(d, (usado.get(d) ?? 0) + h);
            piezas.push(b);
            restante -= h;
            puntero = d;
        }
        // Lo que no cupo respetando el 85 %: lo menos malo (días menos cargados antes de la entrega)
        while (restante > 0) {
            const opciones = rangoFechas(hoy, fechaLimite <= hoy ? ultimo : sumarDias(fechaLimite, -1))
                .filter((d) => (usado.get(d) ?? 0) < 8)
                .sort((a, b) => sim.carga(a) - sim.carga(b) || a.localeCompare(b));
            if (opciones.length === 0) break;
            const d = opciones[0];
            const h = Math.min(restante, Math.max(0.5, maxDia));
            const b = bloque(t, d, h, null);
            sim.agregar({ ...b, id: `x-${creaciones.length}-${piezas.length}` });
            usado.set(d, (usado.get(d) ?? 0) + h);
            piezas.push(b);
            restante -= h;
            desbordes++;
        }
        // Agrupa días consecutivos con las mismas horas en un rango
        piezas.sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
        const grupos = [];
        for (const p of piezas) {
            const g = grupos.at(-1);
            if (g && g.horas === p.horas && sumarDias(g.fecha_fin, 1) === p.fecha_inicio && g.hora_inicio === p.hora_inicio) g.fecha_fin = p.fecha_fin;
            else grupos.push({ ...p });
        }
        grupos.forEach((g, i) => {
            const datos = { ...g, titulo: grupos.length > 1 ? `${t.titulo} (parte ${i + 1})`.slice(0, 100) : t.titulo };
            const motivo = `«${datos.titulo}»: ${etiquetaRango(g.fecha_inicio, g.fecha_fin)}, ${g.horas} h${g.fecha_fin !== g.fecha_inicio ? ' por día' : ''}.`;
            creaciones.push({ datos, motivo, detalle: `${etiquetaRango(g.fecha_inicio, g.fecha_fin)} · ${g.horas} h${g.fecha_fin !== g.fecha_inicio ? '/día' : ''}`, marcado: true });
        });
    }
    for (const t of hitos) {
        const d = fechaLimite < hoy ? hoy : fechaLimite;
        const datos = { ...bloque(t, d, t.horas, null), fija: true };
        sim.agregar({ ...datos, id: `h-${creaciones.length}` });
        creaciones.push({ datos, motivo: `«${t.titulo}» queda fija el ${fechaLarga(d)} (fecha límite).`, detalle: `${fechaLarga(d)} · fija`, marcado: true });
    }
    if (creaciones.length > MAX_OPS) {
        avisos.push(`El plan tenía ${creaciones.length} bloques; muestro los primeros ${MAX_OPS}.`);
        creaciones.length = MAX_OPS;
    }
    const totalHoras = trabajo.reduce((s, t) => s + t.horas, 0);
    explicaciones.push(`Repartí ${totalHoras} h de trabajo en bloques de hasta ${maxDia} h por día, sin pasar del 85 % de carga.`);
    if (fechaLimite > hoy && sumarDias(fechaLimite, -1) >= hoy && !avisos.some((a) => a.includes('colchón'))) {
        explicaciones.push(`Terminas a más tardar el ${fechaLarga(ultimo)} y el ${fechaLarga(sumarDias(fechaLimite, -1))} queda libre como colchón.`);
    }
    if (desbordes) avisos.push('No cabía todo respetando el 85 % de carga: algunos bloques quedan en días cargados. Considera mover la fecha límite o dedicar más horas al día.');
    explicaciones.push(...creaciones.map((c) => c.motivo));
    return { mover: [], eliminar: [], crear: creaciones, explicaciones, avisos, simulado: sim.lista, proyecto };
}

/** Desplaza varias actividades (p. ej. un proyecto completo) `delta` días conservando sus duraciones */
export function desplazar({ actividades, ids, delta }) {
    const set = new Set(ids);
    return actividades.filter((a) => set.has(a.id)).map((a0) => {
        const a = normalizarActividad(a0);
        const ini = sumarDias(a.fecha_inicio, delta);
        const fin = sumarDias(a.fecha_fin, delta);
        return {
            id: a.id, titulo: a.titulo, cambios: { fecha_inicio: ini, fecha: ini, fecha_fin: fin },
            de: { fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin, hora_inicio: a.hora_inicio, hora_fin: a.hora_fin },
            detalle: `${etiquetaRango(a.fecha_inicio, a.fecha_fin)} → ${etiquetaRango(ini, fin)}`,
            motivo: `«${a.titulo}» se desplaza ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'día' : 'días'} ${delta >= 0 ? 'después' : 'antes'}.`
        };
    });
}

/** Aplica operaciones planas sobre una copia (para calcular la carga antes/después sin tocar la BD) */
export function simularOperaciones(actividades, operaciones, papelera = []) {
    let lista = actividades.map((a) => normalizarActividad(a));
    let n = 0;
    for (const o of operaciones) {
        if (o.op === 'crear') lista.push(normalizarActividad({ ...o.datos, id: `sim-${n++}` }));
        else if (o.op === 'editar') lista = lista.map((a) => (a.id === o.id ? normalizarActividad({ ...a, ...o.cambios }) : a));
        else if (o.op === 'eliminar') lista = lista.filter((a) => a.id !== o.id);
        else if (o.op === 'restaurar') { const p = papelera.find((x) => x.id === o.id); if (p) lista.push(normalizarActividad({ ...p, eliminadaEn: null })); }
    }
    return lista;
}

/** Días tocados por un conjunto de actividades (rango completo de cada una), ordenados */
export function diasDe(acts) {
    const s = new Set();
    for (const a0 of acts) {
        if (!a0) continue;
        const a = normalizarActividad(a0);
        if (!a.fecha_inicio) continue;
        for (const d of rangoFechas(a.fecha_inicio, a.fecha_fin, 62)) s.add(d);
    }
    return [...s].sort();
}

/** [{ fecha, etiqueta, antes, despues, nivelAntes, nivelDespues }] */
export function cargasAntesDespues(antes, despues, dias, capacidades = {}) {
    const cap = lectorCapacidades(capacidades);
    return dias.slice(0, 31).map((d) => {
        const a = cargaDelDia(antes, d, cap(d)).porcentaje;
        const b = cargaDelDia(despues, d, cap(d)).porcentaje;
        return { fecha: d, etiqueta: fechaCorta(d), antes: a, despues: b, nivelAntes: nivelCarga(a), nivelDespues: nivelCarga(b) };
    });
}

/** Mejor día (próximos 7) para UNA actividad concreta, con la misma regla de A. Devuelve el movimiento o null. */
export function mejorDia({ actividades, id, hoy, capacidades = {} }) {
    const sim = new Simulacion(actividades, capacidades);
    const act = sim.buscar(id);
    if (!act) return { movimiento: null, avisos: ['No encontré la actividad.'] };
    const explicaciones = [], avisos = [], movimientos = [];
    const desde = sumarDias(act.fecha_inicio < hoy ? hoy : act.fecha_inicio, act.fecha_inicio < hoy ? 0 : 1);
    reubicar(sim, act, { desde, hasta: sumarDias(desde, VENTANA_DIAS - 1), excluir: new Set(rangoFechas(act.fecha_inicio, act.fecha_fin, 62)), hoy, explicaciones, avisos, movimientos });
    return { movimiento: movimientos[0] ?? null, avisos };
}
