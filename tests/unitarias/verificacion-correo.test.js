// v3.10 · Piezas puras de la verificación del correo: generación y hash del código, correo oculto, reglas de acceso,
// espera y máximo de envíos, configuración acotada y plantilla del correo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    generarCodigo, esCodigoValido, hashCodigo, codigoCoincide, ocultarEmail, puedeEntrar, permisoEnvio,
    configVerificacion, estadoPublico, nuevoTokenVerificacion, hashToken
} from '../../backend/servicios/cuenta/verificacion-correo.js';
import { correoVerificacion } from '../../backend/servicios/cuenta/plantilla-verificacion.js';
import { configCorreo } from '../../backend/servicios/cuenta/correo.js';

test('generarCodigo: siempre 6 dígitos (con ceros a la izquierda) y repartidos por todo el rango', () => {
    const muestra = Array.from({ length: 3000 }, generarCodigo);
    assert.ok(muestra.every((c) => /^\d{6}$/.test(c)));
    assert.ok(new Set(muestra).size > 2950, 'sin repeticiones sospechosas');
    const primeros = new Set(muestra.map((c) => c[0]));
    assert.equal(primeros.size, 10, 'aparecen todos los dígitos iniciales (incluido 0)');
});

test('esCodigoValido: solo cadenas de exactamente 6 dígitos', () => {
    assert.ok(esCodigoValido('012345'));
    for (const malo of ['12345', '1234567', '12a456', 123456, null, undefined, { $ne: 1 }, '١٢٣٤٥٦']) assert.equal(esCodigoValido(malo), false, String(malo));
});

