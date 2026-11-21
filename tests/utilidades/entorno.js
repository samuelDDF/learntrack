// Entorno de pruebas: base de datos + Ollama simulado + aplicación Express + cliente HTTP con cookies.
// Base de datos, por orden de preferencia:
//   1) MONGO_URI_TEST (una MongoDB real; se usa una base de datos aparte que se borra al terminar)
//   2) mongodb-memory-server, si está instalado y puede descargar mongod (MongoDB real en memoria)
//   3) tests/utilidades/mongo-memoria.js: servidor de pruebas compatible con el protocolo, NO es MongoDB real
import { VERSIONES_VIGENTES } from '../../compartido/legal.js';
import mongoose from 'mongoose';
import { iniciarMongoMemoria } from './mongo-memoria.js';
import { iniciarOllamaFalso } from './ollama-falso.js';
import { iniciarApisExternasFalsas } from './apis-externas-falsas.js';
import { iniciarSmtpFalso } from './smtp-falso.js';

export async function iniciarBD({ replicaSet = true } = {}) {
    if (process.env.MONGO_URI_TEST) {
        const url = new URL(process.env.MONGO_URI_TEST);
        url.pathname = `/learntrack_test_${process.pid}_${Date.now()}`;
        return { uri: url.toString(), tipo: 'MONGO_URI_TEST (MongoDB real)', real: true, cerrar: async () => {} };
    }
    try {
        const { MongoMemoryReplSet, MongoMemoryServer } = await import('mongodb-memory-server');
        const srv = replicaSet ? await MongoMemoryReplSet.create({ replSet: { count: 1 } }) : await MongoMemoryServer.create();
        return { uri: srv.getUri('learntrack_test'), tipo: 'mongodb-memory-server (MongoDB real)', real: true, cerrar: () => srv.stop() };
    } catch { /* no instalado o sin binario: siguiente opción */ }
    const m = await iniciarMongoMemoria({ replicaSet });
    return { uri: m.uri, tipo: `servidor de pruebas en memoria (${m.tipo}; NO es MongoDB real)`, real: false, cerrar: m.cerrar, reiniciar: m.reiniciar };
}

export async function conectarBD(opciones) {
    const bd = await iniciarBD(opciones);
    await mongoose.connect(bd.uri, { serverSelectionTimeoutMS: 5000 });
    const { prepararBaseDeDatos } = await import('../../backend/datos/index.js');
    bd.estado = await prepararBaseDeDatos();
    if (!globalThis.__avisoBD) { console.log(`# base de datos de prueba: ${bd.tipo}`); globalThis.__avisoBD = true; }
    const cerrar = bd.cerrar;
    bd.cerrar = async () => {
        if (bd.real) await mongoose.connection.db.dropDatabase().catch(() => {});
        await mongoose.disconnect();
        await cerrar();
    };
    return bd;
}

/** Arranca todo y devuelve { base, ollama, bd, cliente(), cerrar() } */
export async function iniciarEntorno({ replicaSet = true, limites = {}, frontend = 'react', carpetaReact } = {}) {
    const ollama = await iniciarOllamaFalso();
    process.env.OLLAMA_API_BASE = ollama.base;
    process.env.OLLAMA_TIMEOUT_MS = '5000';
    const externas = await iniciarApisExternasFalsas();          // Nager.Date y Colormind simulados
    Object.assign(process.env, externas.variablesEntorno);
    const smtp = await iniciarSmtpFalso();                       // v3.10: servidor de correo simulado (protocolo SMTP real)
    Object.assign(process.env, smtp.variablesEntorno);
    const bd = await conectarBD({ replicaSet });
    const app = await levantarApp({ limites, frontend, carpetaReact, smtp });
    return {
        ...app, ollama, bd, externas, smtp,
        /** Otra instancia de la app (otros límites) sobre la MISMA base de datos y el mismo Ollama simulado */
        otraApp: (opciones) => levantarApp({ smtp, ...opciones }),
        cerrar: async () => { await app.cerrar(); await bd.cerrar(); await ollama.cerrar(); await externas.cerrar(); await smtp.cerrar(); }
    };
}

