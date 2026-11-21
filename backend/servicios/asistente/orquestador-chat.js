// Orquestación de POST /api/ia/chat (y de la carga de archivos).
// Flujo: el LLM SOLO clasifica y extrae → validación con esquema estricto → lógica determinista (fechas,
// cargas, planificador) → respuesta: aplicado (con Deshacer) | propuesta (Aplicar/Cancelar) | aclaración | respuesta.
// Nada que venga del modelo se escribe sin pasar por aquí. Las reglas del Prompt Maestro se hacen cumplir AQUÍ en
// código (el modelo 3B puede saltárselas): correcciones → editar/eliminar, nunca crear; hora sin decir →
// aclaración con 2-3 horarios libres (requiere_confirmacion); liberar un día → TODAS sus actividades; urgencia por
// vencimiento; documentos → se añaden solos (con Deshacer); avisos de sobrecarga en una oración con «Ojo:».
import * as ia from './cliente-ollama.js';
import * as db from '../../datos/index.js';
import * as I from './interprete-lenguaje.js';
import * as P from './planificador.js';
import { normalizarActividadIA, normalizarParcheIA, validarActividad, limpiarTextoVisible } from '../../validacion/index.js';
import { ErrorConEstado } from '../../errores.js';
import { normalizarActividad, actividadesDelDia, cargaDelDia, capacidadDe, diasSaturados, esHito, esEntregaOExamen, UMBRAL_ROJO } from '../../../compartido/carga.js';
import { ahoraDelUsuario } from '../tiempo.js';
import { NOMBRE_IA_PREDETERMINADO } from './prompts.js';
import { NOMBRE_EXIGENCIA } from '../../../compartido/catalogos.js';
import { sumarDias, fechaLarga, fechaCorta, rangoFechas, inicioDiaLocal, diasEntre, ultimoDiaMes, esISO, textoCuando as cuando, textoHorario, aMinutos, sumarMinutos } from '../../../compartido/fechas.js';
import { detectarTipo, extraerTexto, fragmentar, citaVerificada, ErrorArchivo } from '../archivos/lector-documentos.js';
import { parsearICS, categoriaDe } from '../archivos/lector-ics.js';
import * as E from '../estudio/asistente-estudio.js';

export class ErrorChat extends ErrorConEstado {
    constructor(estado, mensaje) { super(mensaje, estado); }
}

const VENTANA_CONTEXTO = 14;
/** Preguntas sobre la propia app: las responde el redactor con lo que sabe de LearnTrack, no el tutor */
const SOBRE_LA_APP = /\b(learntrack|la app|la aplicacion|el asistente|mi agenda|mi calendario|mi panel|la carga|la papelera|mi carga)\b/;
const MAX_CONTEXTO = 40;
const exigenciaTxt = (e) => (NOMBRE_EXIGENCIA[e] ?? String(e)).toLowerCase();
const resp = (tipo, mensaje, extra = {}) => ({ tipo, mensaje, ...extra });

// ====================================================================== contexto
async function cargarContexto(usuario, entrada) {
    const hoy = entrada.fechaHoy;
    const [actividades, proyectos, checkins] = await Promise.all([
        db.obtenerActividadesBD(usuario.id),
        db.obtenerProyectosBD(usuario.id),
        db.obtenerCheckinsBD(usuario.id, sumarDias(hoy, -31), sumarDias(hoy, 120))
    ]);
    const capacidades = Object.fromEntries(checkins.map((c) => [c.fecha, capacidadDe(c)]));
    // El nombre del proyecto solo se acepta si pertenece a la cuenta autenticada.
    const contexto = entrada.contexto ? {
        seccion: entrada.contexto.seccion,
        proyecto: entrada.contexto.seccion === 'proyectos' && proyectos.includes(entrada.contexto.proyecto)
            ? entrada.contexto.proyecto : '',
        tema: entrada.contexto.seccion === 'estudio'
            ? (actividades.find((a) => a.tipo === 'estudio' && a.titulo === entrada.contexto.tema)?.titulo ?? '') : '',
        objetivoId: ''
    } : null;
    // v3.12: tema de Estudio (objetivo de aprendizaje) abierto en pantalla, solo si es de esta cuenta
    if (contexto?.seccion === 'estudio' && entrada.contexto.objetivoId) {
        const objetivo = await db.obtenerObjetivoBD(usuario.id, entrada.contexto.objetivoId);
        if (objetivo) { contexto.objetivoId = objetivo.id; contexto.tema = objetivo.tema; }
    }
    // Identidad para el Prompt Maestro: nombre, fecha/hora local y contexto de pantalla verificado.
    const ahora = ahoraDelUsuario({ fechaHoy: hoy, horaLocal: entrada.horaLocal, zona: entrada.zona });
    return {
        userId: usuario.id, hoy, horaActual: ahora.hora, tzOffset: entrada.tzOffset ?? 0, historial: entrada.historial ?? [],
        actividades, proyectos, capacidades, identidad: { nombreIA: usuario.nombreIA, ahora, contexto }
    };
}

