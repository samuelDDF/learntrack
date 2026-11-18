// Intermediario local protegido entre el túnel (Tailscale Funnel) y Ollama.
//
//   Railway (Express) ──HTTPS──► Tailscale Funnel ──► ESTE intermediario (127.0.0.1:11435) ──► Ollama (127.0.0.1:11434)
//
// Ollama NO tiene autenticación propia: nunca se expone directamente. El túnel (Tailscale Funnel) apunta a este
// proceso, que:
//  · Solo escucha en 127.0.0.1 (no es accesible desde la red local ni desde internet sin el túnel).
//  · Exige «Authorization: Bearer <INTERMEDIARIO_CLAVE>» (comparación en tiempo constante). En Railway, la misma
//    clave va en OLLAMA_API_KEY: el backend ya la envía así (backend/servicios/asistente/cliente-ollama.js).
//  · Solo deja pasar POST /v1/chat/completions (lo único que usa LearnTrack) y GET /salud (comprobación).
//    Nada de /api/pull, /api/delete, /api/create… ni ninguna otra ruta de Ollama.
//  · Solo acepta los modelos permitidos, limita tamaño, tokens, peticiones por minuto y simultáneas, fuerza
//    stream:false y reenvía únicamente los campos que usa LearnTrack.
//  · No registra el contenido de las peticiones (puede incluir datos de usuarios) ni la clave.
//
// Uso (desde la carpeta del proyecto):   npm run ia:intermediario
// Variables (en .env, NUNCA en el repositorio):
//   INTERMEDIARIO_CLAVE        obligatoria, mínimo 32 caracteres aleatorios
//   INTERMEDIARIO_PUERTO       11435 por defecto
//   INTERMEDIARIO_OLLAMA_URL   http://127.0.0.1:11434 por defecto (debe ser local)
//   INTERMEDIARIO_MODELOS      lista separada por comas; por defecto OLLAMA_MODEL o llama3.2
//   INTERMEDIARIO_MAX_BYTES    1000000 por defecto (súbelo solo si activas el modelo de visión)
//   INTERMEDIARIO_POR_MINUTO   60 por defecto · INTERMEDIARIO_SIMULTANEAS 3 por defecto
//   INTERMEDIARIO_TIMEOUT_MS   90000 por defecto
import '../backend/config/entorno.js';
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const CLAVE = process.env.INTERMEDIARIO_CLAVE ?? '';
const PUERTO = Number(process.env.INTERMEDIARIO_PUERTO) || 11435;
const OLLAMA = (process.env.INTERMEDIARIO_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODELOS = (process.env.INTERMEDIARIO_MODELOS || process.env.OLLAMA_MODEL || 'llama3.2')
    .split(',').map((m) => m.trim()).filter(Boolean);
const MAX_BYTES = Number(process.env.INTERMEDIARIO_MAX_BYTES) || 1_000_000;
const POR_MINUTO = Number(process.env.INTERMEDIARIO_POR_MINUTO) || 60;
const SIMULTANEAS = Number(process.env.INTERMEDIARIO_SIMULTANEAS) || 3;
const TIMEOUT_MS = Number(process.env.INTERMEDIARIO_TIMEOUT_MS) || 90_000;
const MAX_TOKENS = 2000;
const MAX_MENSAJES = 60;

// ---------------------------------------------------------------- comprobaciones al arrancar
function salirCon(mensaje) { console.error(`❌ ${mensaje}`); process.exit(1); }
if (CLAVE.length < 32) salirCon('Falta INTERMEDIARIO_CLAVE en .env (mínimo 32 caracteres aleatorios).');
try {
    const { hostname, protocol } = new URL(OLLAMA);
    if (protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
        salirCon('INTERMEDIARIO_OLLAMA_URL debe ser una dirección local (http://127.0.0.1:11434).');
    }
} catch { salirCon('INTERMEDIARIO_OLLAMA_URL no es una URL válida.'); }

const huella = (texto) => createHash('sha256').update(texto).digest();
const HUELLA_CLAVE = huella(CLAVE);
function autorizado(req) {
    const cabecera = req.headers.authorization ?? '';
    if (!cabecera.startsWith('Bearer ')) return false;
    return timingSafeEqual(huella(cabecera.slice(7)), HUELLA_CLAVE);
}

// ---------------------------------------------------------------- límites
// La dirección pública del túnel la acabarán encontrando robots que prueban direcciones al azar. Sus intentos sin
// clave se cuentan APARTE: no gastan el cupo de Railway (solo las peticiones con la clave correcta lo consumen) y
// solo se registran los primeros de cada minuto para no llenar la consola.
const crearContador = () => ({ inicio: Date.now(), cuenta: 0 });
function sumar(contador) {
    const ahora = Date.now();
    if (ahora - contador.inicio >= 60_000) { contador.inicio = ahora; contador.cuenta = 0; }
    contador.cuenta += 1;
    return contador.cuenta;
}
const permitidas = crearContador();
const rechazadas = crearContador();
const MAX_REGISTROS_RECHAZOS = 20;
let enCurso = 0;

// ---------------------------------------------------------------- utilidades HTTP
function responder(res, estado, cuerpo, extra = {}) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    res.writeHead(estado, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extra
    });
    res.end(texto);
}
const error = (res, estado, mensaje, extra) => responder(res, estado, { error: { message: mensaje } }, extra);