let contadorUsuarios = 0;
async function levantarApp({ limites = {}, frontend = 'react', carpetaReact, smtp } = {}) {
    const { crearApp } = await import('../../backend/app.js');
    // Todas las pruebas usan el frontend React; no existe modo clásico.
    const app = crearApp({ limites: { api: 100000, chat: 100000, consejo: 100000, registro: 100000, archivos: 100000, verificacion: 100000, reenvio: 100000, ...limites }, puerto: 0, frontend, ...(carpetaReact ? { carpetaReact } : {}) });
    const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    const base = `http://127.0.0.1:${servidor.address().port}`;
    return {
        base,
        async cliente(nombre = 'Prueba') {
            const c = crearCliente(base, smtp);
            await c.registrar(`u${process.pid}_${Date.now()}_${++contadorUsuarios}@prueba.co`, nombre);
            return c;
        },
        sinSesion: () => crearCliente(base, smtp),
        cerrar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); })
    };
}

export function crearCliente(base, smtp) {
    // Tarro de cookies (v3.10: además de lt_sid puede existir lt_verif, la cookie temporal de verificación)
    const tarro = new Map();
    const peticion = async (metodo, ruta, cuerpo, { cabeceras = {}, crudo = false } = {}) => {
        const opciones = { method: metodo, headers: { ...cabeceras }, redirect: 'manual' };
        if (tarro.size) opciones.headers.cookie = [...tarro].map(([k, v]) => `${k}=${v}`).join('; ');
        if (cuerpo instanceof FormData) opciones.body = cuerpo;
        else if (Buffer.isBuffer(cuerpo)) opciones.body = cuerpo;     // binario (avatar): el content-type lo pone quien llama
        else if (typeof cuerpo === 'string') { opciones.body = cuerpo; opciones.headers['content-type'] ??= 'application/json'; }
        else if (cuerpo !== undefined) { opciones.body = JSON.stringify(cuerpo); opciones.headers['content-type'] = 'application/json'; }
        const res = await fetch(base + ruta, opciones);
        for (const linea of res.headers.getSetCookie?.() ?? []) {
            const [par] = linea.split(';');
            const i = par.indexOf('=');
            const nombre = par.slice(0, i).trim(), valor = par.slice(i + 1).trim();
            if (!valor || /max-age=0/i.test(linea)) tarro.delete(nombre); else tarro.set(nombre, valor);
        }
        if (crudo) return res;
        const texto = await res.text();
        let data; try { data = JSON.parse(texto); } catch { data = texto; }
        return { status: res.status, data, headers: res.headers };
    };
    return {
        get: (r, o) => peticion('GET', r, undefined, o),
        post: (r, b, o) => peticion('POST', r, b ?? {}, o),
        put: (r, b, o) => peticion('PUT', r, b, o),
        del: (r, o) => peticion('DELETE', r, undefined, o),
        delCuerpo: (r, b, o) => peticion('DELETE', r, b, o),          // DELETE con cuerpo JSON (selección de la papelera)
        crudo: (m, r, b, o) => peticion(m, r, b, { ...o, crudo: true }),
        cookies: () => new Map(tarro),
        /** Registro COMPLETO (v3.10): pide la cuenta, lee el código del correo simulado y lo verifica */
        async registrar(email, nombre = 'Prueba', password = 'clave1234') {
            const r = await peticion('POST', '/api/auth/registro', { nombre, email, password, ...DATOS_LEGALES });
            if (r.status !== 202) throw new Error(`registro falló: ${r.status} ${JSON.stringify(r.data)}`);
            const codigo = smtp?.codigoPara(email);
            if (!codigo) throw new Error('no llegó el código de verificación al correo simulado');
            const v = await peticion('POST', '/api/auth/verificar-correo', { codigo });
            if (v.status !== 200) throw new Error(`verificación falló: ${v.status} ${JSON.stringify(v.data)}`);
            const me = await peticion('GET', '/api/auth/me');
            this.usuario = me.data.usuario;
            return v;
        }
    };
}

/**
 * v3.13: lo que el registro exige además de nombre, correo y contraseña: aceptar las versiones vigentes de los
 * documentos legales y una fecha de nacimiento (aquí, de una persona adulta).
 */
export const DATOS_LEGALES = Object.freeze({ aceptaDocumentos: true, versiones: { ...VERSIONES_VIGENTES }, fechaNacimiento: '1995-05-20' });

/** Fecha local "YYYY-MM-DD" para un desfase (getTimezoneOffset) dado; por defecto la del proceso */
export function hoyLocal(tzOffset = new Date().getTimezoneOffset()) {
    return new Date(Date.now() - tzOffset * 60000).toISOString().slice(0, 10);
}

export const actividadBase = (extra = {}) => ({
    titulo: 'Actividad', tipo: 'estudio', exigencia: 2, horas: 1, fecha_inicio: hoyLocal(), fecha_fin: hoyLocal(),
    hora_inicio: '', hora_fin: '', estado: 'pendiente', proyecto: '', ...extra
});