/** Actividades relevantes para el modelo: ventana ±14 días, máx. 40, campos completos pero compactos */
function contextoCompacto(ctx) {
    const desde = sumarDias(ctx.hoy, -VENTANA_CONTEXTO), hasta = sumarDias(ctx.hoy, VENTANA_CONTEXTO);
    const contexto = ctx.identidad.contexto;
    return ctx.actividades
        .filter((a) => (a.fecha_inicio <= hasta && a.fecha_fin >= desde)
            || (contexto?.seccion === 'proyectos' && contexto.proyecto && a.proyecto === contexto.proyecto)
            || (contexto?.seccion === 'estudio' && a.tipo === 'estudio'))
        .sort((x, y) => Math.abs(diasEntre(ctx.hoy, x.fecha_inicio)) - Math.abs(diasEntre(ctx.hoy, y.fecha_inicio)))
        .slice(0, MAX_CONTEXTO)
        .map((a) => {
            const c = { id: a.id, t: a.titulo, tipo: a.tipo, ex: a.exigencia, h: a.horas, fi: a.fecha_inicio };
            if (a.fecha_fin !== a.fecha_inicio) c.ff = a.fecha_fin;
            if (a.hora_inicio) c.hi = a.hora_inicio;
            if (a.hora_fin) c.hf = a.hora_fin;
            c.est = a.estado;
            if (a.proyecto) c.proy = a.proyecto;
            if (a.fecha_vencimiento) c.vencimiento = a.fecha_vencimiento;
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

/** Año completo como alcance («las tareas de 2027»); null si el año es parte de una fecha («2 de enero de 2028») */
const rangoAnual = (texto) => I.alcanceAnual(texto);

function alcanceAnualMasivo(texto) {
    const t = I.normalizarTexto(texto);
    return Boolean(rangoAnual(texto) && /\b(todas?|todos?|actividades|tareas|agenda)\b/.test(t));
}

/** Correcciones deterministas cuando la intención es inequívoca por el texto (el modelo 3B a veces falla) */
function corregirIntencion(intencion, texto, hoy) {
    const t = I.normalizarTexto(texto);
    const anual = rangoAnual(texto);
    // Creación: solo con una señal inequívoca (verbo de crear, o «tengo/juego…» + evento concreto + fecha u hora) y
    // nunca si la frase pide eliminar, liberar, mover o consultar. «agenda», «tengo» o «tareas» solos no bastan.
    if (I.esPeticionDeCreacion(texto, hoy)) return 'crear';
    if (/\b(organiza(me)?|reorganiza|balancea|equilibra|distribuye|tengo demasiad|estoy saturad|ordena(me)? (la|mi) semana)\b/.test(t) && !/\bproyecto\b/.test(t)) return 'reorganizar';
    if (/\b(recupera|restaura|restablece|devuelve(me)? lo que borre)\b/.test(t)) return 'restaurar';
    if (anual && alcanceAnualMasivo(texto) && /\b(aplaza|aplazar|pospone|posponer|reprograma|reprogramar|mueve|mover|traslada|trasladar)\b/.test(t)) return 'mover';
    if (anual && /\b(libera|despeja|vacia|desocupa)\b/.test(t) && /\b(agenda|actividades|tareas)\b/.test(t)
        && !/\b(elimina|eliminar|borra|borrar|quita|quitar|cancela|cancelar|aplaza|aplazar|pospone|posponer|mueve|mover)\b/.test(t)) return 'gestionar_anio';
    if (/\b(libera|despeja|vacia|desocupa)\b.*\b(dia|agenda|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\b(hoy|manana) no (puedo|voy a poder)\b/.test(t)) return 'liberar_dia';
    if (/\b(elimina|eliminar|borra|borrar|quita|quitar|cancela|cancelar)\b.*\btodo (lo )?(del?|de este|de la)\b/.test(t)) return 'liberar_dia';
    if (/\b(tengo que|debo|necesito) (hacer|entregar|terminar|preparar)\b.*\bproyecto\b|\bproyecto\b.*\bpara el\b/.test(t) && intencion !== 'mover' && intencion !== 'eliminar') return 'planificar_proyecto';
    if (/\b(elimina|eliminar|borra|borrar|quita|quitar|cancela|cancelar)\b/.test(t) && anual) return 'eliminar';
    if (anual && /\b(actividades|actividad|tareas|tarea|agenda|ver|muestra|mostrar|consulta|consultar|tengo)\b/.test(t)) return 'preguntar';
    if (/\b(importa|importar|carga(r)? (un|mi) (archivo|horario|calendario|pdf|documento))\b/.test(t)) return 'importar';
    return intencion;
}

// ====================================================================== cargas y presentación
function cargasDe(ctx, antes, despues, actsTocadas) {
    const dias = P.diasDe(actsTocadas).filter((d) => d >= sumarDias(ctx.hoy, -1));
    return P.cargasAntesDespues(antes, despues, dias.length ? dias : P.diasDe(actsTocadas), ctx.capacidades);
}


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
    for (const c of r.crear ?? []) c.datos.fecha_asignacion ??= ctx.hoy;
    for (const c of r.crear ?? []) agregar({ op: 'crear', datos: c.datos }, { op: 'crear', titulo: c.datos.titulo, detalle: c.detalle ?? cuando(normalizarActividad(c.datos)), motivo: c.motivo, marcado: c.marcado !== false, cita: c.cita ?? null, aviso: c.aviso ?? null });
    for (const m of r.mover ?? []) agregar({ op: 'editar', id: m.id, cambios: m.cambios }, { op: 'mover', titulo: m.titulo, detalle: m.detalle, motivo: m.motivo, marcado: m.marcado !== false, aviso: m.aviso ?? null });
    for (const e of editar) agregar({ op: 'editar', id: e.id, cambios: e.cambios }, { op: 'editar', titulo: e.titulo, detalle: e.detalle, motivo: e.motivo, marcado: true });
    for (const e of r.eliminar ?? []) agregar({ op: 'eliminar', id: e.id }, { op: 'eliminar', titulo: e.titulo, detalle: e.detalle, motivo: e.motivo, marcado: e.marcado !== false, aviso: e.aviso ?? null });
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
    // requiere_confirmacion: el asistente no actúa hasta que el usuario elija (regla 4 del Prompt Maestro)
    return resp('aclaracion', lista.map((p) => p.texto).join(' '), { requiere_confirmacion: true, aclaracion: { id: doc.id, preguntas: lista, expira: doc.expira } });
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
    // «Crea 2 actividades para [fecha]» especifica la cantidad, pero no el contenido.
    // No dejes que el modelo invente dos títulos ni consultes el calendario como sustituto.
    const textoNorm = I.normalizarTexto(texto);
    const cantidadGenerica = /\b(?:crea|crear|agrega|agregar|anade|anadir|agenda|agendar|programa|programar)\s+(\d+)\s+(?:actividades|tareas)\b/.exec(textoNorm);
    const mencionaDetalles = /\b(partido|reunion|cita|parcial|examen|entrega|clase|entrenamiento|evento|estudiar|estudio|practicar|practica|hacer|preparar|leer|trabajar|consulta|concierto)\b/.test(textoNorm);
    if (!forzado.actividades && cantidadGenerica && !mencionaDetalles) {
        const fechaSolicitada = I.resolverFecha(texto, ctx.hoy)?.inicio;
        const paraFecha = fechaSolicitada ? ` para el ${fechaLarga(fechaSolicitada)}` : '';
        return resp('respuesta', `Puedo crear ${cantidadGenerica[1]} actividades${paraFecha}. ¿Qué nombres y horarios quieres asignarles? No he creado ni modificado nada.`);
    }
    let crudas = forzado.actividades;
    if (!crudas) {
        const ext = await ia.extraerCrear({ texto, hoy: ctx.hoy, historial: ctx.historial, identidad: ctx.identidad });
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
            // Fecha límite: la decide el código («para el viernes», «se entrega el 20»), no el modelo
            if (!forzado.actividades) c.fecha_vencimiento = I.buscarVencimiento(texto, ctx.hoy);
        } else if (!forzado.actividades) {
            c.fecha_vencimiento = null;
        }
        c.estado = completado ? 'completado' : (c.estado === 'en_proceso' && /\b(estoy|empece|empezando|en proceso)\b/.test(I.normalizarTexto(texto)) ? 'en_proceso' : 'pendiente');
        const n = normalizarActividadIA(c, ctx.hoy, { cansancio });
        const { error, valor } = n ? validarActividad(n) : { error: 'sin título' };
        if (error) { avisos.push(`Descarté la actividad ${i + 1}: ${error}`); continue; }
        // Un examen o una entrega vence el mismo día en que ocurre
        if (!valor.fecha_vencimiento && esEntregaOExamen(valor)) valor.fecha_vencimiento = valor.fecha_fin;
        valor.fecha_asignacion = forzado.actividades?.[i]?.fecha_asignacion ?? ctx.hoy;
        listas.push(valor);
    }
    if (!listas.length) return resp('respuesta', `No pude interpretar bien la actividad. ${avisos.join(' ')}`.trim());

    if (listas.length === 1) {
        const a = listas[0];
        // HORARIO AMBIGUO: sin hora no se inventa una; se ofrecen 2-3 horarios libres (requiere_confirmacion)
        if (!forzado.actividades && !a.hora_inicio && a.estado !== 'completado' && a.fecha_inicio === a.fecha_fin
            && a.fecha_inicio >= ctx.hoy && !I.sinHoraAProposito(texto)) {
            const sugeridas = P.horariosLibres({ actividades: ctx.actividades, fecha: a.fecha_inicio, horas: a.horas, hoy: ctx.hoy, horaActual: ctx.horaActual });
            if (sugeridas.length) {
                const enumerar = sugeridas.length > 1 ? `${sugeridas.slice(0, -1).join(', ')} o ${sugeridas.at(-1)}` : sugeridas[0];
                return aclarar(ctx, {
                    intencion: 'crear', texto, clas, datos: { actividades: [a], supuestos },
                    preguntas: [{
                        id: 'hora', tipo: 'hora',
                        texto: `¿A qué hora pongo «${a.titulo}» el ${fechaLarga(a.fecha_inicio)}? Tienes libre a las ${enumerar}.`,
                        opciones: [...sugeridas.map((h) => ({ etiqueta: h, valor: h })), { etiqueta: 'Sin hora fija', valor: 'sin_hora' }]
                    }]
                });
            }
        }
        const choque = a.hora_inicio && rangoFechas(a.fecha_inicio, a.fecha_fin, 62).map((d) => actividadesDelDia(ctx.actividades, d)
            .find((o) => P.seSolapa([o], { ...a, id: '__nuevo__' }, d))).find(Boolean);
        if (choque && !forzado.confirmado) {
            return aclarar(ctx, {
                intencion: 'crear', texto, clas, datos: { actividades: [a], supuestos },
                preguntas: [{ id: 'confirmar', tipo: 'confirmar', texto: `«${a.titulo}» se cruza con «${choque.titulo}» (${textoHorario(choque)}). ¿La creo igual?`, opciones: [{ etiqueta: 'Crear igual', valor: 'si' }, { etiqueta: 'No crear', valor: 'no' }] }]
            });
        }
        const despues = [...ctx.actividades, { ...a, id: '__nuevo__' }];
        const altos = diasSaturados(despues, a, ctx.capacidades);
        if (altos.length) avisos.push(`Ojo: ${altos.map((c) => `el ${fechaCorta(c.fecha)} queda en ${c.porcentaje} %`).join(', ')}. Considera descansar o aplazar algo.`);
        const mensaje = `✅ Agendé «${a.titulo}» — ${cuando(a)} · Exigencia ${exigenciaTxt(a.exigencia)}${a.fecha_vencimiento ? ` · vence el ${fechaCorta(a.fecha_vencimiento)}` : ''}${a.estado === 'completado' ? ' · completada' : ''}.`;
        return aplicarDirecto(ctx, [{ op: 'crear', datos: a }], { mensaje, supuestos, avisos, tocadas: [{ ...a, id: '__nuevo__' }] });
    }
    return proponer(ctx, 'crear', { crear: listas.map((a) => ({ datos: a, detalle: `${cuando(a)} · exigencia ${exigenciaTxt(a.exigencia)}`, motivo: 'Nueva actividad' })), explicaciones: [], avisos }, { titulo: `Crear ${listas.length} actividades`, supuestos });
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
    const { cambios } = await ia.extraerEdicion({ texto, hoy: ctx.hoy, actual: registroCompleto(objetivo), identidad: ctx.identidad });
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
    const [saturado] = diasSaturados(despues, nuevo, ctx.capacidades);
    if (saturado) avisos.push(`Ojo: el ${fechaCorta(saturado.fecha)} queda en ${saturado.porcentaje} %.`);
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
    const anual = alcanceAnualMasivo(texto);
    let o;
    if (forzado.id) o = { tipo: 'unico', lista: ctx.actividades.filter((a) => a.id === forzado.id) };
    else if (anual) {
        const r = rangoAnual(texto);
        o = { tipo: 'varios', lista: ctx.actividades.filter((a) => a.fecha_inicio <= r.fin && a.fecha_fin >= r.inicio) };
    } else o = await resolverObjetivos(ctx, texto, clas);
    if (anual && o.lista.length > db.MAX_OPERACIONES) return resp('respuesta', `Encontré ${o.lista.length} actividades en ${rangoAnual(texto).anio}, pero puedo proponer como máximo ${db.MAX_OPERACIONES} cambios por operación. No moví ninguna.`);
    if (anual && o.lista.length === 0) return resp('respuesta', `No encontré actividades en ${rangoAnual(texto).anio}. No moví nada.`);

    // "mueve lo del jueves al viernes": sin actividad nombrada pero con dos fechas → todo lo movible de ese día
    if (o.lista.length === 0 && fechas.length >= 2) {
        const dia = objetivoTxt?.inicio ?? fechas[0].inicio;
        const lista = actividadesDelDia(ctx.actividades, dia).filter((a) => !esHito(a) && a.estado !== 'completado');
        o = { tipo: 'dia', lista };
    }
    if (o.lista.length === 0) return resp('respuesta', 'No encontré qué actividad mover. Dime su nombre, por ejemplo «mueve el taller al lunes».');
    if (o.tipo === 'varios' && !forzado.todas && !anual) {
        return aclarar(ctx, { intencion: 'mover', texto, clas, datos: { destino }, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: '¿Cuál quieres mover?', opciones: [...opcionesActividades(o.lista), { etiqueta: 'Todas', valor: 'todas' }] }] });
    }
    const unica = o.lista.length === 1 && o.tipo !== 'proyecto';

    if (!destino) {
        if (!unica) return aclarar(ctx, { intencion: 'mover', texto, clas, datos: { id: forzado.id }, preguntas: [preguntaFecha(ctx, 'destino', anual ? `¿A qué fecha quieres trasladar el conjunto de actividades de ${rangoAnual(texto).anio}?` : '¿A qué día las muevo?')] });
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
    // Modo EXPLÍCITO: lo dice la frase sin contar «libera/despeja» («aplázalo», «borra definitivamente», «elimina»).
    // «Libera mi día» a secas no lo dice: si ya hay que preguntar el día, se pregunta también (aplazar recomendado);
    // si no hay nada más que preguntar, se aplaza (la propuesta igualmente se confirma antes de aplicar).
    const explicito = I.modoLiberacion(texto.replace(/\b(libera\w*|despeja\w*|vacia\w*|desocupa\w*)\b/gi, ' '));
    let modo = forzado.modo ?? explicito ?? (clas.modo === 'eliminar' ? 'ambiguo' : null);   // el modelo, por sí solo, nunca decide borrar
    const preguntas = [];
    if (!fecha) preguntas.push(preguntaFecha(ctx, 'fecha', '¿Qué día quieres liberar?'));
    if (!modo) modo = preguntas.length ? 'ambiguo' : 'aplazar';
    if (modo === 'ambiguo') preguntas.push({ id: 'modo', tipo: 'modo', texto: '¿Aplazo esas actividades a otros días o las elimino?', opciones: [{ etiqueta: 'Aplazar (recomendado)', valor: 'aplazar' }, { etiqueta: 'Eliminar', valor: 'eliminar' }] });
    if (preguntas.length) return aclarar(ctx, { intencion: 'liberar_dia', texto, clas, datos: { fecha, modo: modo === 'ambiguo' ? null : modo }, preguntas });
    const hasta = fechas.length >= 2 && /\bhasta\b/.test(I.normalizarTexto(texto)) ? fechas.at(-1).inicio : null;
    const r = P.liberarDia({ actividades: ctx.actividades, fecha, hoy: ctx.hoy, capacidades: ctx.capacidades, modo, hasta });
    const titulo = modo === 'eliminar' ? `Eliminar lo del ${fechaLarga(fecha)}` : `Liberar el ${fechaLarga(fecha)}`;
    // Con casillas: TODA la jornada aparece; los exámenes y entregas llegan desmarcados
    return proponer(ctx, 'liberar_dia', r, { titulo, supuestos, seleccionable: [...r.mover, ...r.eliminar].some((x) => x.marcado === false) });
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
    const desglose = await ia.desglosarProyecto({ texto, horasDia: hDia, diasDisponibles: Math.max(1, diasEntre(ctx.hoy, limite) - 1), identidad: ctx.identidad });
    const nombre = limpiarTextoVisible(proyectoMencionado(ctx, texto, clas) || clas.proyecto || desglose.proyecto || 'Proyecto', 60);
    const horario = I.buscarHoras(texto);
    const r = P.planificarProyecto({
        actividades: ctx.actividades, tareas: desglose.tareas, nombre, fechaLimite: limite, horasDia: hDia, hoy: ctx.hoy,
        capacidades: ctx.capacidades, horario: horario?.hora_fin && !horario.cruzaMedianoche ? horario : null
    });
    // Cada subtarea vence, como tarde, en la fecha límite del proyecto (así la urgencia y la limpieza la respetan)
    for (const c of r.crear) c.datos.fecha_vencimiento ??= limite;
    return proponer(ctx, 'planificar_proyecto', r, { titulo: `Plan del proyecto «${nombre}»`, supuestos });
}

async function planificarEstudio(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    const temaSolicitado = limpiarTextoVisible(clas.referencia, 100);
    if (!temaSolicitado || ['estudio', 'estudios', 'aprender', 'estudiar', 'tema'].includes(I.normalizarTexto(temaSolicitado))) {
        return resp('respuesta', '¡Claro! ¿Qué tema, tecnología o habilidad quieres aprender? Con eso puedo organizar tus sesiones.');
    }
    const fechaTxt = clas.fecha_objetivo ? I.resolverFecha(clas.fecha_objetivo, ctx.hoy) : null;
    const fechas = I.buscarFechas(texto, ctx.hoy).filter((f) => f.inicio > ctx.hoy);
    const fechaLimite = forzado.fecha_limite ?? fechaTxt?.inicio ?? fechas.at(-1)?.inicio ?? null;
    const dur = I.buscarDuracion(texto);
    const horasDia = forzado.horas_dia ?? (dur?.porDia ? dur.horas : null);
    const preguntas = [];
    if (!fechaLimite) {
        preguntas.push({ id: 'fecha_limite', tipo: 'fecha', texto: '¿Para cuándo quieres aprender o dominar este tema?', opciones: [
            { etiqueta: 'En 1 semana', valor: sumarDias(ctx.hoy, 7) },
            { etiqueta: 'En 2 semanas', valor: sumarDias(ctx.hoy, 14) },
            { etiqueta: 'En 1 mes', valor: sumarDias(ctx.hoy, 30) }
        ] });
    }
    if (!horasDia) preguntas.push({ id: 'horas_dia', tipo: 'horas', texto: '¿Cuánto tiempo al día puedes dedicar al estudio?', opciones: [
        { etiqueta: '30 min', valor: '0.5' }, { etiqueta: '1 h', valor: '1' }, { etiqueta: '2 h', valor: '2' }
    ] });
    if (preguntas.length && !forzado.resuelto) {
        return aclarar(ctx, { intencion: 'planificar_estudio', texto, clas, datos: { fecha_limite: fechaLimite, horas_dia: horasDia }, preguntas });
    }

    const limite = fechaLimite ?? sumarDias(ctx.hoy, 14);
    const hDia = Number(horasDia) || 1;
    const desglose = await ia.desglosarProyecto({
        texto: `Plan de estudio y aprendizaje: ${texto}`,
        horasDia: hDia,
        diasDisponibles: Math.max(1, diasEntre(ctx.hoy, limite) - 1),
        identidad: ctx.identidad
    });
    const nombre = limpiarTextoVisible(temaSolicitado || desglose.proyecto || 'Plan de estudio', 60);
    const r = P.planificarProyecto({
        actividades: ctx.actividades,
        // En un plan de estudio la fecha límite es el objetivo («dominar React para el día X»), no una entrega que
        // haya que agendar ESE día: los hitos del desglose se convierten en sesiones normales antes de la fecha.
        tareas: desglose.tareas.map((t) => ({ ...t, tipo: 'estudio', hito: false })),
        nombre,
        fechaLimite: limite,
        horasDia: hDia,
        hoy: ctx.hoy,
        capacidades: ctx.capacidades
    });
    for (const c of r.crear) c.datos.fecha_vencimiento ??= limite;
    // v3.12: el tema queda en Estudio como SUGERENCIA (aceptar / posponer / descartar). Si se aplica el plan, pasa a
    // «en curso» (ver aplicarPropuesta); si ya estaba en Estudio, las sesiones se vinculan a ese objetivo.
    const horasPlan = r.crear.reduce((t, c) => t + Number(c.datos.horas || 0), 0);
    const registro = await db.registrarSugerenciaBD(ctx.userId, {
        tema: nombre, origen: 'chat', fechaLimite: limite > ctx.hoy ? limite : null, horasEstimadas: Math.min(200, Math.max(0.5, horasPlan || 4)),
        motivo: `Lo pediste en el chat: «${limpiarTextoVisible(texto, 140)}».`
    }, { explicita: true });
    if (registro?.objetivo) for (const c of r.crear) c.datos.objetivoId = registro.objetivo.id;
    return proponer(ctx, 'planificar_proyecto', r, {
        titulo: `Plan de estudio «${nombre}»`,
        supuestos: [...supuestos, `Distribuí las sesiones antes del ${fechaCorta(limite)} según tu agenda y el tiempo diario indicado.`]
    });
}

async function eliminar(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    let o;
    const anual = rangoAnual(texto);
    if (forzado.id && forzado.id !== 'todas') o = { tipo: 'unico', lista: ctx.actividades.filter((a) => a.id === forzado.id) };
    else if (anual && /\b(todo|todas|todos|actividades|tareas|agenda)\b/.test(I.normalizarTexto(texto))) {
        const listaAnual = ctx.actividades.filter((a) => a.fecha_inicio <= anual.fin && a.fecha_fin >= anual.inicio);
        o = { tipo: 'varios', lista: listaAnual };
    } else o = await resolverObjetivos(ctx, texto, clas);
    if (o.lista.length === 0) {
        if (anual) return resp('respuesta', `No encontré actividades programadas entre el 1 de enero y el 31 de diciembre de ${anual.anio}. No eliminé nada.`);
        if (I.buscarFechas(texto, ctx.hoy).length) return liberar(ctx, { texto, clas: { ...clas, modo: 'eliminar' }, forzado, supuestos });
        return resp('respuesta', 'No encontré esa actividad en tu agenda. ¿Cómo se llama?');
    }
    if (o.tipo === 'varios' && forzado.id !== 'todas' && !anual) {
        return aclarar(ctx, { intencion: 'eliminar', texto, clas, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: '¿Cuál quieres eliminar?', opciones: [...opcionesActividades(o.lista), { etiqueta: 'Todas', valor: 'todas' }] }] });
    }
    if (anual && o.lista.length > db.MAX_OPERACIONES) {
        return resp('respuesta', `Encontré ${o.lista.length} actividades en ${anual.anio}, pero una operación admite como máximo ${db.MAX_OPERACIONES}. No eliminé ninguna. Puedes pedirme que revise un mes concreto para hacerlo por partes.`);
    }
    const lista = o.lista.slice(0, db.MAX_OPERACIONES);
    const titulo = o.tipo === 'proyecto' ? `Eliminar el proyecto «${o.proyecto}»` : lista.length === 1 ? `Eliminar «${lista[0].titulo}»` : `Eliminar ${lista.length} actividades`;
    return proponer(ctx, 'eliminar', {
        eliminar: lista.map((a) => ({ id: a.id, titulo: a.titulo, detalle: cuando(a), motivo: 'Va a la papelera: podrás restaurarla.' })),
        explicaciones: esHito(lista[0]) && lista.length === 1 ? [`«${lista[0].titulo}» es un hito; asegúrate de que ya no lo necesitas.`] : [], avisos: []
    }, { titulo, supuestos });
}

