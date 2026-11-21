// El asistente de IA dentro del módulo Estudio (v3.12). Une la detección de necesidades de aprendizaje, el tutor con
// contexto, las sugerencias por proyecto, el plan de sesiones desde el chat y el análisis de documentos académicos.
// Seguridad: el modelo NUNCA accede a la base de datos. Este módulo carga los datos del usuario autenticado (siempre
// filtrados por su userId), le pasa al modelo un resumen de solo lectura y valida todo lo que el modelo devuelve.
// Nada se guarda sin confirmación, salvo las SUGERENCIAS (estado «sugerido»), que no tocan el calendario y la
// persona acepta, pospone o descarta.
import * as ia from '../asistente/cliente-ollama.js';
import * as db from '../../datos/index.js';
import * as I from '../asistente/interprete-lenguaje.js';
import { resumenObjetivo, porUrgenciaDeEstudio, claveTema, ESTADOS_ACTIVOS, NOMBRE_NIVEL } from '../../../compartido/estudio.js';
import { fechaLarga, sumarDias, esISO } from '../../../compartido/fechas.js';
import { limpiarTextoVisible } from '../../validacion/index.js';
import { planificarEstudio } from './planificador-estudio.js';
import { detectarTipo, extraerTexto, fragmentar, citaVerificada, ErrorArchivo } from '../archivos/lector-documentos.js';

const resp = (tipo, mensaje, extra = {}) => ({ tipo, mensaje, ...extra });
export const conResumen = (objetivo, sesiones, hoy) => ({ ...objetivo, resumen: resumenObjetivo(objetivo, sesiones, hoy) });

/** ¿Está a la vista una sugerencia? (las pospuestas reaparecen cuando llega su fecha) */
export const sugerenciaVisible = (o, hoy) => o.estado === 'sugerido' && (!o.posponerHasta || o.posponerHasta <= hoy);

// ====================================================================== contexto para el tutor
/**
 * Resumen de SOLO LECTURA para el modelo, según la sección desde la que se escribe. Lo construye el servidor con los
 * datos del usuario autenticado: el navegador solo dice la sección, el nombre del proyecto o el id del tema, y si
 * no son suyos simplemente no aparecen.
 */
export async function contextoParaTutor(ctx, contexto = {}) {
    const seccion = contexto.seccion ?? 'general';
    if (seccion === 'proyectos' && contexto.proyecto) {
        const tareas = ctx.actividades.filter((a) => a.proyecto === contexto.proyecto);
        if (!tareas.length) return { seccion, contexto: { proyecto: null, nota: 'El proyecto no existe o no tiene tareas.' } };
        const hechas = tareas.filter((a) => a.estado === 'completado').length;
        const objetivos = (await db.listarObjetivosBD(ctx.userId)).filter((o) => o.proyecto === contexto.proyecto && ESTADOS_ACTIVOS.includes(o.estado));
        return {
            seccion,
            contexto: {
                proyecto: contexto.proyecto, progreso: `${hechas} de ${tareas.length} tareas completadas`,
                tareas: tareas.slice(0, 25).map((a) => ({ t: a.titulo, est: a.estado, fi: a.fecha_inicio, ff: a.fecha_fin, h: a.horas, vence: a.fecha_vencimiento ?? undefined })),
                temasDeEstudio: objetivos.slice(0, 8).map((o) => o.tema)
            }
        };
    }
    if (seccion === 'estudio') {
        const [objetivos, sesiones] = await Promise.all([db.listarObjetivosBD(ctx.userId), db.obtenerSesionesEstudioBD(ctx.userId)]);
        const activos = objetivos.filter((o) => ESTADOS_ACTIVOS.includes(o.estado)).sort(porUrgenciaDeEstudio);
        const foco = contexto.objetivoId ? objetivos.find((o) => o.id === contexto.objetivoId)
            : contexto.tema ? objetivos.find((o) => claveTema(o.tema) === claveTema(contexto.tema)) : null;
        const describir = (o) => {
            const r = resumenObjetivo(o, sesiones, ctx.hoy);
            return {
                tema: o.tema, nivelActual: NOMBRE_NIVEL[o.nivelActual ?? ''], objetivo: o.nivelObjetivo ? NOMBRE_NIVEL[o.nivelObjetivo] : undefined,
                fechaLimite: o.fechaLimite ?? undefined, progreso: `${r.progreso} %`, situacion: r.situacion,
                proximaSesion: r.proximaSesion ? `${r.proximaSesion.fecha_inicio} ${r.proximaSesion.hora_inicio ?? ''}`.trim() : undefined,
                descripcion: o.descripcion || undefined
            };
        };
        return {
            seccion,
            contexto: {
                temaEnFoco: foco ? describir(foco) : undefined,
                temas: activos.slice(0, 10).map(describir),
                completados: objetivos.filter((o) => o.estado === 'completado').slice(-5).map((o) => o.tema)
            }
        };
    }
    return { seccion: 'general', contexto: {} };
}

