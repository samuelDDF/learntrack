// v3.10 · Verificación del correo con código de 6 dígitos (OTP) por SMTP (servidor simulado con protocolo real).
// Cubre: sin sesión hasta verificar (en el SERVIDOR), código correcto/incorrecto/expirado/usado, intentos, reenvío
// con espera y máximo por hora, concurrencia (doble clic, reenvíos simultáneos), código ligado al navegador, correo ya
// verificado, abandono y regreso, fallos del SMTP, producción sin SMTP, cuentas antiguas y nada sensible expuesto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { iniciarEntorno, DATOS_LEGALES } from '../utilidades/entorno.js';
import * as db from '../../backend/datos/index.js';
import { hashPassword } from '../../backend/servicios/cuenta/contrasenas.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

let n = 0;
const correo = () => `otp${process.pid}_${Date.now()}_${++n}@prueba.co`;
const { Usuario } = db.modelos;
const doc = (email) => Usuario.findOne({ email }).lean();
/** Pide la cuenta SIN verificarla */
async function registrarSinVerificar(email = correo(), password = 'clave1234', c = e.sinSesion()) {
    const r = await c.post('/api/auth/registro', { nombre: 'Ana Prueba', email, password, ...DATOS_LEGALES });
    return { c, r, email };
}
// v3.13: 428 = sesión válida a la que solo le falta aceptar los documentos legales (p. ej. una cuenta antigua)
const tieneSesion = async (c) => [200, 428].includes((await c.get('/api/actividades')).status);
/** Simula el paso del tiempo moviendo hacia atrás el último envío (espera entre reenvíos) */
const pasarEspera = (email, segundos = 61) => Usuario.updateOne({ email }, { $set: { 'verificacionEmail.ultimoEnvio': new Date(Date.now() - segundos * 1000) } });
/** Ejecuta fn con variables de entorno temporales */
async function conEntorno(vars, fn) {
    const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('registro: 202 SIN sesión, cookie temporal limitada, correo con el código y nada sensible en la respuesta', async () => {
    const { c, r, email } = await registrarSinVerificar();
    assert.equal(r.status, 202);
    const v = r.data.verificacion;
    assert.equal(v.emailOculto, `${email.slice(0, 4)}***@prueba.co`);
    assert.equal(v.codigoActivo, true);
    assert.ok(v.expiraEnSegundos > 590 && v.expiraEnSegundos <= 600, String(v.expiraEnSegundos));
    assert.ok(v.reenviarEnSegundos > 50 && v.reenviarEnSegundos <= 60);
    assert.equal(v.intentosRestantes, 5);
    // Sin sesión normal: ni API privada, ni /me, ni páginas privadas (que llevan a la verificación)
    assert.equal(await tieneSesion(c), false);
    assert.equal((await c.get('/api/auth/me')).data.usuario, null);
    const pagina = await c.get('/panel');
    assert.equal(pagina.status, 302); assert.equal(pagina.headers.get('location'), '/verificar-correo'); // v3.11: ruta propia del paso de verificación
    assert.ok(c.cookies().has('lt_verif') && !c.cookies().has('lt_sid'));
    // Correo recibido
    const m = e.smtp.paraCorreo(email).at(-1);
    assert.match(m.codigo, /^\d{6}$/);
    assert.equal(m.asunto, 'Verifica tu correo en LearnTrack');
    assert.ok(!m.asunto.includes(m.codigo), 'el código no va en el asunto');
    assert.match(m.html, /Verifica tu dirección de correo/);
    assert.match(m.html, /expira en 10 minutos/);
    assert.match(m.html, /si no has solicitado crear una cuenta en LearnTrack, puedes ignorar este mensaje/);
    assert.match(m.html, /cid:logo-learntrack/);
    assert.ok(m.adjuntos.some((a) => a.tipo === 'image/png' && a.cid.includes('logo-learntrack')), 'logo incrustado, sin imágenes remotas');
    assert.match(m.de, /pruebas@learntrack\.test/);
    // Nada sensible en la respuesta; en la BD solo el hash
    const json = JSON.stringify(r.data);
    assert.ok(!json.includes(m.codigo) && !/scrypt|hash|token/i.test(json));
    const d = await doc(email);
    assert.equal(d.emailVerificado, false);
    assert.match(d.verificacionEmail.codigoHash, /^scrypt\$/);
    assert.ok(!JSON.stringify(d).includes(`"${m.codigo}"`), 'el código en claro no está en MongoDB');
    assert.ok(d.pendienteHasta > new Date(), 'el registro pendiente caduca (TTL)');
});

test('código correcto: verifica, borra el código, quita la cookie temporal e inicia la sesión normal', async () => {
    const { c, email } = await registrarSinVerificar();
    const r = await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) });
    assert.equal(r.status, 200);
    assert.equal(r.data.usuario.email, email);
    assert.ok(c.cookies().has('lt_sid') && !c.cookies().has('lt_verif'));
    assert.equal(await tieneSesion(c), true);
    assert.equal((await c.get('/panel')).status, 200);
    const d = await doc(email);
    assert.equal(d.emailVerificado, true);
    assert.ok(d.emailVerificadoEn instanceof Date);
    assert.equal(d.verificacionEmail, undefined);
    assert.equal(d.pendienteHasta, undefined, 'una cuenta verificada nunca la borra el TTL');
    // Inicio de sesión normal a partir de ahora
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'clave1234' })).status, 200);
});