async function gestionarAnio(ctx, { texto, clas, forzado = {}, supuestos = [] }) {
    // «Liberar la agenda de un año» no determina por sí solo si se desea aplazar o eliminar.
    const modo = forzado.modo;
    if (modo !== 'eliminar' && modo !== 'aplazar') {
        const anio = rangoAnual(texto)?.anio;
        return aclarar(ctx, {
            intencion: 'gestionar_anio', texto, clas, datos: {},
            preguntas: [{ id: 'modo', tipo: 'modo_anual', texto: `Cuando dices liberar tu agenda de ${anio}, ¿quieres eliminar esas actividades o trasladarlas a otra fecha?`, opciones: [
                { etiqueta: 'Trasladar (recomendado)', valor: 'aplazar' },
                { etiqueta: 'Eliminar', valor: 'eliminar' }
            ] }]
        });
    }
    return modo === 'eliminar'
        ? eliminar(ctx, { texto: texto.replace(/\b(libera|despeja|vacia|desocupa)\b/ig, 'elimina'), clas, forzado, supuestos })
        : mover(ctx, { texto: texto.replace(/\b(libera|despeja|vacia|desocupa)\b/ig, 'aplaza todas'), clas, forzado, supuestos });
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
        const [saturado] = diasSaturados(acumulado, a, ctx.capacidades);
        if (saturado) {
            const antes = cargaDelDia(ctx.actividades, saturado.fecha, ctx.capacidades[saturado.fecha]).porcentaje;
            avisos.push(`Ojo: el ${fechaCorta(saturado.fecha)} ${antes > UMBRAL_ROJO ? 'ya estaba saturado' : 'se satura'} y con «${a.titulo}» queda en ${saturado.porcentaje} %.`);
        }
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
    const anual = rangoAnual(texto);
    if (clas.intencion === 'preguntar' && anual && /\b(actividades|actividad|tareas|tarea|agenda|ver|muestra|mostrar|consulta|consultar|tengo)\b/.test(I.normalizarTexto(texto))) {
        const lista = ctx.actividades.filter((a) => a.fecha_inicio <= anual.fin && a.fecha_fin >= anual.inicio)
            .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
        if (!lista.length) return resp('respuesta', `No encontré actividades entre el 1 de enero y el 31 de diciembre de ${anual.anio}. Consulté tu agenda y no hice cambios.`);
        const lineas = lista.slice(0, 50).map((a) => `• ${a.titulo}: ${a.fecha_inicio}${a.fecha_fin !== a.fecha_inicio ? ` a ${a.fecha_fin}` : ''}${a.estado === 'completado' ? ' (completada)' : ''}`);
        const extra = lista.length > 50 ? `\nMostrando las primeras 50 de ${lista.length} actividades.` : '';
        return resp('respuesta', `Encontré ${lista.length} actividades en tu agenda para ${anual.anio}:\n${lineas.join('\n')}${extra}`);
    }
    let dias = [];
    if (clas.intencion === 'preguntar') {
        const r = I.resolverRango(texto, ctx.hoy);
        const desde = r?.inicio ?? ctx.hoy;
        const hasta = r?.fin ?? (/\bsemana\b/.test(I.normalizarTexto(texto)) ? sumarDias(ctx.hoy, 6) : desde);
        dias = rangoFechas(desde, hasta, 14).map((d) => {
            const c = cargaDelDia(ctx.actividades, d, ctx.capacidades[d]);
            return { fecha: fechaLarga(d), carga: c.porcentaje, actividades: actividadesDelDia(ctx.actividades, d).slice(0, 12).map((a) => `${a.titulo}${a.hora_inicio ? ` ${textoHorario(a)}` : ` ${a.horas} h`}${a.estado === 'completado' ? ' (hecha)' : ''}`) };
        });
    }
    const respaldo = () => {
        if (!dias.length) {
            const nombre = ctx.identidad?.nombreIA || NOMBRE_IA_PREDETERMINADO;
            return `¡Hola! Soy ${nombre}${nombre === NOMBRE_IA_PREDETERMINADO ? ' (puedes cambiarme el nombre en Configuración › Voz de la IA)' : ''}. Puedo agendar, mover, liberar días, planificar proyectos o recuperar lo que borraste. Prueba «libera mi viernes».`;
        }
        return dias.map((d) => `${d.fecha}: ${d.actividades.length ? d.actividades.join(', ') : 'nada agendado'} (carga ${d.carga} %)`).join('. ');
    };
    try {
        const { respuesta } = await ia.redactarRespuesta({ datos: { pregunta: texto, dias }, identidad: ctx.identidad });
        return resp('respuesta', respuesta);
    } catch (e) {
        if (e instanceof ia.ErrorIA && e.tipo === 'formato') return resp('respuesta', respaldo());
        throw e;
    }
}

