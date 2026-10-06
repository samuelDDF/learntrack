import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../data_store.json');

const ESTRUCTURA_INICIAL = () => ({
    usuarios: [],     // { id, nombre, email, passwordHash, creado }
    sesiones: [],     // { tokenHash, userId, expira }
    actividades: [],  // { id, userId, titulo, tipo, exigencia, horas, fecha, fecha_inicio, fecha_fin, hora_inicio, hora_fin, estado, proyecto }
    historial: {},    // { [userId]: { 'YYYY-MM-DD': porcentaje } }
    mensajes: []      // mensajes del formulario de contacto
});

function leerBD() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify(ESTRUCTURA_INICIAL(), null, 2), { mode: 0o600 });
    }
    try {
        const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        const base = ESTRUCTURA_INICIAL();
        return {
            usuarios: Array.isArray(db.usuarios) ? db.usuarios : base.usuarios,
            sesiones: Array.isArray(db.sesiones) ? db.sesiones : base.sesiones,
            actividades: Array.isArray(db.actividades) ? db.actividades : base.actividades,
            historial: db.historial && typeof db.historial === 'object' ? db.historial : base.historial,
            mensajes: Array.isArray(db.mensajes) ? db.mensajes : base.mensajes
        };
    } catch (e) {
        const respaldo = `${DB_PATH}.corrupto-${Date.now()}`;
        try { fs.copyFileSync(DB_PATH, respaldo); } catch { /* sin permisos: se ignora */ }
        console.error(`data_store.json ilegible (copia en ${path.basename(respaldo)}); se usa una base vacía:`, e.message);
        return ESTRUCTURA_INICIAL();
    }
}

function guardarBD(data) {
    const tmp = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_PATH);
}

// ====== USUARIOS ======
export function buscarUsuarioPorEmail(email) {
    return leerBD().usuarios.find(u => u.email === email) ?? null;
}

export function buscarUsuarioPorId(id) {
    return leerBD().usuarios.find(u => u.id === id) ?? null;
}

export function crearUsuarioBD(usuario) {
    const db = leerBD();
    if (db.usuarios.some(u => u.email === usuario.email)) return null;
    db.usuarios.push(usuario);
    guardarBD(db);
    return usuario;
}

// ====== SESIONES ======
const MAX_SESIONES_POR_USUARIO = 5;

export function crearSesionBD(sesion) {
    const db = leerBD();
    const ahora = Date.now();
    db.sesiones = db.sesiones.filter(s => s.expira > ahora);

    const propias = db.sesiones.filter(s => s.userId === sesion.userId);
    if (propias.length >= MAX_SESIONES_POR_USUARIO) {
        const sobrantes = new Set(
            propias.sort((a, b) => a.expira - b.expira).slice(0, propias.length - MAX_SESIONES_POR_USUARIO + 1).map(s => s.tokenHash)
        );
        db.sesiones = db.sesiones.filter(s => !sobrantes.has(s.tokenHash));
    }

    db.sesiones.push(sesion);
    guardarBD(db);
}

export function buscarSesionBD(tokenHash) {
    const s = leerBD().sesiones.find(x => x.tokenHash === tokenHash);
    return s && s.expira > Date.now() ? s : null;
}

export function eliminarSesionBD(tokenHash) {
    const db = leerBD();
    const antes = db.sesiones.length;
    db.sesiones = db.sesiones.filter(s => s.tokenHash !== tokenHash);
    if (db.sesiones.length !== antes) guardarBD(db);
}

// ====== ACTIVIDADES (CRUD) ======
export function obtenerActividadesBD(userId) {
    return leerBD().actividades.filter(a => a.userId === userId).map(({ userId: _omitido, ...resto }) => resto);
}

export function guardarActividadBD(userId, actividad) {
    const db = leerBD();
    db.actividades.push({ ...actividad, userId });
    guardarBD(db);
    return obtenerActividadesBD(userId);
}

// Tras una edición parcial, mantiene coherentes fechas y horario (p. ej. el dashboard antiguo solo envía "fecha").
function reconciliarActividad(a) {
    const inicio = a.fecha_inicio ?? a.fecha;
    if (inicio && (!a.fecha_fin || a.fecha_fin < inicio)) a.fecha_fin = inicio;
    if (a.hora_inicio && a.hora_fin && a.hora_fin <= a.hora_inicio) a.hora_fin = null;
    return a;
}

export function actualizarActividadBD(userId, actividadId, datosActualizados) {
    const db = leerBD();
    const idx = db.actividades.findIndex(a => a.id === actividadId && a.userId === userId);
    if (idx === -1) return null;

    const fusionada = { ...db.actividades[idx], ...datosActualizados, id: actividadId, userId };
    db.actividades[idx] = reconciliarActividad(fusionada);
    guardarBD(db);
    return obtenerActividadesBD(userId);
}

export function eliminarActividadBD(userId, actividadId) {
    const db = leerBD();
    const antes = db.actividades.length;
    db.actividades = db.actividades.filter(a => !(a.id === actividadId && a.userId === userId));
    if (db.actividades.length === antes) return null;

    guardarBD(db);
    return obtenerActividadesBD(userId);
}

// ====== HISTORIAL ======
function ordenar(historial) {
    return Object.fromEntries(Object.entries(historial).sort(([a], [b]) => a.localeCompare(b)));
}

export function obtenerHistorialBD(userId) {
    return ordenar(leerBD().historial[userId] ?? {});
}

export function guardarHistorialBD(userId, fecha, porcentaje) {
    const db = leerBD();
    const propio = db.historial[userId] ?? {};
    propio[fecha] = porcentaje;
    db.historial[userId] = propio;
    guardarBD(db);
    return ordenar(propio);
}

// ====== CONTACTO ======
export function guardarMensajeBD(mensaje) {
    const db = leerBD();
    db.mensajes.push(mensaje);
    guardarBD(db);
}