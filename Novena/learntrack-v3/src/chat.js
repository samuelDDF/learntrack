// Orquestación de POST /api/ia/chat (y de la carga de archivos).
// Flujo: el LLM SOLO clasifica y extrae → validación con esquema estricto → lógica determinista (fechas,
// cargas, planificador) → respuesta: aplicado (con Deshacer) | propuesta (Aplicar/Cancelar) | aclaración | respuesta.
// Nada que venga del modelo se escribe sin pasar por aquí.
import * as ia from './ai-service.js';
import * as db from './database.js';
import * as I from './interpretar.js';
import * as P from './planificador.js';
import { normalizarActividadIA, normalizarParcheIA, validarActividad, limpiarTextoVisible } from './validacion.js';
import { normalizarActividad, actividadesDelDia, cargaDelDia, capacidadDe, esHito, UMBRAL_ROJO } from '../compartido/carga.js';
import { sumarDias, fechaLarga, fechaCorta, rangoFechas, inicioDiaLocal, diasEntre, ultimoDiaMes, esISO } from '../compartido/fechas.js';
import { detectarTipo, extraerTexto, fragmentar, citaVerificada, ErrorArchivo } from './archivos.js';
import { parsearICS, categoriaDe } from './ics.js';

export class ErrorChat extends Error {
    constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

const VENTANA_CONTEXTO = 14;
const MAX_CONTEXTO = 40;
const EXIG_TXT = { 3: 'alta', 2: 'media', 1: 'baja', '-2': 'recarga' };
const resp = (tipo, mensaje, extra = {}) => ({ tipo, mensaje, ...extra });

// ====================================================================== contexto
export async function cargarContexto(usuario, entrada) {
    const hoy = entrada.fechaHoy;
    const [actividades, proyectos, checkins] = await Promise.all([
        db.obtenerActividadesBD(usuario.id),
        db.obtenerProyectosBD(usuario.id),
        db.obtenerCheckinsBD(usuario.id, sumarDias(hoy, -31), sumarDias(hoy, 120))
    ]);
    const capacidades = Object.fromEntries(checkins.map((c) => [c.fecha, capacidadDe(c)]));
    return { userId: usuario.id, hoy, tzOffset: entrada.tzOffset ?? 0, historial: entrada.historial ?? [], actividades, proyectos, capacidades };
}

/** Actividades relevantes para el modelo: ventana ±14 días, máx. 40, campos completos pero compactos */
export function contextoCompacto(ctx) {
    const desde = sumarDias(ctx.hoy, -VENTANA_CONTEXTO), hasta = sumarDias(ctx.hoy, VENTANA_CONTEXTO);
    return ctx.actividades
        .filter((a) => a.fecha_inicio <= hasta && a.fecha_fin >= desde)
        .sort((x, y) => Math.abs(diasEntre(ctx.hoy, x.fecha_inicio)) - Math.abs(diasEntre(ctx.hoy, y.fecha_inicio)))
        .slice(0, MAX_CONTEXTO)
        .map((a) => {
            const c = { id: a.id, t: a.titulo, tipo: a.tipo, ex: a.exigencia, h: a.horas, fi: a.fecha_inicio };
            if (a.fecha_fin !== a.fecha_inicio) c.ff = a.fecha_fin;
            if (a.hora_inicio) c.hi = a.hora_inicio;
            if (a.hora_fin) c.hf = a.hora_fin;
            c.est = a.estado;
            if (a.proyecto) c.proy = a.proyecto;
            if (a.fija) c.fija = true;
            return c;
        });
}

const registroCompleto = (a) => ({
    titulo: a.titulo, tipo: a.tipo, exigencia: a.exigencia, horas: a.horas, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
    hora_inicio: a.hora_inicio, hora_fin: a.hora_fin, estado: a.estado, proyecto: a.proyecto, fija: a.fija
});

// ====================================================================== utilidades de texto
const VACIAS = new Set(['para', 'como', 'esta', 'este', 'todo', 'toda', 'todas', 'todos', 'tarea', 'tareas', 'actividad', 'actividades', 'que', 'del', 'las', 'los', 'una', 'uno', 'mueve', 'muevela', 'pasa', 'borra', 'elimina', 'restaura', 'recupera', 'cambia', 'ponle', 'quita', 'mañana', 'manana', 'hoy', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'semana', 'agenda', 'borre', 'borré', 'lo', 'mis', 'mi', 'con', 'sin', 'por', 'ayer', 'cuando', 'donde', 'proyecto']);
const palabras = (t) => I.normalizarTexto(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VACIAS.has(w));

/** Coincidencia difusa por palabras del título. Devuelve [{ a, puntos }] ordenado. */
function coincidencias(lista, referencia) {
    const ref = palabras(referencia);
    if (ref.length === 0) return [];
    return lista.map((a) => {
        const tit = palabras(`${a.titulo} ${a.proyecto ?? ''}`);
        let puntos = 0;
        for (const w of ref) if (tit.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) puntos++;
        return { a, puntos };
    }).filter((x) => x.puntos > 0).sort((x, y) => y.puntos - x.puntos);
}

function proyectoMencionado(ctx, texto, clas) {
    const t = I.normalizarTexto(`${texto} ${clas?.proyecto ?? ''}`);
    const encontrados = ctx.proyectos.filter((p) => t.includes(I.normalizarTexto(p)));
    if (encontrados.length) return encontrados.sort((a, b) => b.length - a.length)[0];
    if (clas?.proyecto) {
        const exacto = ctx.proyectos.find((p) => I.normalizarTexto(p) === I.normalizarTexto(clas.proyecto));
        if (exacto) return exacto;
    }
    return null;
}

/** Correcciones deterministas cuando la intención es inequívoca por el texto (el modelo 3B a veces falla) */
export function corregirIntencion(intencion, texto) {
    const t = I.normalizarTexto(texto);
    if (/\b(organiza(me)?|reorganiza|balancea|equilibra|distribuye|tengo demasiad|estoy saturad|ordena(me)? (la|mi) semana)\b/.test(t) && !/\bproyecto\b/.test(t)) return 'reorganizar';
    if (/\b(recupera|restaura|restablece|devuelve(me)? lo que borre)\b/.test(t)) return 'restaurar';
    if (/\b(libera|despeja|vacia|desocupa)\b.*\b(dia|agenda|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\b(hoy|manana) no (puedo|voy a poder)\b/.test(t)) return 'liberar_dia';
    if (/\b(elimina|borra|quita|cancela)\b.*\btodo (lo )?(del?|de este|de la)\b/.test(t)) return 'liberar_dia';
    if (/\b(tengo que|debo|necesito) (hacer|entregar|terminar|preparar)\b.*\bproyecto\b|\bproyecto\b.*\bpara el\b/.test(t) && intencion !== 'mover' && intencion !== 'eliminar') return 'planificar_proyecto';
    if (/\b(importa|importar|carga(r)? (un|mi) (archivo|horario|calendario|pdf|documento))\b/.test(t)) return 'importar';
    return intencion;
}

// ====================================================================== cargas y presentación
function cargasDe(ctx, antes, despues, actsTocadas) {
    const dias = P.diasDe(actsTocadas).filter((d) => d >= sumarDias(ctx.hoy, -1));
    return P.cargasAntesDespues(antes, despues, dias.length ? dias : P.diasDe(actsTocadas), ctx.capacidades);
}

const cuando = (a) => `${fechaCorta(a.fecha_inicio)}${a.fecha_fin !== a.fecha_inicio ? ` → ${fechaCorta(a.fecha_fin)}` : ''}${a.hora_inicio ? `, ${a.hora_inicio}${a.hora_fin ? `–${a.hora_fin}` : ''}` : ''}`;

async function aplicarDirecto(ctx, operaciones, { mensaje, supuestos = [], avisos = [], tocadas = [] }) {
    const loteId = db.nuevoId();
    let degradado = false;
    try {
        ({ degradado } = await db.conTransaccion((session) => db.aplicarCambiosBD(ctx.userId, operaciones, { session, origen: 'ia', loteId })));
    } catch (e) {
        if (!db.transaccionesDisponibles()) await db.deshacerLoteBD(ctx.userId, loteId).catch(() => {});
        throw e;
    }
    const actividades = await db.obtenerActividadesBD(ctx.userId);
    const simulado = P.simularOperaciones(ctx.actividades, operaciones);
    if (degradado) avisos.push('Tu MongoDB no admite transacciones (servidor independiente): el cambio se aplicó sin atomicidad.');
    return resp('aplicado', mensaje, { loteId, actividades, supuestos, avisos, cargas: cargasDe(ctx, ctx.actividades, simulado, [...tocadas, ...simulado.filter((a) => tocadas.some((t) => t.id === a.id))]) });
}

/** Construye una propuesta (guardada en MongoDB, un solo uso, 10 min) a partir del resultado del planificador */
async function proponer(ctx, tipo, r, { titulo, supuestos = [], restaurar = [], editar = [], papelera = [], seleccionable = false }) {
    const operaciones = [];
    const items = [];
    const agregar = (op, item) => { items.push({ idx: operaciones.length, ...item }); operaciones.push(op); };
    for (const c of r.crear ?? []) agregar({ op: 'crear', datos: c.datos }, { op: 'crear', titulo: c.datos.titulo, detalle: c.detalle ?? cuando(normalizarActividad(c.datos)), motivo: c.motivo, marcado: c.marcado !== false, cita: c.cita ?? null, aviso: c.aviso ?? null });
    for (const m of r.mover ?? []) agregar({ op: 'editar', id: m.id, cambios: m.cambios }, { op: 'mover', titulo: m.titulo, detalle: m.detalle, motivo: m.motivo, marcado: true });
    for (const e of editar) agregar({ op: 'editar', id: e.id, cambios: e.cambios }, { op: 'editar', titulo: e.titulo, detalle: e.detalle, motivo: e.motivo, marcado: true });
    for (const e of r.eliminar ?? []) agregar({ op: 'eliminar', id: e.id }, { op: 'eliminar', titulo: e.titulo, detalle: e.detalle, motivo: e.motivo, marcado: true });
    for (const x of restaurar) agregar({ op: 'restaurar', id: x.id }, { op: 'restaurar', titulo: x.titulo, detalle: x.detalle, motivo: x.motivo, marcado: true });

    if (operaciones.length === 0) {
        return resp('respuesta', [...(r.explicaciones ?? []), ...(r.avisos ?? [])].join(' ') || 'No encontré cambios que hacer.', { avisos: r.avisos ?? [] });
    }
    if (operaciones.length > db.MAX_OPERACIONES) throw new ErrorChat(422, `La propuesta tendría ${operaciones.length} cambios; el máximo es ${db.MAX_OPERACIONES}. Pide algo más acotado.`);

    const simulado = P.simularOperaciones(ctx.actividades, operaciones, papelera);
    const ids = new Set(operaciones.filter((o) => o.id).map((o) => o.id));
    const tocadasAntes = [...ctx.actividades.filter((a) => ids.has(a.id)), ...papelera.filter((a) => ids.has(a.id))];
    const tocadasDespues = simulado.filter((a) => ids.has(a.id) || String(a.id).startsWith('sim-'));
    const presentacion = {
        titulo, items, explicaciones: r.explicaciones ?? [], avisos: r.avisos ?? [], supuestos,
        cargas: cargasDe(ctx, ctx.actividades, simulado, [...tocadasAntes, ...tocadasDespues])
    };
    const doc = await db.crearPropuestaBD(ctx.userId, { tipo, operaciones: { lista: operaciones }, presentacion, seleccionable });
    const n = operaciones.length;
    // Vista agrupada { crear[], editar[], mover[], eliminar[], restaurar[] } (los índices son los que acepta "seleccion")
    const agrupadas = { crear: [], editar: [], mover: [], eliminar: [], restaurar: [] };
    for (const it of items) agrupadas[it.op]?.push({ idx: it.idx, titulo: it.titulo, detalle: it.detalle, motivo: it.motivo });
    return resp('propuesta', `${titulo}: ${n} ${n === 1 ? 'cambio' : 'cambios'}. Revísalos y pulsa «Aplicar» para confirmar.`, {
        propuesta: { id: doc.id, tipo, expira: doc.expira, seleccionable, operaciones: agrupadas, ...presentacion }
    });
}

async function aclarar(ctx, { intencion, texto, clas, preguntas, datos = {} }) {
    const lista = preguntas.slice(0, 2);
    const doc = await db.crearPropuestaBD(ctx.userId, { tipo: 'aclaracion', estado: { intencion, texto, clas, datos, preguntas: lista } });
    return resp('aclaracion', lista.map((p) => p.texto).join(' '), { aclaracion: { id: doc.id, preguntas: lista, expira: doc.expira } });
}

const preguntaFecha = (ctx, id, texto) => ({
    id, tipo: 'fecha', texto,
    opciones: [0, 1, 2, 3].map((i) => { const d = sumarDias(ctx.hoy, i); return { etiqueta: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : fechaCorta(d), valor: d }; })
});

// ====================================================================== objetivos
async function idsDelModelo(ctx, clas) {
    if (!clas.ids?.length) return [];
    // Los ids que propone el modelo se verifican en UNA consulta { userId, id: { $in } }; si no coinciden todos, se descartan.
    const ok = await db.verificarIdsBD(ctx.userId, clas.ids);
    return ok ? ctx.actividades.filter((a) => clas.ids.includes(a.id)) : [];
}

async function resolverObjetivos(ctx, texto, clas) {
    const proyecto = proyectoMencionado(ctx, texto, clas);
    const delModelo = await idsDelModelo(ctx, clas);
    if (proyecto && /\bproyecto\b/.test(I.normalizarTexto(texto))) {
        return { tipo: 'proyecto', proyecto, lista: ctx.actividades.filter((a) => a.proyecto === proyecto) };
    }
    const ref = clas.referencia || texto;
    if (delModelo.length) {
        // Si el modelo eligió ids pero ninguno comparte palabras con lo que dijo el usuario, se ignoran
        const conPalabras = delModelo.filter((a) => coincidencias([a], ref).length > 0);
        if (conPalabras.length || palabras(ref).length === 0) return { tipo: 'ids', lista: conPalabras.length ? conPalabras : delModelo };
    }
    const c = coincidencias(ctx.actividades, ref);
    if (c.length === 0) return { tipo: 'ninguno', lista: [] };
    const max = c[0].puntos;
    const empatadas = c.filter((x) => x.puntos === max).map((x) => x.a)
        .sort((x, y) => Math.abs(diasEntre(ctx.hoy, x.fecha_inicio)) - Math.abs(diasEntre(ctx.hoy, y.fecha_inicio)));
    return { tipo: empatadas.length === 1 ? 'unico' : 'varios', lista: empatadas };
}

const opcionesActividades = (lista) => lista.slice(0, 4).map((a) => ({ etiqueta: `${a.titulo} (${fechaCorta(a.fecha_inicio)})`, valor: a.id }));

// ====================================================================== intenciones
async function crear(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    let crudas = forzado.actividades;
    if (!crudas) {
        const ext = await ia.extraerCrear({ texto, hoy: ctx.hoy, historial: ctx.historial });
        crudas = ext.actividades;
    }
    if (!crudas.length) return resp('respuesta', 'No identifiqué ninguna actividad para agendar. Prueba con «Mañana estudio cálculo 2 horas».');
    const cansancio = I.nivelCansancio(texto);
    const completado = I.indicaCompletado(texto);
    const rango = I.resolverRango(texto, ctx.hoy);
    const horario = I.buscarHoras(texto);
    const duracion = I.buscarDuracion(texto);
    const avisos = [];
    const listas = [];
    for (const [i, crudo] of crudas.entries()) {
        const c = { ...crudo };
        if (crudas.length === 1) {
            // Fechas, horas y duraciones se resuelven en código; el modelo solo aporta título, tipo y exigencia
            if (rango) { c.fecha_inicio = rango.inicio; c.fecha_fin = rango.fin; }
            else if (!esISO(c.fecha_inicio) || c.fecha_inicio < sumarDias(ctx.hoy, -60) || c.fecha_inicio > sumarDias(ctx.hoy, 400)) {
                c.fecha_inicio = ctx.hoy; c.fecha_fin = ctx.hoy;
                if (!forzado.actividades) supuestos.push('La agendé para hoy porque no mencionaste el día.');
            }
            if (horario) {
                c.hora_inicio = horario.hora_inicio;
                c.hora_fin = horario.cruzaMedianoche ? null : horario.hora_fin;
                if (horario.duracion) c.horas = horario.duracion;
                if (horario.cruzaMedianoche) supuestos.push(`Termina a las ${horario.hora_fin} del día siguiente: la registré el día de inicio con ${horario.duracion} h.`);
            } else if (!forzado.actividades) { c.hora_inicio = null; c.hora_fin = null; }
            if (duracion && !(horario?.duracion)) c.horas = duracion.horas;
            if (!duracion && !horario?.duracion && !forzado.actividades && !(Number(c.horas) > 0)) supuestos.push('No dijiste cuánto dura: le puse 1 h.');
        }
        c.estado = completado ? 'completado' : (c.estado === 'en_proceso' && /\b(estoy|empece|empezando|en proceso)\b/.test(I.normalizarTexto(texto)) ? 'en_proceso' : 'pendiente');
        const n = normalizarActividadIA(c, ctx.hoy, { cansancio });
        const { error, valor } = n ? validarActividad(n) : { error: 'sin título' };
        if (error) { avisos.push(`Descarté la actividad ${i + 1}: ${error}`); continue; }
        listas.push(valor);
    }
    if (!listas.length) return resp('respuesta', `No pude interpretar bien la actividad. ${avisos.join(' ')}`.trim());

    if (listas.length === 1) {
        const a = listas[0];
        const choque = a.hora_inicio && rangoFechas(a.fecha_inicio, a.fecha_fin, 62).map((d) => actividadesDelDia(ctx.actividades, d)
            .find((o) => P.seSolapa([o], { ...a, id: '__nuevo__' }, d))).find(Boolean);
        if (choque && !forzado.confirmado) {
            return aclarar(ctx, {
                intencion: 'crear', texto, clas, datos: { actividades: [a], supuestos },
                preguntas: [{ id: 'confirmar', tipo: 'confirmar', texto: `«${a.titulo}» se cruza con «${choque.titulo}» (${choque.hora_inicio}${choque.hora_fin ? `–${choque.hora_fin}` : ''}). ¿La creo igual?`, opciones: [{ etiqueta: 'Crear igual', valor: 'si' }, { etiqueta: 'No crear', valor: 'no' }] }]
            });
        }
        const despues = [...ctx.actividades, { ...a, id: '__nuevo__' }];
        const altos = rangoFechas(a.fecha_inicio, a.fecha_fin, 62).map((d) => cargaDelDia(despues, d, ctx.capacidades[d] ?? 100)).filter((c) => c.porcentaje > UMBRAL_ROJO);
        if (altos.length) avisos.push(`Ojo: ${altos.map((c) => `el ${fechaCorta(c.fecha)} queda en ${c.porcentaje} %`).join(', ')}. Considera descansar o aplazar algo.`);
        const mensaje = `✅ Agendé «${a.titulo}» — ${cuando(a)} · Exigencia ${EXIG_TXT[a.exigencia]}${a.estado === 'completado' ? ' · completada' : ''}.`;
        return aplicarDirecto(ctx, [{ op: 'crear', datos: a }], { mensaje, supuestos, avisos, tocadas: [{ ...a, id: '__nuevo__' }] });
    }
    return proponer(ctx, 'crear', { crear: listas.map((a) => ({ datos: a, detalle: `${cuando(a)} · exigencia ${EXIG_TXT[a.exigencia]}`, motivo: 'Nueva actividad' })), explicaciones: [], avisos }, { titulo: `Crear ${listas.length} actividades`, supuestos });
}

async function editar(ctx, { texto, clas, forzado = {} }) {
    let objetivo = forzado.id ? ctx.actividades.find((a) => a.id === forzado.id) : null;
    if (!objetivo) {
        const o = await resolverObjetivos(ctx, texto, clas);
        if (o.lista.length === 0) return resp('respuesta', 'No encontré esa actividad en tu agenda. ¿Cómo se llama?');
        if (o.lista.length > 1) {
            return aclarar(ctx, { intencion: 'editar', texto, clas, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: '¿Cuál de estas actividades quieres cambiar?', opciones: opcionesActividades(o.lista) }] });
        }
        objetivo = o.lista[0];
    }
    const { cambios } = await ia.extraerEdicion({ texto, hoy: ctx.hoy, actual: registroCompleto(objetivo) });
    return aplicarParche(ctx, objetivo, cambios, texto);
}