const MANEJADORES = {
    crear, editar, mover, liberar_dia: liberar, reorganizar: reorganizarSemana, planificar_proyecto: planificar, planificar_estudio: planificarEstudio,
    eliminar, restaurar, gestionar_anio: gestionarAnio,
    importar: async () => resp('respuesta', 'Para importar, adjunta el archivo con el botón 📎 o arrástralo al chat (PDF, DOCX, TXT, MD, CSV o ICS). Te mostraré lo que encuentre para que elijas qué añadir.'),
    preguntar: preguntarOcharla, charla: preguntarOcharla
};

// ====================================================================== aclaraciones
function interpretarRespuesta(pregunta, valorBoton, texto, ctx) {
    if (valorBoton) return valorBoton;
    if (!texto) return null;
    switch (pregunta.tipo) {
        case 'fecha': return I.resolverFecha(texto, ctx.hoy)?.inicio ?? null;
        // Respondiendo a «¿Aplazo o elimino?», «elimínalas» SÍ es una respuesta (eliminar). «nada», «no sé»… no lo son.
        case 'modo':
        case 'modo_anual': {
            if (/\btrasladar?\w*\b/.test(I.normalizarTexto(texto))) return 'aplazar';
            const m = I.modoLiberacion(texto);
            return m === 'ambiguo' ? 'eliminar' : m;
        }
        case 'horas': { const d = I.buscarDuracion(texto); const n = /^\s*(\d+(?:[.,]\d)?)\s*$/.exec(texto); return d ? String(d.horas) : n ? n[1].replace(',', '.') : null; }
        case 'confirmar': return I.esAfirmacion(texto) ? 'si' : I.esNegacion(texto) ? 'no' : null;
        case 'hora': {
            if (/\b(sin hora|ninguna|cualquiera|da igual|todo el dia)\b/.test(I.normalizarTexto(texto))) return 'sin_hora';
            return I.buscarHoras(texto)?.hora_inicio ?? (/^\s*([01]?\d|2[0-3]):[0-5]\d\s*$/.test(texto) ? texto.trim().padStart(5, '0') : null);
        }
        case 'objetivo': {
            if (/\b(todas|todos|todo)\b/i.test(texto)) return 'todas';
            const c = coincidencias(pregunta.opciones.map((o) => ({ id: o.valor, titulo: o.etiqueta })), texto);
            return c.length ? c[0].a.id : null;
        }
        default: return null;
    }
}