test('código incorrecto y formato inválido: mensaje claro, intentos restantes y sin sesión', async () => {
    const { c, email } = await registrarSinVerificar();
    const bueno = e.smtp.codigoPara(email);
    const malo = bueno === '000000' ? '000001' : '000000';
    const r = await c.post('/api/auth/verificar-correo', { codigo: malo });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'Código incorrecto. Te quedan 4 intentos.');
    assert.equal(r.data.intentosRestantes, 4);
    for (const codigo of ['12a456', '12345', '1234567', 123456, { $ne: null }, ['123456'], '']) {
        assert.equal((await c.post('/api/auth/verificar-correo', { codigo })).status, 400, JSON.stringify(codigo));
    }
    assert.equal(await tieneSesion(c), false);
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo: ` ${bueno.slice(0, 3)} ${bueno.slice(3)} ` })).status, 200, 'se aceptan espacios al pegar');
});

test('código ya utilizado: repetir la verificación con la cookie antigua no sirve ni crea otra sesión', async () => {
    const { c, email } = await registrarSinVerificar();
    const codigo = e.smtp.codigoPara(email);
    const cookieVieja = `lt_verif=${c.cookies().get('lt_verif')}`;
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo })).status, 200);
    const sesiones = await db.modelos.Sesion.countDocuments({});
    const repetido = await e.sinSesion().post('/api/auth/verificar-correo', { codigo }, { cabeceras: { cookie: cookieVieja } });
    assert.equal(repetido.status, 401);
    assert.equal(repetido.data.codigo, 'sin_verificacion');
    assert.equal(await db.modelos.Sesion.countDocuments({}), sesiones);
});

test('código expirado: se rechaza y «Reenviar código» da uno nuevo que sí funciona', async () => {
    const { c, email } = await registrarSinVerificar();
    const viejo = e.smtp.codigoPara(email);
    await Usuario.updateOne({ email }, { $set: { 'verificacionEmail.expira': new Date(Date.now() - 1000) } });
    const r = await c.post('/api/auth/verificar-correo', { codigo: viejo });
    assert.equal(r.status, 410);
    assert.equal(r.data.codigo, 'expirado');
    assert.match(r.data.error, /ha expirado/);
    assert.equal(r.data.verificacion.codigoActivo, false);
    await pasarEspera(email);
    const re = await c.post('/api/auth/reenviar-codigo');
    assert.equal(re.status, 200);
    assert.equal(e.smtp.paraCorreo(email).length, 2);
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
});