/** Aplica SOLO lo que el usuario pidió: el parche del modelo se filtra por los campos mencionados en el texto */
async function aplicarParche(ctx, objetivo, crudo, texto, { supuestos = [], destino = null } = {}) {
    const fechas = destino ? [{ inicio: destino, fin: destino }] : I.buscarFechas(texto, ctx.hoy).filter((f) => f.inicio !== objetivo.fecha_inicio);
    const horario = I.buscarHoras(texto);
    const duracion = I.buscarDuracion(texto);
    const mencionados = I.camposMencionados(texto, { hayFecha: fechas.length > 0, hayHora: Boolean(horario), hayDuracion: Boolean(duracion) });
    const filtrado = Object.fromEntries(Object.entries(crudo ?? {}).filter(([k]) => mencionados.has(k === 'fecha' ? 'fecha_inicio' : k)));
    // Fechas y horas: deterministas (la última fecha mencionada suele ser el destino: "pasa el taller del jueves al viernes")
    if (fechas.length) {
        const destino = fechas.at(-1);
        filtrado.fecha_inicio = destino.inicio;
        if (destino.fin !== destino.inicio) filtrado.fecha_fin = destino.fin; else delete filtrado.fecha_fin;
    } else { delete filtrado.fecha_inicio; delete filtrado.fecha_fin; delete filtrado.fecha; }
    if (horario) {
        filtrado.hora_inicio = horario.hora_inicio;
        if (horario.hora_fin && !horario.cruzaMedianoche) filtrado.hora_fin = horario.hora_fin; else delete filtrado.hora_fin;
        if (horario.duracion) filtrado.horas = horario.duracion;
    }
    if (duracion && mencionados.has('horas') && !horario?.duracion) filtrado.horas = duracion.horas;
    if (mencionados.has('estado') && I.indicaCompletado(texto)) filtrado.estado = 'completado';

    const parche = normalizarParcheIA(filtrado, objetivo, { cansancio: I.nivelCansancio(texto), respetarExigencia: mencionados.has('exigencia') });
    if (Object.keys(parche).length === 0) return resp('respuesta', `No vi ningún cambio que aplicar a «${objetivo.titulo}». ¿Qué quieres cambiar?`);
    const { error, valor } = validarActividad(parche, { completa: false });
    if (error) return resp('respuesta', `No pude aplicar ese cambio: ${error}`);

    const nuevo = normalizarActividad({ ...objetivo, ...valor });
    const avisos = [];
    const despues = ctx.actividades.map((a) => (a.id === objetivo.id ? nuevo : a));
    for (const d of rangoFechas(nuevo.fecha_inicio, nuevo.fecha_fin, 62)) {
        const c = cargaDelDia(despues, d, ctx.capacidades[d] ?? 100);
        if (c.porcentaje > UMBRAL_ROJO) { avisos.push(`Ojo: el ${fechaCorta(d)} queda en ${c.porcentaje} %.`); break; }
    }
    const NOMBRES = { titulo: 'título', tipo: 'tipo', exigencia: 'exigencia', horas: 'horas', fecha_inicio: 'fecha', hora_inicio: 'hora', estado: 'estado', proyecto: 'proyecto', fija: 'fija' };
    const resumen = Object.keys(valor).filter((k) => NOMBRES[k]).map((k) => NOMBRES[k]).join(', ');
    const mensaje = `✏️ Actualicé «${objetivo.titulo}» (${resumen}): ${cuando(nuevo)}.`;
    return aplicarDirecto(ctx, [{ op: 'editar', id: objetivo.id, cambios: valor }], { mensaje, supuestos, avisos, tocadas: [objetivo] });
}

