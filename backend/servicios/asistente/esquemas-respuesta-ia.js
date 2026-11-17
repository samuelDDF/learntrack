// Validación ESTRICTA de la salida del modelo. Toda salida del LLM es entrada no confiable:
// tipos exactos, enumeraciones cerradas, longitudes y cantidades máximas. Las claves desconocidas se descartan.
// Cada validador devuelve { ok: true, valor } o { ok: false, error }.
import { INTENCIONES } from './prompts.js';
import { limpiarTextoVisible } from '../../validacion/index.js';

const esObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const txt = (v, max) => (typeof v === 'string' ? limpiarTextoVisible(v, max) : '');
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const hora = (v) => (typeof v === 'string' && RE_HORA.test(v.trim()) ? v.trim() : null);

export function validarClasificacion(o) {
    if (!esObj(o)) return { ok: false, error: 'no es un objeto' };
    if (!INTENCIONES.includes(o.intencion)) return { ok: false, error: `intencion no válida: ${String(o.intencion).slice(0, 30)}` };
    const ids = Array.isArray(o.ids) ? o.ids : (typeof o.ids === 'string' ? [o.ids] : []);
    if (ids.length > 30) return { ok: false, error: 'demasiados ids' };
    return {
        ok: true,
        valor: {
            intencion: o.intencion,
            ids: [...new Set(ids.filter((x) => typeof x === 'string' && RE_ID.test(x)))],
            referencia: txt(o.referencia, 100),
            proyecto: txt(o.proyecto, 60),
            fecha_objetivo: txt(o.fecha_objetivo, 60),
            fecha_destino: txt(o.fecha_destino, 60),
            modo: ['aplazar', 'eliminar'].includes(o.modo) ? o.modo : 'ninguno'
        }
    };
}

const CAMPOS_ACTIVIDAD = ['titulo', 'tipo', 'exigencia', 'horas', 'fecha_inicio', 'fecha_fin', 'fecha', 'hora_inicio', 'hora_fin', 'estado', 'proyecto', 'fecha_vencimiento', 'requiere_confirmacion'];
function soloCampos(o) {
    const r = {};
    for (const k of CAMPOS_ACTIVIDAD) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        const v = o[k];
        if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') r[k] = typeof v === 'string' ? v.slice(0, 120) : v;
    }
    return r;
}

export function validarExtraccionCrear(o) {
    if (!esObj(o) || !Array.isArray(o.actividades)) return { ok: false, error: 'falta "actividades"' };
    if (o.actividades.length > 5) return { ok: false, error: 'demasiadas actividades' };
    const lista = o.actividades.filter(esObj).map(soloCampos).filter((a) => typeof a.titulo === 'string' && a.titulo.trim());
    return { ok: true, valor: { actividades: lista } };
}

export function validarExtraccionEditar(o) {
    if (!esObj(o) || !esObj(o.cambios)) return { ok: false, error: 'falta "cambios"' };
    return { ok: true, valor: { cambios: soloCampos(o.cambios) } };
}

export function validarDesglose(o) {
    if (!esObj(o) || !Array.isArray(o.tareas)) return { ok: false, error: 'falta "tareas"' };
    if (o.tareas.length < 2 || o.tareas.length > 12) return { ok: false, error: 'número de tareas fuera de rango' };
    const tareas = o.tareas.filter(esObj).slice(0, 10).map((t, i) => {
        const horas = Number(t.horas);
        const exig = Number(t.exigencia);
        return {
            titulo: txt(t.titulo, 80),
            tipo: t.tipo === 'trabajo' ? 'trabajo' : 'estudio',
            exigencia: [1, 2, 3].includes(exig) ? exig : 2,
            horas: Number.isFinite(horas) ? Math.min(8, Math.max(0.5, Math.round(horas * 2) / 2)) : 2,
            orden: Number.isInteger(Number(t.orden)) ? Number(t.orden) : i + 1,
            hito: t.hito === true
        };
    }).filter((t) => t.titulo);
    if (tareas.length < 2) return { ok: false, error: 'tareas vacías' };
    tareas.sort((a, b) => a.orden - b.orden);
    return { ok: true, valor: { proyecto: txt(o.proyecto, 40), tareas } };
}

const CATEGORIAS = ['examen', 'entrega', 'clase', 'evento', 'otro'];
export function validarCandidatosArchivo(o) {
    if (!esObj(o) || !Array.isArray(o.candidatos)) return { ok: false, error: 'falta "candidatos"' };
    const candidatos = o.candidatos.filter(esObj).slice(0, 40).map((c) => ({
        titulo: txt(c.titulo, 100),
        categoria: CATEGORIAS.includes(c.categoria) ? c.categoria : 'otro',
        fecha: txt(c.fecha, 40),
        hora_inicio: hora(c.hora_inicio),
        hora_fin: hora(c.hora_fin),
        cita: txt(c.cita, 120)
    })).filter((c) => c.titulo && c.fecha);
    const temasEstudio = (Array.isArray(o.temasEstudio) ? o.temasEstudio : []).filter(esObj).slice(0, 8).map((t) => ({
        tema: txt(t.tema, 100),
        motivo: txt(t.motivo, 160),
        fechaLimite: txt(t.fechaLimite, 40),
        cita: txt(t.cita, 120)
    })).filter((t) => t.tema && t.cita);
    return { ok: true, valor: { candidatos, temasEstudio } };
}

export function validarRespuesta(o) {
    if (!esObj(o) || typeof o.respuesta !== 'string' || !o.respuesta.trim()) return { ok: false, error: 'falta "respuesta"' };
    return { ok: true, valor: { respuesta: txt(o.respuesta, 600) } };
}

export function validarConsejo(o) {
    if (!esObj(o) || typeof o.consejo !== 'string' || !o.consejo.trim()) return { ok: false, error: 'falta "consejo"' };
    return { ok: true, valor: { consejo: txt(o.consejo, 400) } };
}