/**
 * Valores por defecto: SOLO cuando la persona delega («Decide tú», o los botones sin texto). Nunca destructivos:
 * el modo por defecto es aplazar y «confirmar» por defecto es no. Cada uno se anuncia como supuesto.
 */
const POR_DEFECTO = {
    fecha: (ctx) => ({ valor: ctx.hoy, supuesto: 'Supuse que te referías a hoy.' }),
    fecha_limite: (ctx) => ({ valor: sumarDias(ctx.hoy, 14), supuesto: `Supuse una fecha límite en 2 semanas (${fechaLarga(sumarDias(ctx.hoy, 14))}).` }),
    destino: (ctx) => ({ valor: sumarDias(ctx.hoy, 1), supuesto: 'Supuse que las querías para mañana.' }),
    modo: () => ({ valor: 'aplazar', supuesto: 'Como no lo confirmaste, las aplazo en lugar de eliminarlas.' }),
    modo_anual: () => ({ valor: 'aplazar', supuesto: 'Como no lo confirmaste, las traslado en lugar de eliminarlas.' }),
    horas_dia: () => ({ valor: '2', supuesto: 'Supuse 2 h al día.' }),
    confirmar: () => ({ valor: 'no', supuesto: 'Como no lo confirmaste, no la creé.' }),
    hora: () => ({ valor: 'sin_hora', supuesto: 'Como no elegiste hora, la dejé sin hora fija.' }),
    objetivo: (ctx, p) => ({ valor: p.opciones[0]?.valor, supuesto: `Supuse que era «${p.opciones[0]?.etiqueta}».` })
};

