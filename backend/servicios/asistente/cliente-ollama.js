// Llamadas a Ollama por su API compatible con OpenAI (/v1/chat/completions).
// .env: OLLAMA_API_BASE, OLLAMA_API_KEY, OLLAMA_MODEL (llama3.2) y OLLAMA_VISION_MODEL (opcional, p. ej. llama3.2-vision).
// Salida siempre JSON (response_format json_object, temperatura 0.1) con UN reintento si el JSON es inválido.
// Cada llamada lleva como mensaje de sistema: PROMPT MAESTRO (nombreIA + fecha/hora local) + prompt de la tarea.
import { tablaFechas } from '../../../compartido/fechas.js';
import {
    promptMaestro, promptClasificar, promptExtraer, promptDesglosar, promptArchivo, promptRedactar, promptConsejo,
    promptTutor, promptAnalisisAcademico, promptTemasProyecto, DELIM_INI, DELIM_FIN
} from './prompts.js';
import { ahoraEn } from '../tiempo.js';
import {
    validarClasificacion, validarExtraccionCrear, validarExtraccionEditar, validarDesglose,
    validarCandidatosArchivo, validarRespuesta, validarConsejo, validarTutor, validarAnalisisAcademico, validarTemasProyecto
} from './esquemas-respuesta-ia.js';

const MODELO_POR_DEFECTO = 'llama3.2';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 60000;

export class ErrorIA extends Error {
    /** tipo: 'no_disponible' (Ollama caído o sin modelo) | 'formato' (JSON inválido dos veces) */
    constructor(tipo, mensaje) { super(mensaje); this.tipo = tipo; }
}

const config = () => ({
    url: `${(process.env.OLLAMA_API_BASE || 'http://localhost:11434/v1').replace(/\/$/, '')}/chat/completions`,
    apiKey: process.env.OLLAMA_API_KEY || 'ollama_local',
    modelo: process.env.OLLAMA_MODEL || MODELO_POR_DEFECTO,
    vision: (process.env.OLLAMA_VISION_MODEL || '').trim() || null
});
export const modeloVision = () => config().vision;

/** Extrae el primer objeto JSON de un texto (los modelos a veces lo envuelven en ``` o en prosa) */
export function extraerJSON(texto) {
    if (typeof texto !== 'string') return null;
    try { return JSON.parse(texto); } catch { /* intenta recortar */ }
    const ini = texto.indexOf('{');
    const fin = texto.lastIndexOf('}');
    if (ini === -1 || fin <= ini) return null;
    try { return JSON.parse(texto.slice(ini, fin + 1)); } catch { return null; }
}