async function mover(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    const fechas = I.buscarFechas(texto, ctx.hoy);
    const destinoTxt = clas.fecha_destino ? I.resolverFecha(clas.fecha_destino, ctx.hoy) : null;
    const objetivoTxt = clas.fecha_objetivo ? I.resolverFecha(clas.fecha_objetivo, ctx.hoy) : null;
    let destino = forzado.destino ?? destinoTxt?.inicio ?? (fechas.length ? fechas.at(-1).inicio : null);
    let o;
    if (forzado.id) o = { tipo: 'unico', lista: ctx.actividades.filter((a) => a.id === forzado.id) };
    else o = await resolverObjetivos(ctx, texto, clas);

    // "mueve lo del jueves al viernes": sin actividad nombrada pero con dos fechas → todo lo movible de ese día
    if (o.lista.length === 0 && fechas.length >= 2) {
        const dia = objetivoTxt?.inicio ?? fechas[0].inicio;
        const lista = actividadesDelDia(ctx.actividades, dia).filter((a) => !esHito(a) && a.estado !== 'completado');
        o = { tipo: 'dia', lista };
    }
    if (o.lista.length === 0) return resp('respuesta', 'No encontré qué actividad mover. Dime su nombre, por ejemplo «mueve el taller al lunes».');
    if (o.tipo === 'varios' && !forzado.todas) {
        return aclarar(ctx, { intencion: 'mover', texto, clas, datos: { destino }, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: '¿Cuál quieres mover?', opciones: [...opcionesActividades(o.lista), { etiqueta: 'Todas', valor: 'todas' }] }] });
    }
    const unica = o.lista.length === 1 && o.tipo !== 'proyecto';

    if (!destino) {
        if (!unica) return aclarar(ctx, { intencion: 'mover', texto, clas, datos: { id: forzado.id }, preguntas: [preguntaFecha(ctx, 'destino', '¿A qué día las muevo?')] });
        // Sin destino: el planificador elige el mejor día de los próximos 7
        const a = o.lista[0];
        const { movimiento: m, avisos } = P.mejorDia({ actividades: ctx.actividades, id: a.id, hoy: ctx.hoy, capacidades: ctx.capacidades });
        if (!m) return resp('respuesta', `No encontré un día mejor para «${a.titulo}» en la próxima semana. ${avisos.join(' ')}`.trim());
        return aplicarDirecto(ctx, [{ op: 'editar', id: a.id, cambios: m.cambios }], { mensaje: `📅 ${m.motivo}`, supuestos, avisos, tocadas: [a] });
    }
    if (unica) {
        const a = o.lista[0];
        if (destino === a.fecha_inicio && !I.buscarHoras(texto)) return resp('respuesta', `«${a.titulo}» ya está el ${fechaLarga(destino)}.`);
        return aplicarParche(ctx, a, { fecha_inicio: destino }, texto, { supuestos, destino });
    }
    // Varias o un proyecto completo: se desplazan conservando sus duraciones → propuesta
    const inicio = o.lista.map((a) => a.fecha_inicio).sort()[0];
    const delta = diasEntre(inicio, destino);
    const movs = o.tipo === 'dia'
        ? o.lista.map((a) => P.desplazar({ actividades: [a], ids: [a.id], delta: diasEntre(a.fecha_inicio, destino) })[0])
        : P.desplazar({ actividades: o.lista, ids: o.lista.map((a) => a.id), delta });
    const titulo = o.tipo === 'proyecto' ? `Mover el proyecto «${o.proyecto}»` : `Mover ${movs.length} actividades`;
    return proponer(ctx, 'mover', { mover: movs.filter((m) => m && m.cambios.fecha_inicio !== m.de.fecha_inicio).slice(0, db.MAX_OPERACIONES), explicaciones: movs.map((m) => m.motivo), avisos: [] }, { titulo, supuestos });
}