async function reanudarAclaracion(ctx, acl, entrada) {
    const reclamada = await db.reclamarPropuestaBD(ctx.userId, acl.id);
    if (!reclamada) return resp('respuesta', 'Esa pregunta ya caducó. Repíteme lo que necesitas.');
    const { intencion, texto, clas, datos = {}, preguntas = [] } = reclamada.estado ?? {};
    const supuestos = [...(datos.supuestos ?? [])];
    // Los valores resueltos en una ronda anterior se conservan; nunca rellenamos automáticamente
    // campos críticos (fecha, objetivo o modo) cuando la respuesta actual es ambigua.
    const forzado = { ...datos };
    const pendientes = [];
    let entendidas = 0;
    for (const p of preguntas) {
        const v = interpretarRespuesta(p, entrada.respuestas?.[p.id], entrada.texto, ctx);
        if (v !== null && v !== undefined && v !== '') {
            entendidas++;
            forzado[p.id] = v;
        } else {
            pendientes.push(p);
        }
    }
    if (pendientes.length) {
        // «Decide tú» (botón: sin texto) o una delegación escrita: valores por defecto razonables y NO destructivos
        const delega = !String(entrada.texto ?? '').trim() || I.delegaDecision(entrada.texto);
        if (delega) {
            for (const p of pendientes) {
                const d = POR_DEFECTO[p.id]?.(ctx, p) ?? POR_DEFECTO[p.tipo]?.(ctx, p);
                if (d?.valor !== undefined) { forzado[p.id] = d.valor; if (d.supuesto) supuestos.push(d.supuesto); }
            }
        } else {
            // Texto largo que no responde a nada: es una petición nueva (la aclaración se descarta y decide el clasificador)
            if (entendidas === 0 && !Object.keys(entrada.respuestas ?? {}).length && entrada.texto.length > 25) return null;
            // Respuesta parcial o ambigua («nada»): se conserva lo ya respondido y se pregunta SOLO lo pendiente
            return aclarar(ctx, { intencion, texto, clas, datos: { ...forzado, supuestos }, preguntas: pendientes });
        }
    }
    if (forzado.objetivo) { forzado.id = forzado.objetivo; if (forzado.objetivo === 'todas') forzado.todas = true; }
    if (intencion === 'crear') {
        const ids = new Set(preguntas.map((p) => p.id));
        if (ids.has('confirmar') && forzado.confirmar !== 'si') return resp('respuesta', 'De acuerdo, no la creé.', { supuestos });
        let actividades = datos.actividades;
        if (ids.has('hora') && forzado.hora && forzado.hora !== 'sin_hora') {
            actividades = actividades.map((a) => {
                const fin = aMinutos(forzado.hora) + Math.round(Number(a.horas) * 60);
                return { ...a, hora_inicio: forzado.hora, hora_fin: fin < 24 * 60 ? sumarMinutos(forzado.hora, Number(a.horas) * 60) : null };
            });
        }
        return crear(ctx, { texto, clas, forzado: { actividades, confirmado: ids.has('confirmar') }, supuestos });
    }
    if (intencion === 'planificar_proyecto' || intencion === 'planificar_estudio') {
        forzado.horas_dia = Number(forzado.horas_dia) || 2;
        forzado.resuelto = true;
    }
    return MANEJADORES[intencion](ctx, { texto, clas, forzado, supuestos });
}

// ====================================================================== correcciones
/**
 * «No, era a las 5», «perdón, es el jueves», «no, cancélala»: corrige la ÚLTIMA acción del asistente
 * (últimos 30 min). NUNCA crea una actividad nueva: edita (parche) o elimina lo que acaba de hacer.
 * Devuelve null si no hay una acción reciente a la que aplicarla (entonces decide el clasificador, sin «crear»).
 */
async function corregirUltima(ctx, texto, tipo) {
    const ultima = await db.ultimaAccionIABD(ctx.userId, { minutos: 30 });
    if (!ultima) return null;
    const ids = [...new Set(ultima.operaciones.filter((o) => o.tipo === 'crear' || o.tipo === 'editar').map((o) => o.actividadId))];
    const objetivos = ctx.actividades.filter((a) => ids.includes(a.id));
    if (objetivos.length === 0) return null;
    if (tipo === 'eliminar') {
        // Si lo último fue CREARLAS, deshacer ese lote las quita sin dejar rastro; si no, van a la papelera
        if (ultima.operaciones.every((o) => o.tipo === 'crear')) {
            const r = await deshacerLote(ctx.userId, ultima.loteId);
            return { ...r, mensaje: `🗑 Listo, quité ${objetivos.length === 1 ? `«${objetivos[0].titulo}»` : `${objetivos.length} actividades`}: no queda nada nuevo en tu agenda.` };
        }
        return aplicarDirecto(ctx, objetivos.map((a) => ({ op: 'eliminar', id: a.id })), {
            mensaje: `🗑 Mandé ${objetivos.length === 1 ? `«${objetivos[0].titulo}»` : `${objetivos.length} actividades`} a la papelera (puedes restaurarla).`, tocadas: objetivos
        });
    }
    let objetivo = objetivos[0];
    if (objetivos.length > 1) {
        const c = coincidencias(objetivos, texto);
        if (c.length === 1 || (c.length > 1 && c[0].puntos > c[1].puntos)) objetivo = c[0].a;
        else return aclarar(ctx, { intencion: 'editar', texto, clas: { referencia: '' }, preguntas: [{ id: 'objetivo', tipo: 'objetivo', texto: '¿Cuál de las que acabo de hacer corrijo?', opciones: opcionesActividades(objetivos) }] });
    }
    const { cambios } = await ia.extraerEdicion({ texto, hoy: ctx.hoy, actual: registroCompleto(objetivo), identidad: ctx.identidad });
    const r = await aplicarParche(ctx, objetivo, cambios, texto);
    if (r.tipo === 'respuesta' && /No vi ningún cambio/.test(r.mensaje)) {
        return resp('respuesta', `¿Qué corrijo de «${objetivo.titulo}»? Dime, por ejemplo, «a las 5», «el jueves» o «son 2 horas».`);
    }
    return r.tipo === 'aplicado' ? { ...r, mensaje: r.mensaje.replace(/^✏️ Actualicé/, '✏️ Corregido:'), correccion: true } : r;
}