test('hashCodigo: scrypt con sal (dos hashes del mismo código difieren) y ligado al usuario', async () => {
    const h1 = await hashCodigo('482913', 'usuarioA');
    const h2 = await hashCodigo('482913', 'usuarioA');
    assert.match(h1, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.notEqual(h1, h2);
    assert.ok(!h1.includes('482913'));
    assert.equal(await codigoCoincide('482913', h1, 'usuarioA'), true);
    assert.equal(await codigoCoincide('482914', h1, 'usuarioA'), false);
    assert.equal(await codigoCoincide('482913', h1, 'usuarioB'), false, 'el hash de una cuenta no sirve en otra');
    for (const basura of [null, '', 'sha256$x$y', 'scrypt$$', `scrypt$${'A'.repeat(24)}$corto`]) assert.equal(await codigoCoincide('482913', basura, 'usuarioA'), false);
});

test('token de verificación: aleatorio y solo se guarda su SHA-256', () => {
    const a = nuevoTokenVerificacion(), b = nuevoTokenVerificacion();
    assert.notEqual(a.token, b.token);
    assert.equal(a.tokenHash, hashToken(a.token));
    assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(!a.tokenHash.includes(a.token));
});

test('ocultarEmail: muestra como mucho 4 caracteres y nunca más de la mitad', () => {
    assert.equal(ocultarEmail('usuario.prueba@gmail.com'), 'usua***@gmail.com');
    assert.equal(ocultarEmail('ana@x.co'), 'a***@x.co');
    assert.equal(ocultarEmail('jo@x.co'), 'j***@x.co');
    assert.equal(ocultarEmail('a@x.co'), 'a***@x.co');
    assert.equal(ocultarEmail('sin-arroba'), '***');
});

test('puedeEntrar: verificada sí, pendiente no, antigua según VERIFICACION_CUENTAS_ANTIGUAS', () => {
    const permitir = configVerificacion({});
    const exigir = configVerificacion({ VERIFICACION_CUENTAS_ANTIGUAS: 'EXIGIR' });
    assert.equal(puedeEntrar({ emailVerificado: true }, exigir), true);
    assert.equal(puedeEntrar({ emailVerificado: false }, permitir), false);
    assert.equal(puedeEntrar({}, permitir), true);
    assert.equal(puedeEntrar({ emailVerificado: null }, permitir), true);
    assert.equal(puedeEntrar({}, exigir), false);
    assert.equal(puedeEntrar(null, permitir), false);
    assert.equal(configVerificacion({ VERIFICACION_CUENTAS_ANTIGUAS: 'cualquier cosa' }).cuentasAntiguas, 'permitir');
});

test('configuración: valores por defecto y acotados (un .env exagerado no desactiva la protección)', () => {
    assert.deepEqual(configVerificacion({}), { minutos: 10, maxIntentos: 5, esperaReenvioS: 60, maxEnviosHora: 5, cuentasAntiguas: 'permitir' });
    const raro = configVerificacion({ OTP_EXPIRATION_MINUTES: '9999', OTP_MAX_ATTEMPTS: '1000', OTP_RESEND_COOLDOWN_SECONDS: '0', OTP_MAX_SENDS_PER_HOUR: '-3' });
    assert.deepEqual(raro, { minutos: 60, maxIntentos: 10, esperaReenvioS: 10, maxEnviosHora: 1, cuentasAntiguas: 'permitir' });
    assert.equal(configVerificacion({ OTP_EXPIRATION_MINUTES: 'abc' }).minutos, 10);
});

test('permisoEnvio: espera entre envíos y máximo por hora (la ventana se reinicia pasada la hora)', () => {
    const cfg = configVerificacion({});
    const ahora = Date.parse('2026-11-14T12:00:00Z');
    assert.deepEqual(permisoEnvio(null, ahora, cfg), { permitido: true, enviosDesde: new Date(ahora), envios: 1 });
    const reciente = { ultimoEnvio: new Date(ahora - 20_000), enviosDesde: new Date(ahora - 20_000), envios: 1 };
    assert.deepEqual(permisoEnvio(reciente, ahora, cfg), { permitido: false, motivo: 'espera', esperaS: 40 });
    const lleno = { ultimoEnvio: new Date(ahora - 120_000), enviosDesde: new Date(ahora - 600_000), envios: 5 };
    assert.deepEqual(permisoEnvio(lleno, ahora, cfg), { permitido: false, motivo: 'limite', esperaS: 3000 });
    const viejo = { ultimoEnvio: new Date(ahora - 7200_000), enviosDesde: new Date(ahora - 7200_000), envios: 5 };
    assert.equal(permisoEnvio(viejo, ahora, cfg).envios, 1);
});

test('estadoPublico: solo lo que necesita la pantalla (nada de hashes ni tokens)', () => {
    const ahora = Date.parse('2026-11-14T12:00:00Z');
    const estado = estadoPublico({ email: 'maria.lopez@correo.com', verificacionEmail: { codigoHash: 'scrypt$x$y', tokenHash: 'abc', expira: new Date(ahora + 300_000), ultimoEnvio: new Date(ahora - 30_000), intentos: 2 } }, ahora, configVerificacion({}));
    assert.deepEqual(estado, { emailOculto: 'mari***@correo.com', codigoActivo: true, expiraEnSegundos: 300, reenviarEnSegundos: 30, intentosRestantes: 3, minutosValidez: 10 });
});

test('plantilla del correo: título, código destacado, caducidad, aviso de seguridad, versión de texto y nombre escapado', () => {
    const { asunto, texto, html } = correoVerificacion({ nombre: '<b>Ana</b>', codigo: '048213', minutos: 10 });
    assert.equal(asunto, 'Verifica tu correo en LearnTrack');
    assert.match(html, /<h1[^>]*>Verifica tu dirección de correo<\/h1>/);
    assert.equal((html.match(/>\d<\/div><\/td>/g) ?? []).length, 6, 'seis casillas con los dígitos');
    assert.match(html, /El código expira en 10 minutos/);
    assert.match(html, /puedes ignorar este mensaje/);
    assert.match(html, /max-width:560px/);
    assert.ok(!html.includes('<b>Ana</b>') && html.includes('&lt;b&gt;Ana&lt;/b&gt;'), 'el nombre se escapa');
    assert.ok(!/<script|https?:\/\/[^"'\s]+\.(png|jpe?g|gif)/i.test(html), 'sin scripts ni imágenes remotas');
    assert.match(texto, /Tu código de verificación es: 048213/);
    assert.match(texto, /expira en 10 minutos/);
});

test('configCorreo: SMTP desde el entorno; en producción sin SMTP no hay correo, y sin TLS directo se exige STARTTLS', () => {
    assert.equal(configCorreo({}).modo, 'archivo');
    assert.equal(configCorreo({ NODE_ENV: 'production' }).modo, 'no_configurado');
    const p = configCorreo({ NODE_ENV: 'production', SMTP_HOST: 'smtp.ejemplo.com', SMTP_USER: 'yo@ejemplo.com', SMTP_PASS: 'x' });
    assert.equal(p.modo, 'smtp'); assert.equal(p.port, 587); assert.equal(p.requireTLS, true); assert.equal(p.remitente, 'LearnTrack <yo@ejemplo.com>');
    const tls = configCorreo({ SMTP_HOST: 'smtp.ejemplo.com', SMTP_SECURE: 'true' });
    assert.equal(tls.port, 465); assert.equal(tls.secure, true); assert.equal(tls.requireTLS, false);
});
