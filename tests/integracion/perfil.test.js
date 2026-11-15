// Perfil de usuario: lectura/edición parcial, contraseña, tema, avatar, cuentas vinculadas y baja de cuenta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, actividadBase } from '../utilidades/entorno.js';
import { detectarImagen } from '../../backend/servicios/cuenta/imagenes.js';

let e;
before(async () => { e = await iniciarEntorno({ limites: { perfilSensible: 100 } }); });
after(async () => { await e.cerrar(); });

// PNG mínimo válido de 1×1 (firma + IHDR + IDAT + IEND)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('sin sesión: todas las rutas de perfil dan 401 y la página redirige', async () => {
    const s = e.sinSesion();
    for (const [m, r] of [['get', '/api/perfil'], ['put', '/api/perfil'], ['post', '/api/perfil/vincular'], ['del', '/api/perfil'], ['get', '/api/perfil/avatar'], ['put', '/api/perfil/avatar'], ['del', '/api/perfil/vincular/spotify']]) {
        assert.equal((await s[m](r)).status, 401, `${m} ${r}`);
    }
    const p = await s.get('/configuracion');
    assert.equal(p.status, 302);
    // v3.11: /perfil es otra vez una página privada (Información básica y Privacidad): sin sesión → /login
    const perfil = await s.get('/perfil');
    assert.equal(perfil.status, 302);
    assert.equal(perfil.headers.get('location'), '/login');
    assert.equal((await s.get('/perfil.html')).headers.get('location'), '/perfil', 'la dirección de v3.1 sigue funcionando');
    // 3.7.0 eliminó el frontend clásico: su código (/app/...) ya no se sirve a nadie, y el código privado de React
    // (Configuración incluida) está en /r/privado, que exige sesión (detalle en frontend-react.test.js)
    for (const r of ['/app/configuracion/configuracion.js', '/app/comun/temas.css']) assert.notEqual((await s.get(r)).status, 200, r);
    assert.equal((await s.get('/r/privado/Configuracion.js')).status, 401);
});

test('GET /api/perfil: valores por defecto, sin hash de contraseña', async () => {
    const c = await e.cliente('Ana Pérez');
    const r = await c.get('/api/perfil');
    assert.equal(r.status, 200);
    const p = r.data.perfil;
    assert.equal(p.nombre, 'Ana Pérez');
    assert.equal(p.temaSeleccionado, 'tech-focus');
    assert.equal(p.notificacionesActivas, true);
    assert.deepEqual(p.preferenciasNotificaciones, { alertasTareas: true, recordatoriosIA: true });
    for (const s of ['youtube', 'github', 'discord', 'spotify', 'steam', 'xbox']) assert.equal(p.cuentasVinculadas[s].vinculada, false);
    assert.equal(p.avatarUrl, null);
    assert.ok(!JSON.stringify(r.data).includes('passwordHash') && !JSON.stringify(r.data).includes('scrypt'));
    assert.deepEqual(r.data.temas, ['tech-focus', 'moderno', 'oscuro-profundo', 'futurista', 'zen-calm', 'oscuro', 'personalizado']);
});

test('PUT /api/perfil es un parche: cambiar el tema no toca nombre, correo ni preferencias', async () => {
    const c = await e.cliente('Luis Gómez');
    await c.put('/api/perfil', { notificacionesActivas: false });
    const r = await c.put('/api/perfil', { temaSeleccionado: 'oscuro' });
    assert.equal(r.status, 200);
    assert.equal(r.data.perfil.temaSeleccionado, 'oscuro');
    assert.equal(r.data.perfil.nombre, 'Luis Gómez');
    assert.equal(r.data.perfil.notificacionesActivas, false);
    assert.equal((await c.get('/api/auth/me')).data.usuario.temaSeleccionado, 'oscuro');
    // preferencias finas: solo la enviada
    const p = await c.put('/api/perfil', { preferenciasNotificaciones: { recordatoriosIA: false } });
    assert.deepEqual(p.data.perfil.preferenciasNotificaciones, { alertasTareas: true, recordatoriosIA: false });
});

test('PUT /api/perfil rechaza datos inválidos', async () => {
    const c = await e.cliente();
    for (const cuerpo of [{ temaSeleccionado: 'rosa' }, { temaSeleccionado: { $ne: 1 } }, { nombre: 'A' }, { nombre: '<b>x</b>' }, { notificacionesActivas: 'si' },
        { preferenciasNotificaciones: { alertasTareas: 1 } }, {}, { email: 'no-es-correo', passwordActual: 'clave1234' }, [], 'texto']) {
        const r = await c.put('/api/perfil', cuerpo);
        assert.equal(r.status, 400, JSON.stringify(cuerpo));
    }
});