async function liberar(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    const fechaTxt = clas.fecha_objetivo ? I.resolverFecha(clas.fecha_objetivo, ctx.hoy) : null;
    const fechas = I.buscarFechas(texto, ctx.hoy);
    const fecha = forzado.fecha ?? fechaTxt?.inicio ?? fechas[0]?.inicio ?? null;
    let modo = forzado.modo ?? I.modoLiberacion(texto);
    if (!modo) modo = clas.modo === 'eliminar' ? 'ambiguo' : 'aplazar';     // el modelo, por sí solo, nunca decide borrar
    const preguntas = [];
    if (!fecha) preguntas.push(preguntaFecha(ctx, 'fecha', '¿Qué día quieres liberar?'));
    if (modo === 'ambiguo') preguntas.push({ id: 'modo', tipo: 'modo', texto: '¿Aplazo esas actividades a otros días o las elimino?', opciones: [{ etiqueta: 'Aplazar (recomendado)', valor: 'aplazar' }, { etiqueta: 'Eliminar', valor: 'eliminar' }] });
    if (preguntas.length) return aclarar(ctx, { intencion: 'liberar_dia', texto, clas, datos: { fecha, modo: modo === 'ambiguo' ? null : modo }, preguntas });
    const hasta = fechas.length >= 2 && /\bhasta\b/.test(I.normalizarTexto(texto)) ? fechas.at(-1).inicio : null;
    const r = P.liberarDia({ actividades: ctx.actividades, fecha, hoy: ctx.hoy, capacidades: ctx.capacidades, modo, hasta });
    const titulo = modo === 'eliminar' ? `Eliminar lo del ${fechaLarga(fecha)}` : `Liberar el ${fechaLarga(fecha)}`;
    return proponer(ctx, 'liberar_dia', r, { titulo, supuestos });
}