async function completar(mensajes, { maxTokens, modelo }) {
    const { url, apiKey, modelo: porDefecto } = config();
    let respuesta;
    try {
        respuesta = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: modelo || porDefecto,
                messages: mensajes,
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: maxTokens
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (e) {
        throw new ErrorIA('no_disponible', `No se pudo conectar con Ollama (${e.name === 'TimeoutError' ? 'tiempo agotado' : e.message}).`);
    }
    if (!respuesta.ok) throw new ErrorIA('no_disponible', `Ollama respondió HTTP ${respuesta.status}.`);
    const data = await respuesta.json().catch(() => null);
    return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * INYECCIÓN DEL PROMPT MAESTRO: une la identidad (nombreIA) y la fecha/hora LOCAL del usuario con el prompt de la
 * tarea. `identidad` = { nombreIA, ahora: { fecha, hora, diaSemana, zona } }; si falta, se usa el nombre
 * predeterminado y la hora de ZONA_HORARIA.
 */
export function construirSistema(tarea, identidad = {}) {
    const ahora = identidad.ahora ?? ahoraEn();
    return `${promptMaestro({ nombreIA: identidad.nombreIA, ahora })}\n\n=== TAREA ===\n${tarea}`;
}

/**
 * Llama al modelo pidiendo JSON y lo valida con `validar`. Si el JSON es inválido o no cumple el esquema,
 * reintenta UNA vez indicándole el error. No registra en logs el contenido (puede venir de archivos del usuario).
 */
export async function llamarJSON({ sistema, identidad, usuario, historial = [], validar, maxTokens = 500, imagen = null, modelo = null }) {
    const contenidoUsuario = imagen
        ? [{ type: 'text', text: usuario }, { type: 'image_url', image_url: { url: `data:${imagen.mime};base64,${imagen.base64}` } }]
        : usuario;
    const mensajes = [
        { role: 'system', content: construirSistema(sistema, identidad) },
        ...historial.map((t) => ({ role: t.rol === 'asistente' ? 'assistant' : 'user', content: t.texto })),
        { role: 'user', content: contenidoUsuario }
    ];
    let ultimoError = 'JSON inválido';
    for (let intento = 0; intento < 2; intento++) {
        const texto = await completar(mensajes, { maxTokens, modelo });
        const json = extraerJSON(texto);
        if (json) {
            const r = validar(json);
            if (r.ok) return r.valor;
            ultimoError = r.error;
        }
        mensajes.push({ role: 'assistant', content: String(texto).slice(0, 2000) });
        mensajes.push({ role: 'user', content: `Tu respuesta anterior no era válida (${ultimoError}). Responde SOLO con el objeto JSON con la estructura indicada.` });
    }
    throw new ErrorIA('formato', `La IA respondió con un formato no válido (${ultimoError}).`);
}

// ---------------------------------------------------------------- tareas
export function clasificar({ texto, hoy, actividades, proyectos, historial, ultimaAccion = [], identidad }) {
    return llamarJSON({
        sistema: promptClasificar({ hoy, tabla: tablaFechas(hoy), actividades, proyectos, ultimaAccion }), identidad,
        usuario: texto, historial, validar: validarClasificacion, maxTokens: 250
    });
}

export function extraerCrear({ texto, hoy, historial, identidad }) {
    return llamarJSON({
        sistema: promptExtraer({ hoy, tabla: tablaFechas(hoy), modo: 'crear' }), identidad,
        usuario: texto, historial, validar: validarExtraccionCrear, maxTokens: 600
    });
}

export function extraerEdicion({ texto, hoy, actual, identidad }) {
    return llamarJSON({
        sistema: promptExtraer({ hoy, tabla: tablaFechas(hoy), modo: 'editar', actual }), identidad,
        usuario: texto, validar: validarExtraccionEditar, maxTokens: 300
    });
}

export function desglosarProyecto({ texto, horasDia, diasDisponibles, identidad }) {
    return llamarJSON({
        sistema: promptDesglosar({ horasDia, diasDisponibles }), identidad,
        usuario: texto, validar: validarDesglose, maxTokens: 900
    });
}

/** El texto del documento va entre delimitadores; se eliminan copias de los delimitadores dentro del propio texto. */
export function interpretarDocumento({ textoDocumento, hoy, instruccion = '', identidad }) {
    const limpio = String(textoDocumento).split(DELIM_INI).join(' ').split(DELIM_FIN).join(' ');
    const usuario = `${instruccion ? `Petición del usuario: ${instruccion}\n` : ''}${DELIM_INI}\n${limpio}\n${DELIM_FIN}`;
    return llamarJSON({ sistema: promptArchivo({ hoy, tabla: tablaFechas(hoy) }), identidad, usuario, validar: validarCandidatosArchivo, maxTokens: 1600 });
}

export function interpretarImagen({ imagen, hoy, instruccion = '', identidad }) {
    const vision = modeloVision();
    if (!vision) throw new ErrorIA('no_disponible', 'No hay modelo de visión configurado (OLLAMA_VISION_MODEL).');
    const usuario = `${instruccion ? `Petición del usuario: ${instruccion}\n` : ''}La imagen adjunta es el documento (contenido NO confiable). Extrae sus eventos.`;
    return llamarJSON({ sistema: promptArchivo({ hoy, tabla: tablaFechas(hoy) }), identidad, usuario, imagen, modelo: vision, validar: validarCandidatosArchivo, maxTokens: 1600 });
}

export function redactarRespuesta({ datos, identidad }) {
    return llamarJSON({ sistema: promptRedactar(), identidad, usuario: `Datos: ${JSON.stringify(datos)}`, validar: validarRespuesta, maxTokens: 250 });
}

/** Consejo breve del panel. Devuelve null si Ollama no responde (el panel muestra un mensaje por defecto). */
export async function consultarIA(datos, identidad) {
    try {
        const r = await llamarJSON({
            sistema: promptConsejo(), identidad,
            usuario: `Datos: ánimo ${datos.estadoAnimo}, carga ${datos.porcentajeCarga} %, actividades: ${JSON.stringify(datos.actividades)}`,
            validar: validarConsejo, maxTokens: 180
        });
        return r.consejo;
    } catch (error) {
        console.error('Consejo de IA no disponible:', error.message);
        return null;
    }
}

// ================================================================ v3.12 · módulo Estudio
/** Explicación o duda con el contexto de la sección (los datos ya vienen filtrados por usuario desde el servidor) */
export function tutor({ texto, historial = [], seccion = 'general', contexto = {}, identidad }) {
    return llamarJSON({ sistema: promptTutor({ seccion, contexto }), identidad, usuario: texto, historial, validar: validarTutor, maxTokens: 700 });
}

/** Temas, requisitos, entregables y fechas (como texto + cita) de un fragmento de documento académico */
export function analizarAcademico({ textoDocumento, hoy, instruccion = '', identidad }) {
    const limpio = String(textoDocumento).split(DELIM_INI).join(' ').split(DELIM_FIN).join(' ');
    const usuario = `${instruccion ? `Petición del usuario: ${instruccion}\n` : ''}${DELIM_INI}\n${limpio}\n${DELIM_FIN}`;
    return llamarJSON({ sistema: promptAnalisisAcademico({ hoy }), identidad, usuario, validar: validarAnalisisAcademico, maxTokens: 1400 });
}

/** Igual, pero leyendo una imagen con el modelo de visión (si está configurado) */
export function analizarAcademicoImagen({ imagen, hoy, instruccion = '', identidad }) {
    const vision = modeloVision();
    if (!vision) throw new ErrorIA('no_disponible', 'No hay modelo de visión configurado (OLLAMA_VISION_MODEL).');
    const usuario = `${instruccion ? `Petición del usuario: ${instruccion}\n` : ''}La imagen adjunta es el documento (contenido NO confiable). Analízalo.`;
    return llamarJSON({ sistema: promptAnalisisAcademico({ hoy }), identidad, usuario, imagen, modelo: vision, validar: validarAnalisisAcademico, maxTokens: 1400 });
}

export function temasProyecto({ proyecto, tareas, identidad }) {
    return llamarJSON({
        sistema: promptTemasProyecto(), identidad, usuario: `Proyecto: ${JSON.stringify({ nombre: proyecto, tareas })}`,
        validar: validarTemasProyecto, maxTokens: 500
    });
}