test('demasiados intentos fallidos: el código se anula; ni siquiera el correcto sirve; hay que pedir otro', async () => {
    const { c, email } = await registrarSinVerificar();
    const bueno = e.smtp.codigoPara(email);
    const malo = bueno === '999999' ? '999998' : '999999';
    for (let i = 1; i <= 4; i++) assert.equal((await c.post('/api/auth/verificar-correo', { codigo: malo })).status, 400);
    const quinto = await c.post('/api/auth/verificar-correo', { codigo: malo });
    assert.equal(quinto.status, 429);
    assert.equal(quinto.data.codigo, 'intentos');
    const correcto = await c.post('/api/auth/verificar-correo', { codigo: bueno });
    assert.equal(correcto.status, 410, 'el código anulado ya no vale');
    assert.equal(await tieneSesion(c), false);
    await pasarEspera(email);
    assert.equal((await c.post('/api/auth/reenviar-codigo')).status, 200);
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
});

test('fuerza bruta en paralelo: ráfagas de intentos simultáneos nunca superan el máximo de intentos', async () => {
    const { c, email } = await registrarSinVerificar();
    const bueno = e.smtp.codigoPara(email);
    const malos = Array.from({ length: 8 }, (_, i) => String((Number(bueno) + 1 + i) % 1_000_000).padStart(6, '0'));
    const respuestas = await Promise.all(malos.map((codigo) => c.post('/api/auth/verificar-correo', { codigo })));
    assert.ok(respuestas.every((x) => x.status !== 200));
    assert.ok((await doc(email)).verificacionEmail.intentos <= 5, 'el contador nunca pasa del máximo');
    const despues = await c.post('/api/auth/verificar-correo', { codigo: bueno });
    assert.notEqual(despues.status, 200, 'tras agotar los intentos (aunque fuera en paralelo) ni el código correcto sirve');
    assert.equal(await tieneSesion(c), false);
});

test('reenvío: espera entre envíos, el código anterior deja de valer y máximo de envíos por hora', async () => {
    await conEntorno({ OTP_MAX_SENDS_PER_HOUR: '3' }, async () => {
        const { c, email } = await registrarSinVerificar();
        const primero = e.smtp.codigoPara(email);
        const pronto = await c.post('/api/auth/reenviar-codigo');
        assert.equal(pronto.status, 429);
        assert.equal(pronto.data.codigo, 'espera');
        assert.ok(pronto.data.reenviarEnSegundos > 0 && pronto.data.reenviarEnSegundos <= 60);
        assert.match(pronto.data.error, /Podrás pedir otro en \d+ s/);
        assert.equal(e.smtp.paraCorreo(email).length, 1, 'no se envió otro correo');
        const hashAntes = (await doc(email)).verificacionEmail.codigoHash;
        await pasarEspera(email);
        const otro = await c.post('/api/auth/reenviar-codigo');
        assert.equal(otro.status, 200);
        assert.equal(otro.data.verificacion.reenviarEnSegundos, 60);
        assert.notEqual((await doc(email)).verificacionEmail.codigoHash, hashAntes, 'el código anterior queda invalidado');
        const segundo = e.smtp.codigoPara(email);
        if (segundo !== primero) assert.equal((await c.post('/api/auth/verificar-correo', { codigo: primero })).status, 400, 'el código anterior ya no sirve');
        await pasarEspera(email);
        assert.equal((await c.post('/api/auth/reenviar-codigo')).status, 200, 'tercer envío de la hora');
        await pasarEspera(email);
        const cuarto = await c.post('/api/auth/reenviar-codigo');
        assert.equal(cuarto.status, 429);
        assert.match(cuarto.data.error, /demasiados códigos a este correo/);
        assert.equal(e.smtp.paraCorreo(email).length, 3);
    });
});

test('concurrencia: reenvíos simultáneos → un solo correo; doble clic en «Verificar» → una sola verificación', async () => {
    const { c, email } = await registrarSinVerificar();
    await pasarEspera(email);
    const reenvios = await Promise.all(Array.from({ length: 5 }, () => c.post('/api/auth/reenviar-codigo')));
    assert.equal(reenvios.filter((x) => x.status === 200).length, 1, reenvios.map((x) => x.status).join(','));
    assert.ok(reenvios.filter((x) => x.status !== 200).every((x) => x.status === 429));
    assert.equal(e.smtp.paraCorreo(email).length, 2, 'registro + un único reenvío');
    const codigo = e.smtp.codigoPara(email);
    const sesionesAntes = await db.modelos.Sesion.countDocuments({});
    const dobles = await Promise.all([c.post('/api/auth/verificar-correo', { codigo }), c.post('/api/auth/verificar-correo', { codigo })]);
    assert.equal(dobles.filter((x) => x.status === 200).length, 1, dobles.map((x) => x.status).join(','));
    assert.equal(await db.modelos.Sesion.countDocuments({}), sesionesAntes + 1, 'una sola sesión');
});