async function reorganizarSemana(ctx, { texto, supuestos = [] }) {
    const rango = I.resolverRango(texto, ctx.hoy);
    const desde = rango ? rango.inicio : ctx.hoy;
    const hasta = rango && rango.fin > rango.inicio ? rango.fin : sumarDias(desde, 6);
    if (!rango) supuestos.push(`Reorganizo de hoy al ${fechaLarga(hasta)}.`);
    const r = P.reorganizar({ actividades: ctx.actividades, desde, hasta, hoy: ctx.hoy, capacidades: ctx.capacidades });
    return proponer(ctx, 'reorganizar', r, { titulo: 'Reorganizar tu semana', supuestos });
}

async function planificar(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    const fechaTxt = clas.fecha_objetivo ? I.resolverFecha(clas.fecha_objetivo, ctx.hoy) : null;
    const fechas = I.buscarFechas(texto, ctx.hoy).filter((f) => f.inicio > ctx.hoy);
    const fechaLimite = forzado.fecha_limite ?? fechaTxt?.inicio ?? fechas.at(-1)?.inicio ?? null;
    const dur = I.buscarDuracion(texto);
    const horasDia = forzado.horas_dia ?? (dur?.porDia ? dur.horas : null);
    const preguntas = [];
    if (!fechaLimite) {
        preguntas.push({ id: 'fecha_limite', tipo: 'fecha', texto: '¿Para cuándo es la entrega?', opciones: [
            { etiqueta: 'En 1 semana', valor: sumarDias(ctx.hoy, 7) }, { etiqueta: 'En 2 semanas', valor: sumarDias(ctx.hoy, 14) },
            { etiqueta: 'Fin de mes', valor: ultimoDiaMes(ctx.hoy) > sumarDias(ctx.hoy, 2) ? ultimoDiaMes(ctx.hoy) : ultimoDiaMes(sumarDias(ultimoDiaMes(ctx.hoy), 1)) }
        ] });
    }
    if (!horasDia) preguntas.push({ id: 'horas_dia', tipo: 'horas', texto: '¿Cuántas horas al día puedes dedicarle?', opciones: [{ etiqueta: '1 h', valor: '1' }, { etiqueta: '2 h', valor: '2' }, { etiqueta: '3 h', valor: '3' }] });
    if (preguntas.length && !forzado.resuelto) return aclarar(ctx, { intencion: 'planificar_proyecto', texto, clas, datos: { fecha_limite: fechaLimite, horas_dia: horasDia }, preguntas });

    const limite = fechaLimite ?? sumarDias(ctx.hoy, 14);
    const hDia = Number(horasDia) || 2;
    const desglose = await ia.desglosarProyecto({ texto, horasDia: hDia, diasDisponibles: Math.max(1, diasEntre(ctx.hoy, limite) - 1) });
    const nombre = limpiarTextoVisible(proyectoMencionado(ctx, texto, clas) || clas.proyecto || desglose.proyecto || 'Proyecto', 60);
    const horario = I.buscarHoras(texto);
    const r = P.planificarProyecto({
        actividades: ctx.actividades, tareas: desglose.tareas, nombre, fechaLimite: limite, horasDia: hDia, hoy: ctx.hoy,
        capacidades: ctx.capacidades, horario: horario?.hora_fin && !horario.cruzaMedianoche ? horario : null
    });
    return proponer(ctx, 'planificar_proyecto', r, { titulo: `Plan del proyecto «${nombre}»`, supuestos });
}

async function eliminar(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    let o;
    if (forzado.id && forzado.id !== 'todas') o = { tipo: 'unico', lista: ctx.actividades.filter((a) => a.id === forzado.id) };
    else o = await resolverObjetivos(ctx, texto, clas);
    if (o.lista.length === 0) {
        if (I.buscarFechas(texto, ctx.hoy).length) return liberar(ctx, { texto, clas: { ...clas, modo: 'eliminar' }, forzado, supuestos });
        return resp('respuesta', 'No encontré esa actividad en tu agenda. ¿Cómo se llama?');
    }
    if (o.tipo === 'varios' && forzado.id !== 'todas') {
        return aclarar(ctx, { intencion: 'eliminar', texto, clas, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: '¿Cuál quieres eliminar?', opciones: [...opcionesActividades(o.lista), { etiqueta: 'Todas', valor: 'todas' }] }] });
    }
    const lista = o.lista.slice(0, db.MAX_OPERACIONES);
    const titulo = o.tipo === 'proyecto' ? `Eliminar el proyecto «${o.proyecto}»` : lista.length === 1 ? `Eliminar «${lista[0].titulo}»` : `Eliminar ${lista.length} actividades`;
    return proponer(ctx, 'eliminar', {
        eliminar: lista.map((a) => ({ id: a.id, titulo: a.titulo, detalle: cuando(a), motivo: 'Va a la papelera: podrás restaurarla.' })),
        explicaciones: esHito(lista[0]) && lista.length === 1 ? [`«${lista[0].titulo}» es un hito; asegúrate de que ya no lo necesitas.`] : [], avisos: []
    }, { titulo, supuestos });
}