/** Explicación del tutor (o null si la IA no responde con formato válido) */
export async function explicar(ctx, texto, contexto) {
    const datos = await contextoParaTutor(ctx, contexto);
    try {
        const { respuesta } = await ia.tutor({ texto, historial: ctx.historial, seccion: datos.seccion, contexto: datos.contexto, identidad: ctx.identidad });
        return respuesta;
    } catch (e) {
        if (e instanceof ia.ErrorIA && e.tipo === 'formato') return null;
        throw e;
    }
}

// ====================================================================== sugerencias
const presentarSugerencia = (r, motivo, sesiones, hoy) => ({
    objetivo: r.objetivo ? conResumen(r.objetivo, sesiones, hoy) : null,
    motivo, estado: r.nueva ? 'nueva' : r.repetida ? 'repetida' : r.existente ? 'existente' : r.descartada ? 'descartada' : 'omitida'
});

/**
 * Necesidad EXPLÍCITA detectada en el chat → sugerencia (no se crea nada en el calendario).
 * Si además pidió entender algo («no entiendo cómo…»), el tutor le explica en la misma respuesta.
 */
export async function sugerirDesdeChat(ctx, necesidad, { texto, contexto = {} }) {
    const proyecto = contexto.seccion === 'proyectos' && ctx.proyectos.includes(contexto.proyecto) ? contexto.proyecto : '';
    const motivo = `Lo dijiste en el chat: «${limpiarTextoVisible(necesidad.frase, 140)}».`;
    const r = await db.registrarSugerenciaBD(ctx.userId, {
        tema: limpiarTextoVisible(necesidad.tema, 100), origen: 'chat', motivo, fechaLimite: necesidad.fechaLimite, proyecto
    }, { explicita: true });
    const sesiones = await db.obtenerSesionesEstudioBD(ctx.userId);
    const sugerencia = presentarSugerencia(r, motivo, sesiones, ctx.hoy);
    const tema = sugerencia.objetivo?.tema ?? necesidad.tema;
    let mensaje;
    if (r.existente) mensaje = `«${tema}» ya está en tu sección Estudio (${sugerencia.objetivo.resumen.progreso} % de progreso). ¿Quieres que planifique sesiones para avanzar?`;
    else if (r.omitida) mensaje = `Ya tienes el máximo de temas en Estudio; archiva o elimina alguno para añadir «${tema}».`;
    else {
        const veces = r.repetida ? ` Es la ${sugerencia.objetivo.menciones}.ª vez que lo mencionas, así que reforzarlo puede ayudarte mucho.` : '';
        const plazo = necesidad.fechaLimite ? ` con fecha límite el ${fechaLarga(necesidad.fechaLimite)}` : '';
        mensaje = `Parece que «${tema}» es algo que necesitas aprender.${veces} Te propongo añadirlo a Estudio${plazo}: tú decides si lo aceptas, lo pospones o lo descartas.`;
    }
    let explicacion = null;
    if (necesidad.explicacion && !r.omitida) explicacion = await explicar(ctx, texto, contexto).catch(() => null);
    return resp('sugerencia_estudio', explicacion ? `${explicacion}\n\n${mensaje}` : mensaje, { sugerencias: [sugerencia] });
}

/**
 * Detección CONTEXTUAL a partir de un proyecto: el modelo deduce los conocimientos que piden sus tareas.
 * Se registran como sugerencias (nunca se re-sugiere lo que la persona descartó).
 */
