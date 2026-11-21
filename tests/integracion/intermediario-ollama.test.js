// Intermediario local de Ollama (scripts/intermediario-ollama.js): lo que llega desde internet (a través de Tailscale
// Funnel) solo pasa a Ollama con la clave correcta, por la única ruta que usa LearnTrack y con los campos depurados.
// Se prueba contra un Ollama SIMULADO (no hace falta tener Ollama instalado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(raiz, 'scripts', 'intermediario-ollama.js');
const CLAVE = 'clave-de-prueba-0123456789-abcdefghijklmnop';

let ollama, proceso, base, ultima = null;

const puertoLibre = () => new Promise((ok) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

// El intermediario carga el .env de la carpeta actual (dotenv). Se arranca desde una carpeta vacía para que el .env
// personal de quien ejecuta las pruebas (p. ej. INTERMEDIARIO_MAX_BYTES subido para el modelo de visión) no cambie
// los límites que se comprueban aquí: cada prueba controla todas sus variables.
const carpetaSinEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-intermediario-'));

function arrancar(env) {
    return new Promise((ok, mal) => {
        const p = spawn(process.execPath, [script], { cwd: carpetaSinEnv, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let salida = '';
        const leer = (d) => { salida += d; if (salida.includes('Intermediario de Ollama en')) ok({ p, salida: () => salida }); };
        p.stdout.on('data', leer);
        p.stderr.on('data', (d) => { salida += d; });
        p.on('exit', (codigo) => mal(Object.assign(new Error(`terminó con ${codigo}`), { codigo, salida })));
    });
}

before(async () => {
    ollama = http.createServer((req, res) => {
        let cuerpo = '';
        req.on('data', (d) => { cuerpo += d; });
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
            ultima = { url: req.url, auth: req.headers.authorization ?? null, cuerpo: JSON.parse(cuerpo || 'null') };
            res.end(JSON.stringify({ choices: [{ message: { content: '{"consejo":"Descansa."}' } }] }));
        });
    });
    await new Promise((ok) => ollama.listen(0, '127.0.0.1', ok));
    const puerto = await puertoLibre();
    ({ p: proceso } = await arrancar({
        INTERMEDIARIO_CLAVE: CLAVE, INTERMEDIARIO_PUERTO: String(puerto),
        INTERMEDIARIO_OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}`, INTERMEDIARIO_POR_MINUTO: '15'
    }));
    base = `http://127.0.0.1:${puerto}`;
});
after(async () => {
    // En Windows la carpeta de trabajo de un proceso vivo no se puede borrar (EPERM): primero se espera a que termine
    if (proceso && proceso.exitCode === null && proceso.signalCode === null) {
        await new Promise((ok) => { proceso.once('exit', ok); proceso.kill(); });
    }
    ollama?.close();
    // Limpiar la carpeta temporal es cortesía, no parte de lo que se prueba: si el sistema la retiene, se queda en %TEMP%
    try { fs.rmSync(carpetaSinEnv, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* sin efecto en la prueba */ }
});

const pedir = (ruta, { clave = CLAVE, metodo = 'GET', cuerpo, tipo = 'application/json' } = {}) => fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { ...(clave ? { Authorization: `Bearer ${clave}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': tipo } : {}) },
    body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo))
});
const CHAT = { model: 'llama3.2', messages: [{ role: 'user', content: 'hola' }] };

test('sin clave o con clave incorrecta: 401 (y no gasta el cupo por minuto de Railway)', async () => {
    for (let i = 0; i < 15; i++) assert.equal((await pedir('/salud', { clave: null })).status, 401);
    assert.equal((await pedir('/salud', { clave: 'otra-clave' })).status, 401);
    const r = await pedir('/salud');
    assert.equal(r.status, 200, 'los intentos sin clave no bloquean a quien sí la tiene');
    assert.deepEqual(await r.json(), { ok: true, ollama: true, modelos: ['llama3.2'], faltan: [] });
});

test('solo existe la ruta del chat: las de administración de Ollama no pasan', async () => {
    for (const ruta of ['/api/pull', '/api/delete', '/api/create', '/api/generate', '/v1/models']) {
        assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: {} })).status, 404, ruta);
    }
});

test('reenvía SOLO los campos permitidos, sin la clave, con stream:false y tokens limitados', async () => {
    const r = await pedir('/v1/chat/completions', {
        metodo: 'POST',
        cuerpo: { ...CHAT, stream: true, max_tokens: 99999, keep_alive: 0, options: { num_ctx: 99999 }, response_format: { type: 'json_object' }, temperature: 0.1 }
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, '{"consejo":"Descansa."}');
    assert.equal(ultima.url, '/v1/chat/completions');
    assert.equal(ultima.auth, null, 'la clave no llega a Ollama');
    assert.deepEqual(ultima.cuerpo, {
        model: 'llama3.2', messages: [{ role: 'user', content: 'hola' }], stream: false, max_tokens: 2000,
        temperature: 0.1, response_format: { type: 'json_object' }
    });
});

test('rechaza modelos no permitidos, contenido que no es JSON y peticiones demasiado grandes', async () => {
    assert.equal((await pedir('/v1/chat/completions', { metodo: 'POST', cuerpo: { ...CHAT, model: 'otro-modelo' } })).status, 400);
    assert.equal((await pedir('/v1/chat/completions', { metodo: 'POST', cuerpo: { model: 'llama3.2', messages: [] } })).status, 400);
    assert.equal((await pedir('/v1/chat/completions', { metodo: 'POST', cuerpo: 'x', tipo: 'text/plain' })).status, 415);
    const grande = { ...CHAT, messages: [{ role: 'user', content: 'a'.repeat(1_100_000) }] };
    assert.equal((await pedir('/v1/chat/completions', { metodo: 'POST', cuerpo: grande })).status, 413);
});

test('límite de peticiones por minuto (con clave): 429', async () => {
    let ultimoEstado = 0;
    for (let i = 0; i < 16; i++) ultimoEstado = (await pedir('/salud')).status;
    assert.equal(ultimoEstado, 429);
});

test('no arranca sin una clave larga ni apuntando a un Ollama que no sea local', async () => {
    await assert.rejects(arrancar({ INTERMEDIARIO_CLAVE: 'corta' }), (e) => e.codigo === 1 && /INTERMEDIARIO_CLAVE/.test(e.salida));
    await assert.rejects(arrancar({ INTERMEDIARIO_CLAVE: CLAVE, INTERMEDIARIO_OLLAMA_URL: 'http://192.168.1.20:11434' }),
        (e) => e.codigo === 1 && /dirección local/.test(e.salida));
});