async function restaurar(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    const t = I.normalizarTexto(texto);
    const f = I.resolverRango(texto, ctx.hoy, { preferirPasado: true });
    const desde = f ? inicioDiaLocal(f.inicio, ctx.tzOffset) : null;
    const hasta = f ? inicioDiaLocal(sumarDias(f.fin, 1), ctx.tzOffset) : null;
    let papelera = await db.buscarEnPapeleraBD(ctx.userId, { desde, hasta });
    const ref = (clas.referencia || texto).replace(/lo que borr[eé]|la tarea de|las tareas de|recupera|restaura/gi, ' ');
    let candidatos = palabras(ref).length ? coincidencias(papelera, ref).map((x) => x.a) : papelera;
    if (forzado.id && forzado.id !== 'todas') candidatos = papelera.filter((a) => a.id === forzado.id);
    if (candidatos.length === 0) {
        return resp('respuesta', `No encontré nada así en la papelera${f ? ` borrado ${f.texto}` : ''}. Las actividades eliminadas se guardan ${db.diasPapelera()} días; puedes verlas con el botón 🗑 Papelera.`);
    }
    // "todo": lo pide explícitamente, o da un rango de borrado ("lo que borré ayer") sin nombrar nada concreto
    const todo = forzado.id === 'todas' || /\b(todo|todas|todos)\b/.test(t) || (Boolean(f) && !palabras(ref).length);
    if (candidatos.length > 1 && !todo) {
        return aclarar(ctx, { intencion: 'restaurar', texto, clas, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: `Encontré ${candidatos.length} en la papelera. ¿Cuál restauro?`, opciones: [...opcionesActividades(candidatos), { etiqueta: 'Todas', valor: 'todas' }] }] });
    }
    const lista = candidatos.slice(0, db.MAX_OPERACIONES);
    const avisos = [];
    let acumulado = [...ctx.actividades];
    for (const a of lista) {
        acumulado.push(normalizarActividad({ ...a, eliminadaEn: null }));
        const saturado = rangoFechas(a.fecha_inicio, a.fecha_fin, 62).map((d) => ({ d, antes: cargaDelDia(ctx.actividades, d, ctx.capacidades[d] ?? 100).porcentaje, despues: cargaDelDia(acumulado, d, ctx.capacidades[d] ?? 100).porcentaje }))
            .find((x) => x.despues > UMBRAL_ROJO);
        if (saturado) avisos.push(`El ${fechaCorta(saturado.d)} ${saturado.antes > UMBRAL_ROJO ? 'ya estaba saturado' : 'se satura'}: al restaurar «${a.titulo}» queda en ${saturado.despues} %.`);
    }
    if (lista.length === 1) {
        const a = lista[0];
        return aplicarDirecto(ctx, [{ op: 'restaurar', id: a.id }], { mensaje: `♻️ Restauré «${a.titulo}» (${cuando(a)}).`, supuestos, avisos, tocadas: [a] });
    }
    return proponer(ctx, 'restaurar', { explicaciones: [], avisos }, {
        titulo: `Restaurar ${lista.length} actividades`, supuestos, papelera,
        restaurar: lista.map((a) => ({ id: a.id, titulo: a.titulo, detalle: cuando(a), motivo: `Borrada el ${fechaCorta(new Date(a.eliminadaEn).toISOString().slice(0, 10))}` }))
    });
}

async function preguntarOcharla(ctx, { texto, clas }) {
    let dias = [];
    if (clas.intencion === 'preguntar') {
        const r = I.resolverRango(texto, ctx.hoy);
        const desde = r?.inicio ?? ctx.hoy;
        const hasta = r?.fin ?? (/\bsemana\b/.test(I.normalizarTexto(texto)) ? sumarDias(ctx.hoy, 6) : desde);
        dias = rangoFechas(desde, hasta, 14).map((d) => {
            const c = cargaDelDia(ctx.actividades, d, ctx.capacidades[d] ?? 100);
            return { fecha: fechaLarga(d), carga: c.porcentaje, actividades: actividadesDelDia(ctx.actividades, d).slice(0, 12).map((a) => `${a.titulo}${a.hora_inicio ? ` ${a.hora_inicio}${a.hora_fin ? `–${a.hora_fin}` : ''}` : ` ${a.horas} h`}${a.estado === 'completado' ? ' (hecha)' : ''}`) };
        });
    }
    const respaldo = () => {
        if (!dias.length) return '¡Hola! Puedo agendar, mover, liberar días, planificar proyectos o recuperar lo que borraste. Prueba «libera mi viernes».';
        return dias.map((d) => `${d.fecha}: ${d.actividades.length ? d.actividades.join(', ') : 'nada agendado'} (carga ${d.carga} %)`).join('. ');
    };
    try {
        const { respuesta } = await ia.redactarRespuesta({ datos: { pregunta: texto, dias } });
        return resp('respuesta', respuesta);
    } catch (e) {
        if (e instanceof ia.ErrorIA && e.tipo === 'formato') return resp('respuesta', respaldo());
        throw e;
    }
}

const MANEJADORES = {
    crear, editar, mover, liberar_dia: liberar, reorganizar: reorganizarSemana, planificar_proyecto: planificar,
    eliminar, restaurar,
    importar: async () => resp('respuesta', 'Para importar, adjunta el archivo con el botón 📎 o arrástralo al chat (PDF, DOCX, TXT, MD, CSV o ICS). Te mostraré lo que encuentre para que elijas qué añadir.'),
    preguntar: preguntarOcharla, charla: preguntarOcharla
};

// ====================================================================== aclaraciones
function interpretarRespuesta(pregunta, valorBoton, texto, ctx) {
    if (valorBoton) return valorBoton;
    if (!texto) return null;
    switch (pregunta.tipo) {
        case 'fecha': return I.resolverFecha(texto, ctx.hoy)?.inicio ?? null;
        case 'modo': { const m = I.modoLiberacion(texto); return m === 'ambiguo' ? 'eliminar' : m; }
        case 'horas': { const d = I.buscarDuracion(texto); const n = /^\s*(\d+(?:[.,]\d)?)\s*$/.exec(texto); return d ? String(d.horas) : n ? n[1].replace(',', '.') : null; }
        case 'confirmar': return I.esAfirmacion(texto) ? 'si' : I.esNegacion(texto) ? 'no' : null;
        case 'objetivo': {
            if (/\b(todas|todos|todo)\b/i.test(texto)) return 'todas';
            const c = coincidencias(pregunta.opciones.map((o) => ({ id: o.valor, titulo: o.etiqueta })), texto);
            return c.length ? c[0].a.id : null;
        }
        default: return null;
    }
}