test('el código va ligado al navegador que se registró: otro cliente u otra cuenta no pueden usarlo', async () => {
    const { email } = await registrarSinVerificar();
    const codigo = e.smtp.codigoPara(email);
    // Sin la cookie temporal no hay verificación posible
    const ajeno = e.sinSesion();
    assert.equal((await ajeno.post('/api/auth/verificar-correo', { codigo })).status, 401);
    // Con SU propia verificación pendiente, el código de otra cuenta es simplemente incorrecto
    const { c: otro, email: email2 } = await registrarSinVerificar();
    if (e.smtp.codigoPara(email2) !== codigo) assert.equal((await otro.post('/api/auth/verificar-correo', { codigo })).status, 400);
    assert.equal((await doc(email)).emailVerificado, false);
    // Mandar «emailVerificado: true» en el registro no sirve de nada
    const truco = await e.sinSesion().post('/api/auth/registro', { nombre: 'Truco', email: correo(), password: 'clave1234', emailVerificado: true, verificacionEmail: null, ...DATOS_LEGALES });
    assert.equal(truco.status, 202);
    assert.equal(await Usuario.countDocuments({ nombre: 'Truco', emailVerificado: true }), 0);
});

test('un correo ya verificado no se puede volver a registrar (aunque cambien mayúsculas o espacios)', async () => {
    const c = await e.cliente();
    const r = await e.sinSesion().post('/api/auth/registro', { nombre: 'Otra', email: `  ${c.usuario.email.toUpperCase()} `, password: 'otraClave99', ...DATOS_LEGALES });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'Ese correo ya está registrado. Inicia sesión.');
    assert.equal(e.smtp.paraCorreo(c.usuario.email).length, 1, 'no se envía nada a una cuenta ya verificada');
    assert.equal((await e.sinSesion().post('/api/auth/login', { email: c.usuario.email, password: 'clave1234' })).status, 200);
});

test('registro repetido de un correo pendiente: una sola cuenta, sin robo de cuenta por otra persona', async () => {
    const email = correo();
    const { c: victima } = await registrarSinVerificar(email, 'claveVictima1');
    // Otra persona intenta registrar el MISMO correo: primero debe esperar
    const atacante = e.sinSesion();
    const pronto = await atacante.post('/api/auth/registro', { nombre: 'Atacante', email, password: 'claveAtacante1', ...DATOS_LEGALES });
    assert.equal(pronto.status, 429);
    await pasarEspera(email);
    // Pasada la espera, su registro sustituye al pendiente… pero el código llega al CORREO, no a quien lo pidió
    assert.equal((await atacante.post('/api/auth/registro', { nombre: 'Atacante', email, password: 'claveAtacante1', ...DATOS_LEGALES })).status, 202);
    assert.equal(await Usuario.countDocuments({ email }), 1, 'nunca hay dos registros del mismo correo');
    const codigoNuevo = e.smtp.codigoPara(email);
    assert.equal((await victima.post('/api/auth/verificar-correo', { codigo: codigoNuevo })).status, 401, 'la cookie anterior ya no sirve');
    const adivina = codigoNuevo === '123456' ? '654321' : '123456';
    assert.equal((await atacante.post('/api/auth/verificar-correo', { codigo: adivina })).status, 400, 'sin el correo, el atacante no tiene el código');
    // La persona dueña del correo vuelve a registrarse y verifica: la contraseña que vale es la SUYA
    await pasarEspera(email);
    const de = e.sinSesion();
    assert.equal((await de.post('/api/auth/registro', { nombre: 'Víctima', email, password: 'claveVictima1', ...DATOS_LEGALES })).status, 202);
    assert.equal((await de.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'claveAtacante1' })).status, 401);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'claveVictima1' })).status, 200);
    assert.equal((await doc(email)).nombre, 'Víctima');
});