function leerCuerpo(req) {
    return new Promise((resolver, rechazar) => {
        const declarado = Number(req.headers['content-length']);
        if (declarado > MAX_BYTES) { rechazar(Object.assign(new Error('demasiado grande'), { estado: 413 })); return; }
        const partes = [];
        let total = 0;
        req.on('data', (parte) => {
            total += parte.length;
            if (total > MAX_BYTES) { req.destroy(); rechazar(Object.assign(new Error('demasiado grande'), { estado: 413 })); return; }
            partes.push(parte);
        });
        req.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
        req.on('error', rechazar);
    });
}

/** Deja pasar SOLO los campos que usa LearnTrack, con límites */
function depurar(peticion) {
    if (!peticion || typeof peticion !== 'object' || Array.isArray(peticion)) return { error: 'Cuerpo JSON no válido.' };
    if (!MODELOS.includes(peticion.model)) return { error: 'Modelo no permitido.' };
    const { messages } = peticion;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MENSAJES) return { error: 'Lista de mensajes no válida.' };
    const rolesValidos = new Set(['system', 'user', 'assistant']);
    if (!messages.every((m) => m && rolesValidos.has(m.role) && (typeof m.content === 'string' || Array.isArray(m.content)))) {
        return { error: 'Mensaje no válido.' };
    }
    const limpio = {
        model: peticion.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        max_tokens: Math.min(Math.max(Number(peticion.max_tokens) || 500, 1), MAX_TOKENS)
    };
    if (typeof peticion.temperature === 'number') limpio.temperature = Math.min(Math.max(peticion.temperature, 0), 2);
    if (peticion.response_format?.type === 'json_object') limpio.response_format = { type: 'json_object' };
    return { limpio };
}

// ---------------------------------------------------------------- servidor
const servidor = http.createServer(async (req, res) => {
    const inicio = Date.now();
    const ruta = (req.url ?? '').split('?')[0];
    const registrar = (estado) => console.log(`${new Date().toISOString()} ${req.method} ${ruta} → ${estado} (${Date.now() - inicio} ms)`);

    if (!autorizado(req)) {
        const n = sumar(rechazadas);
        if (n <= MAX_REGISTROS_RECHAZOS) registrar(401);
        else if (n === MAX_REGISTROS_RECHAZOS + 1) console.log('   (más intentos sin clave este minuto: no se registran)');
        return error(res, 401, 'No autorizado.');
    }
    if (sumar(permitidas) > POR_MINUTO) { registrar(429); return error(res, 429, 'Demasiadas peticiones.', { 'Retry-After': '60' }); }

    if (req.method === 'GET' && ruta === '/salud') {
        try {
            const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
            const datos = await r.json();
            const instalados = (datos.models ?? []).map((m) => m.name);
            const faltan = MODELOS.filter((m) => !instalados.some((i) => i === m || i === `${m}:latest`));
            registrar(200);
            return responder(res, 200, { ok: faltan.length === 0, ollama: true, modelos: MODELOS, faltan });
        } catch {
            registrar(502);
            return responder(res, 502, { ok: false, ollama: false, error: 'Ollama no responde en este equipo.' });
        }
    }

    if (req.method !== 'POST' || ruta !== '/v1/chat/completions') { registrar(404); return error(res, 404, 'Ruta no disponible.'); }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { registrar(415); return error(res, 415, 'Se esperaba JSON.'); }
    if (enCurso >= SIMULTANEAS) { registrar(503); return error(res, 503, 'La IA está ocupada, inténtalo de nuevo.', { 'Retry-After': '5' }); }

    enCurso += 1;
    try {
        let peticion;
        try { peticion = JSON.parse(await leerCuerpo(req)); } catch (e) {
            registrar(e.estado ?? 400);
            return error(res, e.estado ?? 400, e.estado === 413 ? 'Petición demasiado grande.' : 'Cuerpo JSON no válido.');
        }
        const { limpio, error: problema } = depurar(peticion);
        if (problema) { registrar(400); return error(res, 400, problema); }

        let r;
        try {
            r = await fetch(`${OLLAMA}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },     // la clave NO se reenvía a Ollama
                body: JSON.stringify(limpio),
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
        } catch (e) {
            const tiempo = e.name === 'TimeoutError';
            registrar(tiempo ? 504 : 502);
            return error(res, tiempo ? 504 : 502, tiempo ? 'Ollama tardó demasiado.' : 'Ollama no responde en este equipo.');
        }
        const texto = await r.text();
        registrar(r.status);
        return responder(res, r.status, texto);
    } finally {
        enCurso -= 1;
    }
});

servidor.requestTimeout = TIMEOUT_MS + 10_000;
servidor.headersTimeout = 15_000;
servidor.listen(PUERTO, '127.0.0.1', () => {
    console.log(`🔒 Intermediario de Ollama en http://127.0.0.1:${PUERTO} → ${OLLAMA} (modelos: ${MODELOS.join(', ')})`);
    console.log('   Apunta el túnel a esta dirección, nunca al puerto de Ollama.');
});