const POR_DEFECTO = {
    fecha: (ctx) => ({ valor: ctx.hoy, supuesto: 'Supuse que te referías a hoy.' }),
    fecha_limite: (ctx) => ({ valor: sumarDias(ctx.hoy, 14), supuesto: `Supuse una fecha límite en 2 semanas (${fechaLarga(sumarDias(ctx.hoy, 14))}).` }),
    destino: (ctx) => ({ valor: sumarDias(ctx.hoy, 1), supuesto: 'Supuse que las querías para mañana.' }),
    modo: () => ({ valor: 'aplazar', supuesto: 'Como no lo confirmaste, las aplazo en lugar de eliminarlas.' }),
    horas_dia: () => ({ valor: '2', supuesto: 'Supuse 2 h al día.' }),
    confirmar: () => ({ valor: 'no', supuesto: 'Como no lo confirmaste, no la creé.' }),
    objetivo: (ctx, p) => ({ valor: p.opciones[0]?.valor, supuesto: `Supuse que era «${p.opciones[0]?.etiqueta}».` })
};

async function reanudarAclaracion(ctx, acl, entrada) {
    const reclamada = await db.reclamarPropuestaBD(ctx.userId, acl.id);
    if (!reclamada) return resp('respuesta', 'Esa pregunta ya caducó. Repíteme lo que necesitas.');
    const { intencion, texto, clas, datos = {}, preguntas = [] } = reclamada.estado ?? {};
    const supuestos = [...(datos.supuestos ?? [])];
    const forzado = { ...datos };
    let entendidas = 0;
    for (const p of preguntas) {
        let v = interpretarRespuesta(p, entrada.respuestas?.[p.id], entrada.texto, ctx);
        if (v) entendidas++;
        if (!v) { const d = POR_DEFECTO[p.id]?.(ctx, p) ?? POR_DEFECTO[p.tipo]?.(ctx, p); v = d?.valor; if (d?.supuesto) supuestos.push(d.supuesto); }
        forzado[p.id] = v;
    }
    // Texto largo que no responde a nada: es una petición nueva (la aclaración se descarta)
    if (entendidas === 0 && entrada.texto && entrada.texto.length > 25 && !Object.keys(entrada.respuestas ?? {}).length) return null;
    if (forzado.objetivo) { forzado.id = forzado.objetivo; if (forzado.objetivo === 'todas') forzado.todas = true; }
    if (intencion === 'crear') {
        if (forzado.confirmar !== 'si') return resp('respuesta', 'De acuerdo, no la creé.', { supuestos });
        return crear(ctx, { texto, clas, forzado: { actividades: datos.actividades, confirmado: true }, supuestos });
    }
    if (intencion === 'planificar_proyecto') {
        forzado.horas_dia = Number(forzado.horas_dia) || 2;
        forzado.resuelto = true;
    }
    return MANEJADORES[intencion](ctx, { texto, clas, forzado, supuestos });
}

// ====================================================================== punto de entrada
export async function procesarChat(usuario, entrada) {
    const ctx = await cargarContexto(usuario, entrada);
    if (entrada.aclaracionId) {
        const acl = await db.obtenerPropuestaBD(usuario.id, entrada.aclaracionId);
        if (acl?.tipo === 'aclaracion') {
            const r = await reanudarAclaracion(ctx, acl, entrada);
            if (r) return r;
        } else if (!entrada.texto) return resp('respuesta', 'Esa pregunta ya caducó. Repíteme lo que necesitas.');
    }
    const texto = entrada.texto;
    // Confirmaciones y deshacer: deterministas, sin LLM. Un "sí" sin propuesta pendiente no ejecuta nada.
    if (I.esAfirmacion(texto)) {
        if (entrada.propuestaPendiente) return aplicarPropuesta(usuario.id, entrada.propuestaPendiente, { hoy: ctx.hoy });
        return resp('respuesta', 'No hay ningún cambio pendiente de confirmar, así que no hice nada. ¿Qué necesitas?');
    }
    if (I.esNegacion(texto)) {
        if (entrada.propuestaPendiente && await db.cancelarPropuestaBD(usuario.id, entrada.propuestaPendiente)) {
            return resp('cancelada', 'Listo, no cambié nada.', { propuestaId: entrada.propuestaPendiente });
        }
        return resp('respuesta', 'Entendido. No hay nada pendiente.');
    }
    if (I.pideDeshacer(texto)) return deshacerUltimo(usuario.id);

    const clas = await ia.clasificar({ texto, hoy: ctx.hoy, actividades: contextoCompacto(ctx), proyectos: ctx.proyectos, historial: ctx.historial });
    clas.intencion = corregirIntencion(clas.intencion, texto);
    return MANEJADORES[clas.intencion](ctx, { texto, clas });
}

// ====================================================================== aplicar / cancelar / deshacer
export async function aplicarPropuesta(userId, id, { seleccion = null } = {}) {
    const previa = await db.obtenerPropuestaBD(userId, id);
    if (!previa || previa.tipo === 'aclaracion') throw new ErrorChat(410, 'Esa propuesta ya no está disponible (caducó a los 10 minutos, ya se aplicó o no existe). Pídemelo de nuevo.');
    let operaciones = previa.operaciones?.lista ?? [];
    if (previa.seleccionable) {
        // Sin selección explícita (p. ej. un "sí" escrito) se usan las casillas marcadas por defecto
        const porDefecto = (previa.presentacion?.items ?? []).filter((it) => it.marcado).map((it) => it.idx);
        const sel = new Set((Array.isArray(seleccion) ? seleccion : porDefecto).filter((n) => Number.isInteger(n) && n >= 0 && n < operaciones.length));
        operaciones = operaciones.filter((_, i) => sel.has(i));
        if (operaciones.length === 0) throw new ErrorChat(400, 'Marca al menos un elemento para añadir.');
    }
    const loteId = db.nuevoId();
    let resultado, degradado;
    try {
        ({ resultado, degradado } = await db.conTransaccion(async (session) => {
            const reclamada = await db.reclamarPropuestaBD(userId, id, session);
            if (!reclamada) throw new db.ErrorDatos('usada', 'Esa propuesta ya se aplicó o caducó.', 410);
            return db.aplicarCambiosBD(userId, operaciones, { session, origen: 'ia', loteId });
        }));
    } catch (e) {
        if (!db.transaccionesDisponibles()) {        // sin transacciones: compensar lo que alcanzó a escribirse
            await db.deshacerLoteBD(userId, loteId).catch(() => {});
            if (!(e instanceof db.ErrorDatos && e.codigo === 'usada')) await db.liberarPropuestaBD(userId, id).catch(() => {});
        }
        throw e;
    }
    const avisos = degradado ? ['Tu MongoDB no admite transacciones (servidor independiente): los cambios se aplicaron uno a uno, sin atomicidad.'] : [];
    return resp('aplicado', `Listo: apliqué ${resultado.total} ${resultado.total === 1 ? 'cambio' : 'cambios'}.`, {
        loteId: resultado.loteId, propuestaId: id, avisos, actividades: await db.obtenerActividadesBD(userId)
    });
}

export async function deshacerLote(userId, loteId) {
    const { resultado: n, degradado } = await db.conTransaccion((session) => db.deshacerLoteBD(userId, loteId, session));
    if (!n) throw new ErrorChat(404, 'No hay nada que deshacer (o ya se deshizo).');
    return resp('deshecho', `↩️ Deshice ${n} ${n === 1 ? 'cambio' : 'cambios'}.`, {
        avisos: degradado ? ['Sin transacciones: se revirtió cambio a cambio.'] : [], actividades: await db.obtenerActividadesBD(userId)
    });
}