test('el mismo navegador que repite el registro retoma la verificación sin otro correo', async () => {
    const { c, email } = await registrarSinVerificar();
    const r = await c.post('/api/auth/registro', { nombre: 'Ana Corregida', email, password: 'claveNueva22', ...DATOS_LEGALES });
    assert.equal(r.status, 202);
    assert.equal(e.smtp.paraCorreo(email).length, 1);
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'claveNueva22' })).status, 200);
    assert.equal((await doc(email)).nombre, 'Ana Corregida');
});

test('abandona y vuelve: iniciar sesión sin verificar NO da sesión y retoma la verificación (reutiliza el código vigente)', async () => {
    const { email } = await registrarSinVerificar();
    const otroDia = e.sinSesion();
    assert.equal((await otroDia.post('/api/auth/login', { email, password: 'malaClave99' })).status, 401, 'contraseña mala: lo de siempre');
    const r = await otroDia.post('/api/auth/login', { email, password: 'clave1234' });
    assert.equal(r.status, 403);
    assert.equal(r.data.codigo, 'verificacion_pendiente');
    assert.equal(r.data.verificacion.codigoActivo, true);
    assert.equal(e.smtp.paraCorreo(email).length, 1, 'el código vigente se reutiliza');
    assert.equal(await tieneSesion(otroDia), false);
    const estado = await otroDia.get('/api/auth/verificacion');
    assert.equal(estado.status, 200); assert.match(estado.data.verificacion.emailOculto, /\*\*\*@prueba\.co$/);
    assert.equal((await otroDia.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
    assert.equal(await tieneSesion(otroDia), true);
});

test('abandona y vuelve con el código caducado: al iniciar sesión se envía uno nuevo', async () => {
    const { email } = await registrarSinVerificar();
    await Usuario.updateOne({ email }, { $set: { 'verificacionEmail.expira': new Date(Date.now() - 1000), 'verificacionEmail.ultimoEnvio': new Date(Date.now() - 20 * 60_000) } });
    const c = e.sinSesion();
    const r = await c.post('/api/auth/login', { email, password: 'clave1234' });
    assert.equal(r.status, 403);
    assert.equal(e.smtp.paraCorreo(email).length, 2);
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
    assert.equal((await e.sinSesion().get('/api/auth/verificacion')).status, 404, 'sin cookie no hay estado que consultar');
});

test('error del servidor SMTP: mensaje claro, sin sesión, y reenviar funciona sin esperar en cuanto el correo vuelve', async () => {
    for (const modo of ['rechazar', 'desconectar']) {
        e.smtp.fallar(modo);
        const errores = [];
        const original = console.error;
        console.error = (...a) => errores.push(a.join(' '));
        let r, c, email;
        try { ({ r, c, email } = await registrarSinVerificar()); } finally { console.error = original; e.smtp.fallar(null); }
        assert.equal(r.status, 503, modo);
        assert.equal(r.data.codigo, 'correo_no_enviado');
        assert.match(r.data.error, /No pudimos enviar el correo/);
        assert.equal(r.data.verificacion.reenviarEnSegundos, 0);
        assert.ok(errores.length && errores.every((l) => !l.includes(email) && !/\d{6}/.test(l.replace(/\(\w+\)/, ''))), 'el log no muestra el correo ni el código');
        assert.equal(await tieneSesion(c), false);
        const re = await c.post('/api/auth/reenviar-codigo');
        assert.equal(re.status, 200, modo);
        assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200, modo);
    }
});

test('producción sin SMTP: el registro queda desactivado (no se finge un envío ni se crea la cuenta)', async () => {
    await conEntorno({ NODE_ENV: 'production', SMTP_HOST: '' }, async () => {
        const email = correo();
        const r = await e.sinSesion().post('/api/auth/registro', { nombre: 'Sin correo', email, password: 'clave1234', ...DATOS_LEGALES });
        assert.equal(r.status, 503);
        assert.equal(r.data.codigo, 'correo_no_disponible');
        assert.equal(await Usuario.countDocuments({ email }), 0);
    });
});

test('cuentas anteriores a la v3.10: «permitir» conserva el acceso sin marcarlas como verificadas; «exigir» las verifica al entrar', async () => {
    const email = correo();
    const id = crypto.randomBytes(12).toString('hex');
    await Usuario.collection.insertOne({ id, nombre: 'Antigua', email, passwordHash: await hashPassword('clave1234'), creado: new Date('2026-01-10') });
    const c = e.sinSesion();
    assert.equal((await c.post('/api/auth/login', { email, password: 'clave1234' })).status, 200);
    assert.equal(await tieneSesion(c), true);
    assert.equal((await doc(email)).emailVerificado, undefined, 'no se marca como verificada sin verificar');
    await conEntorno({ VERIFICACION_CUENTAS_ANTIGUAS: 'exigir' }, async () => {
        assert.equal(await tieneSesion(c), false, 'la sesión existente deja de valer hasta verificar');
        const r = await c.post('/api/auth/login', { email, password: 'clave1234' });
        assert.equal(r.status, 403);
        assert.equal(r.data.codigo, 'verificacion_pendiente');
        assert.equal(e.smtp.paraCorreo(email).length, 1);
        const d = await doc(email);
        assert.equal(d.pendienteHasta, undefined, 'una cuenta antigua nunca entra en la limpieza de registros abandonados');
        assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
        assert.equal(await tieneSesion(c), true);
        assert.equal((await doc(email)).emailVerificado, true);
    });
});

test('el servidor no acepta una sesión de una cuenta sin verificar aunque alguien la fabrique', async () => {
    const { email } = await registrarSinVerificar();
    const token = crypto.randomBytes(32).toString('base64url');
    const { id } = await doc(email);
    await db.crearSesionBD({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: id, expira: new Date(Date.now() + 3600_000) });
    const r = await e.sinSesion().get('/api/actividades', { cabeceras: { cookie: `lt_sid=${token}` } });
    assert.equal(r.status, 401);
    const p = await e.sinSesion().get('/panel', { cabeceras: { cookie: `lt_sid=${token}` } });
    assert.equal(p.status, 302);
});

test('ni el código ni su hash ni el token aparecen en los logs del servidor', async () => {
    const lineas = [];
    const originales = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(originales)) console[k] = (...a) => { lineas.push(a.map(String).join(' ')); };
    let codigo, cookie, hash;
    try {
        const { c, email } = await registrarSinVerificar();
        codigo = e.smtp.codigoPara(email);
        cookie = c.cookies().get('lt_verif');
        hash = (await doc(email)).verificacionEmail.codigoHash;
        await c.post('/api/auth/verificar-correo', { codigo: codigo === '111111' ? '222222' : '111111' });
        await c.post('/api/auth/verificar-correo', { codigo });
    } finally { Object.assign(console, originales); }
    const todo = lineas.join('\n');
    assert.ok(!todo.includes(codigo) && !todo.includes(cookie) && !todo.includes(hash.split('$').at(-1)));
});

test('límites por IP de verificación y reenvío', async () => {
    const app = await e.otraApp({ limites: { verificacion: 3, reenvio: 2 } });
    try {
        const email = correo();
        const { crearCliente } = await import('../utilidades/entorno.js');
        const cli = crearCliente(app.base, e.smtp);
        assert.equal((await cli.post('/api/auth/registro', { nombre: 'Límite', email, password: 'clave1234', ...DATOS_LEGALES })).status, 202);
        const estados = [];
        for (let i = 0; i < 4; i++) estados.push((await cli.post('/api/auth/verificar-correo', { codigo: 'abcdef' })).status);   // formato malo (400) también cuenta
        assert.deepEqual(estados, [400, 400, 400, 429]);
        const reenvios = [];
        for (let i = 0; i < 3; i++) reenvios.push((await cli.post('/api/auth/reenviar-codigo')).status);
        assert.equal(reenvios.at(-1), 429);
    } finally { await app.cerrar(); }
});