test('cambiar correo o contraseña exige la contraseña actual correcta', async () => {
    const c = await e.cliente();
    assert.equal((await c.put('/api/perfil', { email: 'nuevo@prueba.co' })).status, 400);
    assert.equal((await c.put('/api/perfil', { email: 'nuevo@prueba.co', passwordActual: 'incorrecta1' })).status, 403);
    assert.equal((await c.put('/api/perfil', { passwordNueva: 'otraclave99', passwordActual: 'incorrecta1' })).status, 403);
    assert.equal((await c.put('/api/perfil', { passwordNueva: 'corta', passwordActual: 'clave1234' })).status, 400);
    assert.equal((await c.put('/api/perfil', { passwordNueva: 'clave1234', passwordActual: 'clave1234' })).status, 400);
    const ok = await c.put('/api/perfil', { email: `Nuevo${Date.now()}@Prueba.co`, passwordActual: 'clave1234' });
    assert.equal(ok.status, 200);
    assert.match(ok.data.perfil.email, /^nuevo\d+@prueba\.co$/);
});

test('correo duplicado → 409; contraseña nueva funciona y cierra las demás sesiones', async () => {
    const a = await e.cliente(); const b = await e.cliente();
    const dup = await b.put('/api/perfil', { email: a.usuario.email, passwordActual: 'clave1234' });
    assert.equal(dup.status, 409);

    // segunda sesión del mismo usuario
    const otra = e.sinSesion();
    const login = await otra.post('/api/auth/login', { email: b.usuario.email, password: 'clave1234' });
    assert.equal(login.status, 200);
    assert.equal((await otra.get('/api/perfil')).status, 200);

    const r = await b.put('/api/perfil', { passwordNueva: 'nuevaClave77', passwordActual: 'clave1234' });
    assert.equal(r.status, 200); assert.equal(r.data.passwordCambiada, true);
    assert.equal((await b.get('/api/perfil')).status, 200, 'la sesión actual sigue abierta');
    assert.equal((await otra.get('/api/perfil')).status, 401, 'la otra sesión se cerró');
    assert.equal((await e.sinSesion().post('/api/auth/login', { email: b.usuario.email, password: 'clave1234' })).status, 401);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email: b.usuario.email, password: 'nuevaClave77' })).status, 200);
});

test('inyección NoSQL en el perfil no modifica a otros usuarios', async () => {
    const a = await e.cliente('Alguien'); const b = await e.cliente('Otra Persona');
    const r = await b.put('/api/perfil', { nombre: { $ne: null }, id: a.usuario.id, email: { $gt: '' }, passwordActual: { $ne: '' } });
    assert.equal(r.status, 400);
    assert.equal((await a.get('/api/perfil')).data.perfil.nombre, 'Alguien');
});