export async function sugerirTemasDeProyecto(ctx, proyecto) {
    const tareas = ctx.actividades.filter((a) => a.proyecto === proyecto);
    if (!tareas.length) return resp('respuesta', `No encontré tareas del proyecto «${limpiarTextoVisible(proyecto, 60)}». Ábrelo en Proyectos y vuelve a preguntarme.`);
    const { temas } = await ia.temasProyecto({ proyecto, tareas: tareas.slice(0, 25).map((a) => a.titulo), identidad: ctx.identidad });
    if (!temas.length) return resp('respuesta', `Con las tareas de «${proyecto}» no veo conocimientos concretos que te falten. Si algo te cuesta, cuéntamelo y lo añadimos a Estudio.`);
    const sugerencias = [];
    for (const t of temas) {
        const motivo = `Proyecto «${proyecto}»: ${t.motivo || 'lo requieren sus tareas.'}`.slice(0, 300);
        const r = await db.registrarSugerenciaBD(ctx.userId, { tema: t.tema, categoria: t.tipo, horasEstimadas: t.horas, origen: 'proyecto', motivo, proyecto });
        if (!r.descartada && !r.omitida) sugerencias.push({ r, motivo });
    }
    const sesiones = await db.obtenerSesionesEstudioBD(ctx.userId);
    const lista = sugerencias.map(({ r, motivo }) => presentarSugerencia(r, motivo, sesiones, ctx.hoy));
    if (!lista.length) return resp('respuesta', `Los temas que veo para «${proyecto}» ya los habías descartado, así que no te los vuelvo a sugerir.`);
    const nuevos = lista.filter((s) => s.estado !== 'existente').length;
    return resp('sugerencia_estudio', nuevos
        ? `Para «${proyecto}» te vendría bien estudiar ${lista.length === 1 ? 'esto' : 'estos temas'}. Revisa cada uno: puedes añadirlo, posponerlo o descartarlo.`
        : `Los temas que necesita «${proyecto}» ya están en tu sección Estudio.`, { sugerencias: lista });
}

// ====================================================================== plan de sesiones desde el chat
/** «Planifica mis sesiones de estudio» (o «… el estudio de React»): plan EDITABLE; no se guarda hasta confirmar */
export async function planDesdeChat(ctx, texto) {
    const objetivos = (await db.listarObjetivosBD(ctx.userId)).filter((o) => ESTADOS_ACTIVOS.includes(o.estado));
    if (!objetivos.length) return resp('respuesta', 'Todavía no tienes temas activos en Estudio. Dime qué quieres aprender («quiero aprender JavaScript antes del 30 de noviembre») y lo preparamos.');
    const t = claveTema(texto);
    const nombrados = objetivos.filter((o) => o.claveTema ? t.includes(o.claveTema) : t.includes(claveTema(o.tema)));
    const elegidos = (nombrados.length ? nombrados : objetivos).sort(porUrgenciaDeEstudio).slice(0, 10);
    return planParaObjetivos(ctx, elegidos);
}

export async function planParaObjetivos(ctx, objetivos, opciones = {}) {
    const plan = planificarEstudio({
        actividades: ctx.actividades, objetivos, hoy: ctx.hoy, horaActual: ctx.horaActual, capacidades: ctx.capacidades, ...opciones
    });
    const temas = objetivos.map((o) => ({ id: o.id, tema: o.tema, fechaLimite: o.fechaLimite ?? null }));
    if (!plan.sesiones.length) return resp('respuesta', plan.avisos.join(' ') || 'No encontré huecos para nuevas sesiones.', { avisos: plan.avisos });
    return resp('plan_estudio', `Te propongo ${plan.sesiones.length} ${plan.sesiones.length === 1 ? 'sesión' : 'sesiones'} de estudio. Ajusta días, horas o duración y pulsa «Guardar en el calendario»; hasta entonces no cambio nada.`, {
        plan: { ...plan, temas }
    });
}

// ====================================================================== análisis de documentos académicos
const TIPOS_ANALIZABLES = ['texto', 'pdf', 'docx', 'imagen'];