async function deshacerUltimo(userId) {
    const loteId = await db.ultimoLoteBD(userId);
    if (!loteId) return resp('respuesta', 'No hay ningún cambio reciente de la IA que deshacer.');
    return deshacerLote(userId, loteId);
}

// ====================================================================== archivos
const EXIG_CATEGORIA = { examen: 3, entrega: 3, clase: 1, evento: 1, otro: 1 };

/**
 * Archivo → candidatos → SIEMPRE propuesta con casillas (nunca se aplica solo). El texto extraído no sale del
 * servidor: el cliente solo recibe la propuesta y devuelve los índices elegidos.
 */
export async function procesarArchivo(usuario, { nombre, buffer, fechaHoy, tzOffset, instruccion = '', vision = false }) {
    const ctx = await cargarContexto(usuario, { fechaHoy, tzOffset, historial: [] });
    const tipo = detectarTipo(nombre, buffer, { vision });
    const avisos = [];
    let candidatos = [];
    let texto = '';
    if (tipo.tipo === 'ics') {
        const r = parsearICS(buffer.toString('utf8'), { tzOffset });
        avisos.push(...r.avisos);
        candidatos = r.eventos.map((e) => ({ ...e, verificada: true }));
    } else if (tipo.tipo === 'imagen') {
        const r = await ia.interpretarImagen({ imagen: { mime: tipo.mime, base64: buffer.toString('base64') }, hoy: ctx.hoy, instruccion });
        candidatos = r.candidatos.map((c) => ({ ...c, verificada: false }));
        avisos.push('Leí una imagen: revisa bien las fechas, el modelo de visión puede equivocarse.');
    } else {
        const ext = await extraerTexto(tipo, buffer);
        texto = ext.texto;
        if (!texto.trim()) throw new ErrorArchivo('No encontré texto en el archivo (¿es un PDF escaneado?).', 422);
        if (ext.truncado) avisos.push(`El documento es largo: analicé solo el principio (${ext.paginas ? `hasta ${Math.min(ext.paginas, 30)} páginas, ` : ''}${texto.length} caracteres).`);
        for (const fragmento of fragmentar(texto)) {
            const r = await ia.interpretarDocumento({ textoDocumento: fragmento, hoy: ctx.hoy, instruccion });
            candidatos.push(...r.candidatos.map((c) => ({ ...c, verificada: citaVerificada(c.cita, fragmento) })));
        }
    }
    // Fechas en código; se descartan candidatos sin fecha válida y duplicados
    const vistos = new Set();
    const crearLista = [];
    let sinFecha = 0;
    for (const c of candidatos) {
        let ini = c.fecha_inicio, fin = c.fecha_fin;
        if (!ini) { const f = esISO(c.fecha) ? { inicio: c.fecha, fin: c.fecha } : I.resolverRango(c.fecha ?? '', ctx.hoy); ini = f?.inicio; fin = f?.fin; }
        if (!ini || !esISO(ini)) { sinFecha++; continue; }
        if (ini < sumarDias(ctx.hoy, -7)) continue;
        const clave = `${I.normalizarTexto(c.titulo)}|${ini}|${c.hora_inicio ?? ''}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        const categoria = c.categoria ?? categoriaDe(c.titulo);
        let horas = c.horas ?? 1;
        let horaFin = c.hora_fin;
        if (c.hora_inicio && c.hora_fin && c.hora_fin > c.hora_inicio) horas = Math.min(12, Math.max(0.5, Math.round(((Number(c.hora_fin.slice(0, 2)) * 60 + Number(c.hora_fin.slice(3))) - (Number(c.hora_inicio.slice(0, 2)) * 60 + Number(c.hora_inicio.slice(3)))) / 30) / 2));
        else horaFin = null;
        const datos = normalizarActividadIA({
            titulo: c.titulo, tipo: /reuni|turno|trabajo/i.test(c.titulo) ? 'trabajo' : 'estudio', exigencia: EXIG_CATEGORIA[categoria],
            horas, fecha_inicio: ini, fecha_fin: fin && fin >= ini ? fin : ini, hora_inicio: c.hora_inicio ?? null, hora_fin: horaFin, estado: 'pendiente', proyecto: ''
        }, ctx.hoy);
        const { valor, error } = datos ? validarActividad(datos) : { error: 'x' };
        if (error) continue;
        if (categoria === 'examen' || categoria === 'entrega') valor.fija = true;
        crearLista.push({
            datos: valor, motivo: c.cita ? `«${c.cita}»` : 'Encontrado en el archivo', cita: c.cita || null,
            detalle: `${cuando(valor)} · ${categoria}`, marcado: c.verificada !== false,
            aviso: c.verificada === false && tipo.tipo !== 'imagen' ? 'No encontré esta cita literal en el documento: revísala.' : null,
            categoria
        });
    }
    if (sinFecha) avisos.push(`${sinFecha} elemento(s) no tenían una fecha clara y los omití.`);
    // Bloques de preparación (planificador de C) para entregas y exámenes futuros; desmarcados por defecto
    const preparaciones = [];
    for (const c of crearLista.filter((x) => (x.categoria === 'examen' || x.categoria === 'entrega') && x.datos.fecha_inicio > sumarDias(ctx.hoy, 1)).slice(0, 5)) {
        const r = P.planificarProyecto({
            actividades: [...ctx.actividades, ...crearLista.map((x, i) => ({ ...x.datos, id: `imp-${i}` }))],
            tareas: [{ titulo: `Preparar: ${c.datos.titulo}`.slice(0, 100), tipo: 'estudio', exigencia: 2, horas: 3, orden: 1, hito: false }],
            nombre: c.datos.proyecto || '', fechaLimite: c.datos.fecha_inicio, horasDia: 1.5, hoy: ctx.hoy, capacidades: ctx.capacidades,
            desde: sumarDias(c.datos.fecha_inicio, -4)          // los días previos a la entrega/examen, no desde hoy
        });
        for (const b of r.crear) preparaciones.push({ ...b, datos: { ...b.datos, proyecto: '' }, marcado: false, motivo: `Preparación sugerida para «${c.datos.titulo}» (opcional).` });
    }
    const todos = [...crearLista, ...preparaciones];
    if (todos.length > db.MAX_OPERACIONES) { avisos.push(`Encontré ${todos.length} elementos; muestro los primeros ${db.MAX_OPERACIONES}.`); todos.length = db.MAX_OPERACIONES; }
    if (todos.length === 0) return resp('respuesta', `No encontré fechas, exámenes ni entregas en «${limpiarTextoVisible(nombre, 80)}». ${avisos.join(' ')}`.trim(), { avisos });
    return proponer(ctx, 'importar', { crear: todos, explicaciones: [`Encontré ${crearLista.length} ${crearLista.length === 1 ? 'evento' : 'eventos'} en «${limpiarTextoVisible(nombre, 80)}». Marca lo que quieras añadir.`], avisos }, { titulo: 'Importar del archivo', seleccionable: true });
}