test('avatar: subir, servir, rechazar no-imágenes/SVG/tipos falsos/demasiado grande, y quitar', async () => {
    const c = await e.cliente();
    const subir = (cuerpo, tipo) => c.crudo('PUT', '/api/perfil/avatar', cuerpo, { cabeceras: { 'content-type': tipo } });
    assert.equal((await subir(PNG, 'image/png')).status, 200);
    const perfil = (await c.get('/api/perfil')).data.perfil;
    assert.match(perfil.avatarUrl, /^\/api\/perfil\/avatar\?v=\d+$/);
    const img = await c.crudo('GET', perfil.avatarUrl);
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');

    assert.equal((await subir(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png')).status, 415);
    assert.equal((await subir(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status, 415);
    assert.equal((await subir(PNG, 'image/jpeg')).status, 415, 'el tipo declarado debe coincidir con la firma');
    assert.equal((await subir(Buffer.from('GIF89a...........'), 'image/png')).status, 415);
    const grande = Buffer.concat([PNG, Buffer.alloc(201 * 1024)]);
    assert.equal((await subir(grande, 'image/png')).status, 413);
    assert.equal((await c.get('/api/perfil')).data.perfil.avatarUrl, perfil.avatarUrl, 'los rechazos no cambian la foto');

    const del = await c.del('/api/perfil/avatar');
    assert.equal(del.status, 200); assert.equal(del.data.perfil.avatarUrl, null);
    assert.equal((await c.get('/api/perfil/avatar')).status, 404);
});

test('el avatar de un usuario no lo ve otro', async () => {
    const a = await e.cliente(); const b = await e.cliente();
    await a.crudo('PUT', '/api/perfil/avatar', PNG, { cabeceras: { 'content-type': 'image/png' } });
    assert.equal((await b.get('/api/perfil/avatar')).status, 404);
});

test('detectarImagen reconoce JPEG, PNG y WebP por su firma', () => {
    assert.equal(detectarImagen(PNG), 'image/png');
    assert.equal(detectarImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
    assert.equal(detectarImagen(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
    assert.equal(detectarImagen(Buffer.from('<html>............')), null);
    assert.equal(detectarImagen(null), null);
});

test('vincular / desvincular cuentas (modo simulado) y validación del servicio', async () => {
    const c = await e.cliente();
    for (const malo of [{}, { servicio: 'facebook' }, { servicio: { $ne: 1 } }, { servicio: '__proto__' }]) {
        assert.equal((await c.post('/api/perfil/vincular', malo)).status, 400, JSON.stringify(malo));
    }
    const r = await c.post('/api/perfil/vincular', { servicio: 'spotify' });
    assert.equal(r.status, 201);
    assert.equal(r.data.perfil.cuentasVinculadas.spotify.vinculada, true);
    assert.ok(r.data.perfil.cuentasVinculadas.spotify.vinculadaEn);
    assert.equal(r.data.perfil.cuentasVinculadas.youtube.vinculada, false);
    assert.equal(r.data.vinculacion.tipo, 'simulada');
    assert.equal(r.data.integraciones.modo, 'simulado');
    const d = await c.del('/api/perfil/vincular/spotify');
    assert.equal(d.status, 200); assert.equal(d.data.perfil.cuentasVinculadas.spotify.vinculada, false);
    assert.equal((await c.del('/api/perfil/vincular/otro')).status, 400);
});

test('con INTEGRACIONES_MODO=desactivado no se puede vincular (501), sin fingir éxito', async () => {
    const antes = process.env.INTEGRACIONES_MODO;
    process.env.INTEGRACIONES_MODO = 'desactivado';
    try {
        const c = await e.cliente();
        const r = await c.post('/api/perfil/vincular', { servicio: 'discord' });
        assert.equal(r.status, 501);
        assert.equal((await c.get('/api/perfil')).data.perfil.cuentasVinculadas.discord.vinculada, false);
    } finally { if (antes === undefined) delete process.env.INTEGRACIONES_MODO; else process.env.INTEGRACIONES_MODO = antes; }
});

test('eliminar cuenta: exige contraseña y ELIMINAR; borra todos los datos y cierra la sesión', async () => {
    const c = await e.cliente(); const otro = await e.cliente();
    await c.post('/api/actividades', actividadBase({ titulo: 'Mía' }));
    await otro.post('/api/actividades', actividadBase({ titulo: 'De otro' }));
    await c.crudo('PUT', '/api/perfil/avatar', PNG, { cabeceras: { 'content-type': 'image/png' } });

    const borrar = (cuerpo) => c.crudo('DELETE', '/api/perfil', JSON.stringify(cuerpo));
    assert.equal((await borrar({ password: 'clave1234' })).status, 400);
    assert.equal((await borrar({ password: 'clave1234', confirmacion: 'eliminar' })).status, 400);
    assert.equal((await borrar({ password: 'mala12345', confirmacion: 'ELIMINAR' })).status, 403);
    assert.equal((await c.get('/api/perfil')).status, 200, 'sigue existiendo');

    const ok = await borrar({ password: 'clave1234', confirmacion: 'ELIMINAR' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal((await c.get('/api/perfil')).status, 401);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email: c.usuario.email, password: 'clave1234' })).status, 401);
    const m = (await import('../../backend/datos/index.js')).modelos;
    assert.equal(await m.Actividad.countDocuments({ userId: c.usuario.id }), 0);
    assert.equal(await m.Avatar.countDocuments({ userId: c.usuario.id }), 0);
    assert.equal(await m.Usuario.countDocuments({ id: c.usuario.id }), 0);
    // los datos de otro usuario siguen intactos
    assert.equal((await otro.get('/api/actividades')).data.length, 1);
});

test('usuarios anteriores a v3.1 (sin campos nuevos) reciben valores por defecto', async () => {
    const { modelos } = await import('../../backend/datos/index.js');
    const c = await e.cliente();
    await modelos.Usuario.collection.updateOne({ id: c.usuario.id }, { $unset: { temaSeleccionado: '', cuentasVinculadas: '', notificacionesActivas: '', preferenciasNotificaciones: '', avatarActualizado: '' } });
    const p = (await c.get('/api/perfil')).data.perfil;
    assert.equal(p.temaSeleccionado, 'tech-focus'); assert.equal(p.notificacionesActivas, true);
    assert.equal(p.cuentasVinculadas.youtube.vinculada, false);
    assert.equal((await c.get('/api/auth/me')).data.usuario.temaSeleccionado, 'tech-focus');
    assert.equal((await c.put('/api/perfil', { temaSeleccionado: 'zen-calm' })).data.perfil.temaSeleccionado, 'zen-calm');
});

test('límite de intentos fallidos de contraseña en acciones sensibles', async () => {
    const o = await e.otraApp({ limites: { perfilSensible: 3 } });
    try {
        const c = await o.cliente();
        for (let i = 0; i < 3; i++) assert.equal((await c.put('/api/perfil', { email: 'x@prueba.co', passwordActual: 'mala12345' })).status, 403);
        assert.equal((await c.put('/api/perfil', { email: 'x@prueba.co', passwordActual: 'clave1234' })).status, 429);
    } finally { await o.cerrar(); }
});