/**
 * Fecha de un elemento extraído, calculada EN CÓDIGO a partir de la cita literal (nunca de lo que «crea» el modelo):
 *  · sin cita comprobada en el documento → se descarta (posible fecha inventada);
 *  · la cita no contiene una fecha reconocible, o contiene varias → se muestra pidiendo confirmación;
 *  · sin año escrito (lo habitual: «25 de noviembre») → se supone el próximo y se indica.
 */
export function fechaDeCita(f, texto, hoy, { verificarCita = true } = {}) {
    const fuente = f.cita || f.texto;
    if (verificarCita && !(citaVerificada(f.cita, texto) || citaVerificada(f.texto, texto))) return { descartada: true };
    const hallazgos = I.buscarFechas(fuente, hoy).filter((h) => h.inicio === h.fin);
    const conTexto = f.texto ? I.buscarFechas(f.texto, hoy).filter((h) => h.inicio === h.fin) : [];
    const lista = conTexto.length === 1 ? conTexto : hallazgos;
    const distintas = [...new Set(lista.map((h) => h.inicio))];
    if (distintas.length !== 1) return { fecha: null, requiereConfirmacion: true, motivo: distintas.length ? 'La frase tiene varias fechas: elige la correcta.' : 'No pude leer una fecha clara: escríbela tú.' };
    const fecha = distintas[0];
    const relativa = /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana|el \d{1,2}\b(?! de))/.test(I.normalizarTexto(lista[0].texto)) && !/\d{1,2} de [a-z]+|\d{1,2}[/-]\d{1,2}/.test(I.normalizarTexto(lista[0].texto));
    const conAnio = /\b(19|20)\d{2}\b/.test(fuente);
    return {
        fecha, requiereConfirmacion: relativa, anioSupuesto: !conAnio && !relativa,
        motivo: relativa ? 'La fecha es relativa («el viernes»): confirma a qué día se refiere.' : null
    };
}

/**
 * Analiza un taller/trabajo/guía y devuelve lo identificado para REVISAR (no guarda nada):
 * { titulo, resumen, temas[], requisitos[], entregables[], fechas[], fechaLimiteSugerida, avisos[] }.
 */