// ====================================================================== punto de entrada
export async function procesarChat(usuario, entrada) {
    const ctx = await cargarContexto(usuario, entrada);
    // Una petición NUEVA de creación («el 2 de enero tengo un partido de 10 a 12») no se consume como respuesta a una
    // aclaración anterior, aunque contenga una fecha que encajaría en ella. Los botones de respuesta no llevan texto.
    if (entrada.aclaracionId && entrada.texto && I.esPeticionDeCreacion(entrada.texto, ctx.hoy)) entrada = { ...entrada, aclaracionId: undefined };
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

    // Corrección de lo último que hizo el asistente: editar/eliminar, nunca crear
    const correccion = I.tipoCorreccion(texto);
    if (correccion) {
        const r = await corregirUltima(ctx, texto, correccion);
        if (r) return r;
    }

    // v3.12 · Estudio (deterministas, antes de clasificar): temas que pide el proyecto abierto, plan de sesiones de
    // estudio, DIFICULTAD de aprendizaje explícita («no entiendo…», «me cuesta…») y peticiones de explicación.
    // Una pregunta informativa («¿qué es una API REST?») se explica, pero NO se convierte en un tema de estudio.
    const contexto = ctx.identidad.contexto ?? { seccion: 'general' };
    const esAgenda = I.esPeticionDeCreacion(texto, ctx.hoy);
    if (contexto.seccion === 'proyectos' && contexto.proyecto && I.pideTemasProyecto(texto)) return E.sugerirTemasDeProyecto(ctx, contexto.proyecto);
    if (!esAgenda && I.pidePlanEstudio(texto)) {
        const plan = await E.planDesdeChat(ctx, texto);
        if (plan) return plan;
    }
    const necesidad = esAgenda ? null : I.necesidadAprendizaje(texto, ctx.hoy);
    if (necesidad?.tipo === 'dificultad') return E.sugerirDesdeChat(ctx, necesidad, { texto, contexto });
    if (!necesidad && !esAgenda && I.pideExplicacion(texto) && !SOBRE_LA_APP.test(I.normalizarTexto(texto))) {
        const explicacion = await E.explicar(ctx, texto, contexto);
        if (explicacion) return resp('respuesta', explicacion);
    }

    const ultima = await db.ultimaAccionIABD(ctx.userId, { minutos: 30 });
    const ultimaAccion = (ultima?.operaciones ?? []).map((o) => ctx.actividades.find((a) => a.id === o.actividadId)).filter(Boolean)
        .slice(0, 5).map((a) => ({ id: a.id, t: a.titulo }));
    const clas = await ia.clasificar({ texto, hoy: ctx.hoy, actividades: contextoCompacto(ctx), proyectos: ctx.proyectos, historial: ctx.historial, ultimaAccion, identidad: ctx.identidad });
    clas.intencion = corregirIntencion(clas.intencion, texto, ctx.hoy);
    if (correccion && clas.intencion === 'crear') clas.intencion = correccion === 'eliminar' ? 'eliminar' : 'editar';
    // «Quiero/necesito aprender X (antes del …)»: es un plan de estudio, y el TEMA lo fija el código, no el modelo
    if (necesidad?.tipo === 'deseo') {
        clas.intencion = 'planificar_estudio';
        clas.referencia = necesidad.tema;
    }
    // En Estudio y Proyectos la conversación libre la lleva el tutor, con el contexto de esa sección
    if (clas.intencion === 'charla' && (contexto.seccion === 'estudio' || contexto.seccion === 'proyectos')) {
        const explicacion = await E.explicar(ctx, texto, contexto);
        if (explicacion) return resp('respuesta', explicacion);
    }
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
    // v3.12: aplicar un plan de estudio ACEPTA su tema (pasa de «sugerido» a «en curso» en Estudio)
    for (const objetivoId of new Set(operaciones.filter((o) => o.op === 'crear' && o.datos?.objetivoId).map((o) => o.datos.objetivoId))) {
        const objetivo = await db.obtenerObjetivoBD(userId, objetivoId);
        if (objetivo && ['sugerido', 'pendiente'].includes(objetivo.estado)) await db.actualizarObjetivoBD(userId, objetivoId, { estado: 'en_curso', posponerHasta: null });
    }
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

/** «es del proyecto Tesis», «son de la materia Redes»: nombre de proyecto para todo lo importado (o '') */
function proyectoDeInstruccion(instruccion) {
    const m = /\b(?:proyecto|materia|asignatura|curso|clase de)\s*:?\s*[«"']?([\p{L}\p{N}][\p{L}\p{N} ._-]{1,39})/u.exec(instruccion ?? '');
    return m ? limpiarTextoVisible(m[1].replace(/[»"'.,;]+$/, '').trim(), 60) : '';
}

/**
 * Archivo + mensaje del usuario → candidatos → se AÑADEN SOLOS al calendario (regla 7 del Prompt Maestro) los
 * fiables: con cita literal comprobada en el texto, de un .ics o leídos de una imagen (con aviso). Todo se aplica
 * como UN lote con «Deshacer». Lo dudoso (cita no encontrada) y los bloques de preparación opcionales quedan en
 * una propuesta con casillas (`siguiente`). El texto extraído no sale del servidor.
 */
export async function procesarArchivo(usuario, { nombre, buffer, fechaHoy, tzOffset, instruccion = '', vision = false, zona, horaLocal, contexto = null }) {
    const ctx = await cargarContexto(usuario, { fechaHoy, tzOffset, historial: [], zona, horaLocal, contexto });
    const tipo = detectarTipo(nombre, buffer, { vision });
    const avisos = [];
    let candidatos = [];
    let temasEstudio = [];
    let texto = '';
    if (tipo.tipo === 'ics') {
        const r = parsearICS(buffer.toString('utf8'), { tzOffset });
        avisos.push(...r.avisos);
        candidatos = r.eventos.map((e) => ({ ...e, verificada: true }));
    } else if (tipo.tipo === 'imagen') {
        const r = await ia.interpretarImagen({ imagen: { mime: tipo.mime, base64: buffer.toString('base64') }, hoy: ctx.hoy, instruccion, identidad: ctx.identidad });
        candidatos = r.candidatos.map((c) => ({ ...c, verificada: false }));
        temasEstudio = (r.temasEstudio ?? []).map((t) => ({ ...t, verificada: false }));
        avisos.push('Leí una imagen: revisa bien las fechas, el modelo de visión puede equivocarse.');
    } else {
        const ext = await extraerTexto(tipo, buffer);
        texto = ext.texto;
        if (!texto.trim()) throw new ErrorArchivo('No encontré texto en el archivo (¿es un PDF escaneado?).', 422);
        if (ext.truncado) avisos.push(`El documento es largo: analicé solo el principio (${ext.paginas ? `hasta ${Math.min(ext.paginas, 30)} páginas, ` : ''}${texto.length} caracteres).`);
        for (const fragmento of fragmentar(texto)) {
            const r = await ia.interpretarDocumento({ textoDocumento: fragmento, hoy: ctx.hoy, instruccion, identidad: ctx.identidad });
            candidatos.push(...r.candidatos.map((c) => ({ ...c, verificada: citaVerificada(c.cita, fragmento) })));
            temasEstudio.push(...(r.temasEstudio ?? []).map((t) => ({ ...t, verificada: citaVerificada(t.cita, fragmento) })));
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
    // El mensaje que escribió el usuario junto al archivo puede decir a qué proyecto/materia pertenece
    const proyecto = proyectoDeInstruccion(instruccion);
    if (proyecto) for (const x of crearLista) x.datos.proyecto = proyecto;
    for (const x of crearLista) {
        x.datos.fecha_asignacion = ctx.hoy;
        if (x.categoria === 'examen' || x.categoria === 'entrega') x.datos.fecha_vencimiento = x.datos.fecha_fin;
        if (tipo.tipo === 'imagen') { x.marcado = true; x.aviso = null; }        // imágenes: sin texto con el que comprobar citas
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
    const temasSinPlan = [];
    const temasUnicos = [...new Map(temasEstudio.map((t) => [I.normalizarTexto(t.tema), t])).values()].slice(0, 8);
    for (const tema of temasUnicos) {
        const limite = tema.fechaLimite ? (esISO(tema.fechaLimite) ? { inicio: tema.fechaLimite } : I.resolverRango(tema.fechaLimite, ctx.hoy)) : null;
        const fechaLimite = limite?.inicio;
        if (!fechaLimite || !esISO(fechaLimite) || fechaLimite <= ctx.hoy) {
            temasSinPlan.push(tema.tema);
            continue;
        }
        const plan = P.planificarProyecto({
            actividades: [...ctx.actividades, ...crearLista.map((x, i) => ({ ...x.datos, id: `imp-${i}` }))],
            tareas: [{ titulo: `Estudiar: ${tema.tema}`.slice(0, 100), tipo: 'estudio', exigencia: 2, horas: 2, orden: 1, hito: false }],
            nombre: proyecto || '', fechaLimite, horasDia: 1.5, hoy: ctx.hoy, capacidades: ctx.capacidades,
            desde: ctx.hoy
        });
        if (!plan.crear.length) {
            temasSinPlan.push(tema.tema);
            continue;
        }
        for (const bloque of plan.crear) {
            preparaciones.push({
                ...bloque,
                datos: { ...bloque.datos, proyecto: proyecto || '', fecha_vencimiento: fechaLimite },
                marcado: false,
                motivo: `Sesión sugerida para aprender «${tema.tema}» antes del ${fechaCorta(fechaLimite)}. ${tema.motivo}${tema.verificada ? '' : ' La cita requiere revisión.'}`
            });
        }
    }
    if (temasSinPlan.length) avisos.push(`También detecté temas que conviene estudiar, pero no encontré una fecha límite clara para programarlos: ${temasSinPlan.join(', ')}. Puedes indicarme cuándo los necesitas aprender.`);
    const nombreVisible = limpiarTextoVisible(nombre, 80);
    if (crearLista.length === 0 && preparaciones.length === 0) {
        const temas = temasUnicos.map((t) => t.tema);
        const detalle = temas.length ? ` Detecté estos temas de aprendizaje: ${temas.join(', ')}.` : '';
        return resp('respuesta', `No encontré fechas, exámenes ni entregas en «${nombreVisible}».${detalle} ${avisos.join(' ')}`.trim(), { avisos });
    }

    // 1) Lo fiable se añade directamente (un solo lote: un «Deshacer» lo quita todo)
    const automaticos = crearLista.filter((x) => x.marcado);
    if (automaticos.length > db.MAX_OPERACIONES) { avisos.push(`Encontré ${automaticos.length} elementos; añadí los primeros ${db.MAX_OPERACIONES}.`); automaticos.length = db.MAX_OPERACIONES; }
    const revisar = [...crearLista.filter((x) => !x.marcado), ...preparaciones].slice(0, db.MAX_OPERACIONES);
    let aplicado = null;
    if (automaticos.length) {
        const nuevas = automaticos.map((x, i) => ({ ...x.datos, id: `imp-${i}` }));
        const despues = [...ctx.actividades, ...nuevas];
        const saturados = new Map();
        for (const n of nuevas) for (const d of diasSaturados(despues, n, ctx.capacidades)) saturados.set(d.fecha, d.porcentaje);
        const avisoCarga = saturados.size
            ? [`Ojo: ${[...saturados].slice(0, 3).map(([f, pct]) => `el ${fechaCorta(f)} queda en ${pct} %`).join(', ')}; considera repartir algo.`] : [];
        const titulos = automaticos.slice(0, 3).map((x) => `«${x.datos.titulo}» (${fechaCorta(x.datos.fecha_inicio)})`).join(', ');
        aplicado = await aplicarDirecto(ctx, automaticos.map((x) => ({ op: 'crear', datos: x.datos })), {
            mensaje: `📥 Añadí ${automaticos.length} ${automaticos.length === 1 ? 'elemento' : 'elementos'} de «${nombreVisible}» a tu calendario: ${titulos}${automaticos.length > 3 ? '…' : ''}${proyecto ? ` (proyecto «${proyecto}»)` : ''}.`,
            avisos: [...avisos, ...avisoCarga], tocadas: nuevas
        });
        aplicado.importados = automaticos.map((x) => ({ titulo: x.datos.titulo, detalle: x.detalle, cita: x.cita }));
    }
    if (!revisar.length) return aplicado;

    // 2) Lo dudoso y lo opcional, con casillas
    if (aplicado) ctx.actividades = aplicado.actividades;
    const dudosos = revisar.filter((x) => x.cita !== undefined && !String(x.motivo).startsWith('Preparación')).length;
    const explicacion = aplicado
        ? `Revisa también ${dudosos ? `${dudosos} ${dudosos === 1 ? 'elemento que no pude comprobar' : 'elementos que no pude comprobar'}` : 'estos bloques de preparación opcionales'}.`
        : crearLista.length
            ? `Encontré ${crearLista.length} ${crearLista.length === 1 ? 'evento' : 'eventos'} en «${nombreVisible}», pero no pude comprobar su cita en el texto: marca los que quieras añadir.`
            : `Detecté sesiones de estudio sugeridas a partir de los temas del documento. Revisa las fechas y marca solo las que quieras guardar.`;
    const propuesta = await proponer(ctx, 'importar', { crear: revisar, explicaciones: [explicacion], avisos: aplicado ? [] : avisos }, { titulo: aplicado ? 'Revisa también' : 'Importar del archivo', seleccionable: true });
    return aplicado ? { ...aplicado, siguiente: propuesta } : propuesta;
}