export async function analizarDocumentoAcademico(ctx, { nombre, buffer, instruccion = '', vision = false }) {
    const tipo = detectarTipo(nombre, buffer, { vision });
    if (tipo.tipo === 'ics') throw new ErrorArchivo('Los calendarios .ics se importan desde el chat del Panel (botón 📎); aquí se analizan talleres y trabajos (PDF, DOCX, TXT o MD).', 415);
    if (!TIPOS_ANALIZABLES.includes(tipo.tipo)) throw new ErrorArchivo('Formato no admitido para el análisis académico.', 415);
    const avisos = [];
    const parciales = [];
    let texto = '';
    if (tipo.tipo === 'imagen') {
        parciales.push({ r: await ia.analizarAcademicoImagen({ imagen: { mime: tipo.mime, base64: buffer.toString('base64') }, hoy: ctx.hoy, instruccion, identidad: ctx.identidad }), fragmento: null });
        avisos.push('Leí una imagen: no puedo comprobar las citas en el texto, así que todas las fechas necesitan tu confirmación.');
    } else {
        const ext = await extraerTexto(tipo, buffer);
        texto = ext.texto;
        if (!texto.trim()) throw new ErrorArchivo('No encontré texto en el archivo (¿es un PDF escaneado?).', 422);
        if (ext.truncado) avisos.push(`El documento es largo: analicé solo el principio (${texto.length} caracteres).`);
        for (const fragmento of fragmentar(texto)) {
            parciales.push({ r: await ia.analizarAcademico({ textoDocumento: fragmento, hoy: ctx.hoy, instruccion, identidad: ctx.identidad }), fragmento });
        }
    }
    // Fusión de los fragmentos: temas por clave (sin duplicados), listas sin repetir, fechas comprobadas en código
    const temas = new Map();
    const requisitos = new Set(), entregables = new Set();
    const fechas = [];
    let descartadas = 0;
    const vistas = new Set();
    for (const { r, fragmento } of parciales) {
        for (const t of r.temas) {
            const clave = claveTema(t.tema);
            if (!clave || temas.has(clave)) continue;
            const enDocumento = fragmento ? (t.cita ? citaVerificada(t.cita, fragmento) : false) || citaVerificada(t.tema, fragmento) : t.enDocumento;
            temas.set(clave, {
                tema: t.tema, tipo: t.tipo, horas: t.horas, enDocumento,
                motivo: t.motivo || (enDocumento ? 'Aparece en el documento.' : 'Conocimiento previo que deduzco.'),
                cita: enDocumento && t.cita ? t.cita : null
            });
        }
        r.requisitos.forEach((x) => requisitos.add(x));
        r.entregables.forEach((x) => entregables.add(x));
        for (const f of r.fechas) {
            const d = fechaDeCita(f, fragmento ?? '', ctx.hoy, { verificarCita: Boolean(fragmento) });
            if (d.descartada) { descartadas++; continue; }
            const clave = `${f.tipo}|${d.fecha ?? f.texto}`;
            if (vistas.has(clave)) continue;
            vistas.add(clave);
            fechas.push({
                tipo: f.tipo, texto: f.texto, descripcion: f.descripcion, cita: f.cita || null, fecha: d.fecha,
                requiereConfirmacion: !fragmento || d.requiereConfirmacion, anioSupuesto: Boolean(d.anioSupuesto),
                pasada: Boolean(d.fecha && d.fecha < ctx.hoy), motivo: !fragmento ? 'Leída de una imagen: confírmala.' : d.motivo
            });
        }
    }
    if (descartadas) avisos.push(`Descarté ${descartadas} ${descartadas === 1 ? 'fecha que no aparece' : 'fechas que no aparecen'} literalmente en el documento (no invento fechas).`);
    fechas.sort((a, b) => String(a.fecha ?? '9999').localeCompare(String(b.fecha ?? '9999')));
    // Fecha límite sugerida: la ENTREGA (o, si no hay, el examen) futura más próxima que no necesite confirmación
    const candidatas = fechas.filter((f) => f.fecha && !f.pasada && !f.requiereConfirmacion);
    const entrega = candidatas.find((f) => f.tipo === 'entrega') ?? candidatas.find((f) => f.tipo === 'examen') ?? null;
    const entregasDistintas = new Set(fechas.filter((f) => f.tipo === 'entrega' && f.fecha && !f.pasada).map((f) => f.fecha));
    if (entregasDistintas.size > 1) avisos.push('El documento tiene varias fechas de entrega: elige cuál usar como fecha límite.');
    if (!fechas.some((f) => f.tipo === 'entrega' || f.tipo === 'examen')) avisos.push('No encontré una fecha de entrega en el documento. Puedes indicarla tú o dejar los temas sin fecha.');
    const titulo = parciales.map((p) => p.r.titulo).find(Boolean) || limpiarTextoVisible(nombre, 80).replace(/\.[a-z0-9]+$/i, '');
    if (!temas.size && !fechas.length) return resp('respuesta', `No encontré temas ni fechas en «${limpiarTextoVisible(nombre, 80)}».`, { avisos });
    return resp('analisis_estudio', `Esto es lo que identifiqué en «${titulo}». Revisa, corrige o descarta lo que quieras antes de guardarlo: todavía no he guardado nada.`, {
        analisis: {
            titulo, resumen: parciales.map((p) => p.r.resumen).find(Boolean) || '',
            temas: [...temas.values()].slice(0, 12), requisitos: [...requisitos].slice(0, 10), entregables: [...entregables].slice(0, 8),
            fechas: fechas.slice(0, 15),
            fechaLimiteSugerida: entregasDistintas.size > 1 ? null : entrega?.fecha ?? null,
            entregaSugerida: entrega && entregasDistintas.size <= 1 ? { titulo: `${entrega.tipo === 'examen' ? 'Examen' : 'Entrega'}: ${titulo}`.slice(0, 100), fecha: entrega.fecha, tipo: entrega.tipo } : null,
            avisos
        }
    });
}

/** Comprueba que la fecha sea válida y futura (lo usa la ruta al guardar lo confirmado) */
export const fechaFuturaValida = (f, hoy) => esISO(f) && f >= hoy && f <= sumarDias(hoy, 365 * 3);
