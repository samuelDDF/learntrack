// Administrador ÚNICO y panel de administración (v3.13), por la API y con el script real:
//  · el script crea UN administrador (contraseña por la entrada estándar, nunca en argumentos ni variables);
//  · nadie puede crear un segundo (ni el script ni una inserción directa en la base de datos);
//  · el rol no se puede obtener desde el registro ni el perfil; un usuario normal recibe 404 en /api/admin;
//  · suspender cierra las sesiones e impide entrar; reactivar lo devuelve; una suspensión temporal vence sola;
//  · eliminar exige reescribir el correo y borra todos los datos; el administrador no puede tocarse a sí mismo;
//  · la auditoría no guarda contraseñas, tokens ni el correo de una cuenta eliminada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarEntorno, DATOS_LEGALES } from '../utilidades/entorno.js';
import Usuario from '../../backend/modelos/Usuario.js';
import Sesion from '../../backend/modelos/Sesion.js';
import Actividad from '../../backend/modelos/Actividad.js';
import Auditoria from '../../backend/modelos/Auditoria.js';
import { errorPasswordAdmin } from '../../backend/validacion/admin.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLAVE_ADMIN = 'Cl4ve-Admin-Segura!';
const EMAIL_ADMIN = 'admin.privado@prueba.co';
let e, admin;

/** Ejecuta scripts/admin.js con la contraseña por la entrada estándar (como haría una persona, pero sin terminal) */
function script(accion, { email = EMAIL_ADMIN, entrada = `${CLAVE_ADMIN}\n${CLAVE_ADMIN}\n` } = {}) {
    return new Promise((ok) => {
        const p = spawn(process.execPath, [path.join(raiz, 'scripts', 'admin.js'), accion], {
            cwd: raiz, env: { PATH: process.env.PATH, MONGO_URI: e.bd.uri, ADMIN_EMAIL: email }, stdio: ['pipe', 'pipe', 'pipe']
        });
        let salida = '';
        p.stdout.on('data', (d) => { salida += d; });
        p.stderr.on('data', (d) => { salida += d; });
        p.on('close', (codigo) => ok({ codigo, salida }));
        p.stdin.end(entrada);
    });
}
const conOrigen = () => ({ cabeceras: { origin: e.base } });
async function entrarComoAdmin() {
    const c = e.sinSesion();
    const r = await c.post('/api/auth/login', { email: EMAIL_ADMIN, password: CLAVE_ADMIN });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return c;
}

before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

test('script: contraseña débil o distinta → no crea nada; con una válida crea UN administrador (solo el hash)', async () => {
    assert.match(errorPasswordAdmin('corta1A!', EMAIL_ADMIN), /14 caracteres/);
    assert.match(errorPasswordAdmin('solominusculas1234', EMAIL_ADMIN), /tres de/);
    assert.match(errorPasswordAdmin('Admin.Privado-2026', EMAIL_ADMIN), /correo/);
    assert.equal(errorPasswordAdmin(CLAVE_ADMIN, EMAIL_ADMIN), null);

    const debil = await script('crear', { entrada: 'clave1234\nclave1234\n' });
    assert.notEqual(debil.codigo, 0);
    const distinta = await script('crear', { entrada: `${CLAVE_ADMIN}\n${CLAVE_ADMIN}x\n` });
    assert.notEqual(distinta.codigo, 0);
    assert.equal(await Usuario.countDocuments({ rol: 'admin' }), 0);

    const r = await script('crear');
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.salida, /Administrador creado/);
    assert.doesNotMatch(r.salida, new RegExp(CLAVE_ADMIN.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')), 'la contraseña nunca se imprime');
    admin = await Usuario.findOne({ rol: 'admin' }).lean();
    assert.equal(admin.email, EMAIL_ADMIN);
    assert.match(admin.passwordHash, /^scrypt\$/);
    assert.equal(admin.emailVerificado, true);
    const v = await script('verificar');
    assert.equal(v.codigo, 0, v.salida);
    assert.match(v.salida, /exactamente un administrador/);
});

test('no puede existir un segundo administrador: ni con el script, ni con otro correo, ni insertándolo en la base de datos', async () => {
    const otraVez = await script('crear', { email: 'otro.admin@prueba.co' });
    assert.equal(otraVez.codigo, 2, otraVez.salida);
    assert.match(otraVez.salida, /Ya existe un administrador/);
    await assert.rejects(Usuario.collection.insertOne({ id: 'f'.repeat(24), nombre: 'Intruso', email: 'intruso@prueba.co', passwordHash: 'x', rol: 'admin' }), /E11000|duplicate/);
    assert.equal(await Usuario.countDocuments({ rol: 'admin' }), 1);
    // El rol es inmutable para Mongoose: ni siquiera el código del servidor puede convertir a alguien en admin
    const normal = await e.cliente('Normal');
    await Usuario.updateOne({ id: normal.usuario.id }, { $set: { rol: 'admin' } }).catch(() => {});
    assert.equal((await Usuario.findOne({ id: normal.usuario.id }).lean()).rol, 'usuario');
});

test('escalamiento de privilegios: el registro y el perfil ignoran «rol», y un usuario normal no ve /api/admin (404)', async () => {
    const anon = e.sinSesion();
    const email = `escala${Date.now()}@prueba.co`;
    const r = await anon.post('/api/auth/registro', { nombre: 'Escala', email, password: 'clave1234', ...DATOS_LEGALES, rol: 'admin', estado: 'activa', emailVerificado: true });
    assert.equal(r.status, 202);
    assert.equal((await Usuario.findOne({ email }).lean()).rol, 'usuario');

    const c = await e.cliente('Curioso');
    const p = await c.put('/api/perfil', { nombre: 'Curioso', rol: 'admin' });
    assert.ok([200, 400].includes(p.status));
    assert.equal((await Usuario.findOne({ id: c.usuario.id }).lean()).rol, 'usuario');
    const me = await c.get('/api/auth/me');
    assert.equal('esAdmin' in me.data.usuario, false, 'un usuario normal no recibe ningún campo de rol');
    assert.equal('rol' in me.data.usuario, false);

    for (const [metodo, ruta] of [['GET', '/api/admin/resumen'], ['GET', '/api/admin/cuentas'], ['GET', `/api/admin/cuentas/${admin.id}`], ['POST', `/api/admin/cuentas/${c.usuario.id}/suspender`], ['DELETE', `/api/admin/cuentas/${c.usuario.id}`], ['GET', '/api/admin/auditoria']]) {
        const res = await c.crudo(metodo, ruta, metodo === 'GET' ? undefined : { motivo: 'probando', confirmacion: c.usuario.email }, conOrigen());
        assert.equal(res.status, 404, `${metodo} ${ruta}`);
        assert.deepEqual(await res.json(), { error: 'Ruta no encontrada.' }, 'misma respuesta que una ruta inexistente');
    }
    assert.equal((await e.sinSesion().get('/api/admin/cuentas')).status, 404);
    // La página /admin tampoco existe para él (la 404 normal)
    assert.equal((await c.get('/admin')).status, 404);
});

test('cuenta de administración: sesión corta, sin funciones de usuario y no aparece en ningún listado', async () => {
    const a = await entrarComoAdmin();
    const sesion = await Sesion.findOne({ userId: admin.id }).sort({ expira: -1 }).lean();
    assert.ok(sesion.expira - Date.now() <= 8 * 3600 * 1000 + 5000, 'la sesión del administrador dura 8 horas');
    assert.equal((await a.get('/api/auth/me')).data.usuario.esAdmin, true);
    assert.equal((await a.get('/api/actividades')).status, 403);
    assert.equal((await a.get('/api/actividades')).data.codigo, 'solo_admin');
    assert.equal((await a.del('/api/perfil')).status, 403, 'no puede darse de baja desde el perfil');
    assert.equal((await a.get('/admin')).status, 200);
    const lista = await a.get('/api/admin/cuentas');
    assert.equal(lista.status, 200);
    assert.ok(lista.data.cuentas.length > 0);
    assert.ok(!lista.data.cuentas.some((c) => c.id === admin.id || c.email === EMAIL_ADMIN));
    assert.ok(lista.data.cuentas.every((c) => !('passwordHash' in c) && !('aceptacionesLegales' in c)));
    // Ni suspenderse ni eliminarse a sí mismo
    assert.equal((await a.post(`/api/admin/cuentas/${admin.id}/suspender`, { motivo: 'Me suspendo' }, conOrigen())).status, 404);
    assert.equal((await a.crudo('DELETE', `/api/admin/cuentas/${admin.id}`, { confirmacion: EMAIL_ADMIN, motivo: 'Me borro' }, conOrigen())).status, 404);
    assert.equal(await Usuario.countDocuments({ rol: 'admin', estado: 'activa' }), 1);
    const resumen = await a.get('/api/admin/resumen');
    assert.deepEqual(resumen.data.integridad, { administradores: 1, unico: true, indiceUnico: true });
    assert.ok((await Auditoria.countDocuments({ accion: 'inicio_sesion_admin' })) >= 1);
});

test('buscar y filtrar: por nombre, correo e id; por estado', async () => {
    const a = await entrarComoAdmin();
    const c = await e.cliente('Zuleima Buscable');
    const porNombre = await a.get('/api/admin/cuentas?q=zuleima');
    assert.deepEqual(porNombre.data.cuentas.map((x) => x.id), [c.usuario.id]);
    assert.equal((await a.get(`/api/admin/cuentas?q=${encodeURIComponent(c.usuario.email)}`)).data.cuentas[0].id, c.usuario.id);
    assert.equal((await a.get(`/api/admin/cuentas?q=${c.usuario.id}`)).data.cuentas[0].id, c.usuario.id);
    assert.equal((await a.get('/api/admin/cuentas?q=.*')).data.total, 0, 'la búsqueda no es una expresión regular');
    assert.equal((await a.get('/api/admin/cuentas?estado=raro')).status, 400);
    const detalle = await a.get(`/api/admin/cuentas/${c.usuario.id}`);
    assert.equal(detalle.status, 200);
    assert.deepEqual(Object.keys(detalle.data.cuenta.uso).sort(), ['actividades', 'checkins', 'proyectos', 'sesionesAbiertas', 'temasEstudio']);
    assert.equal(detalle.data.cuenta.documentos.terminos.version, DATOS_LEGALES.versiones.terminos);
    assert.ok(detalle.data.cuenta.ultimoAcceso, 'se registra el último acceso');
});

test('suspender: cierra sus sesiones, no puede entrar ni usar la API; reactivar lo devuelve; la temporal vence sola', async () => {
    const a = await entrarComoAdmin();
    const c = await e.cliente('Suspendible');
    const email = c.usuario.email;
    assert.equal((await c.get('/api/actividades')).status, 200);
    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/suspender`, { motivo: 'x' }, conOrigen())).status, 400, 'motivo obligatorio');
    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/suspender`, { motivo: 'Uso indebido del servicio' })).status, 403, 'sin cabecera Origin se rechaza');
    const s = await a.post(`/api/admin/cuentas/${c.usuario.id}/suspender`, { motivo: 'Uso indebido del servicio' }, conOrigen());
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.equal(s.data.cuenta.estado, 'suspendida');
    assert.equal(await Sesion.countDocuments({ userId: c.usuario.id }), 0, 'sesiones cerradas');
    assert.equal((await c.get('/api/actividades')).status, 401, 'la cookie que tenía ya no sirve');
    const login = await e.sinSesion().post('/api/auth/login', { email, password: 'clave1234' });
    assert.equal(login.status, 403);
    assert.equal(login.data.codigo, 'cuenta_suspendida');
    const mal = await e.sinSesion().post('/api/auth/login', { email, password: 'otraClave1' });
    assert.equal(mal.status, 401, 'con la contraseña equivocada no se revela que está suspendida');
    assert.equal((await a.get('/api/admin/cuentas?estado=suspendida')).data.cuentas.some((x) => x.id === c.usuario.id), true);

    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/reactivar`, {}, conOrigen())).status, 200);
    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/reactivar`, {}, conOrigen())).status, 409, 'ya estaba activa');
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'clave1234' })).status, 200);

    // Suspensión temporal: al vencer, entra de nuevo sin intervención
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/suspender`, { motivo: 'Pausa temporal', hasta: manana }, conOrigen())).status, 200);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'clave1234' })).status, 403);
    await Usuario.updateOne({ id: c.usuario.id }, { $set: { 'suspension.hasta': new Date(Date.now() - 1000) } });
    assert.equal((await e.sinSesion().post('/api/auth/login', { email, password: 'clave1234' })).status, 200);
    assert.equal((await Usuario.findOne({ id: c.usuario.id }).lean()).estado, 'activa');
    const acciones = await Auditoria.find({ cuentaId: c.usuario.id }).lean();
    assert.deepEqual(acciones.map((x) => x.accion).sort(), ['reactivar', 'suspender', 'suspender']);
    assert.equal(acciones.find((x) => x.accion === 'suspender').detalle.motivo, 'Uso indebido del servicio');
});

test('eliminar: exige reescribir el correo, borra todos sus datos y la auditoría no guarda su correo', async () => {
    const a = await entrarComoAdmin();
    const c = await e.cliente('Eliminable');
    await c.post('/api/actividades', { titulo: 'Tarea', tipo: 'estudio', exigencia: 2, horas: 1, fecha_inicio: '2026-12-01', fecha_fin: '2026-12-01' });
    assert.equal(await Actividad.countDocuments({ userId: c.usuario.id }), 1);
    const sinConfirmar = await a.crudo('DELETE', `/api/admin/cuentas/${c.usuario.id}`, { confirmacion: 'otro@prueba.co', motivo: 'Solicitud del titular' }, conOrigen());
    assert.equal(sinConfirmar.status, 400);
    assert.ok(await Usuario.exists({ id: c.usuario.id }), 'nada se borró');
    const ok = await a.crudo('DELETE', `/api/admin/cuentas/${c.usuario.id}`, { confirmacion: c.usuario.email.toUpperCase(), motivo: 'Solicitud del titular' }, conOrigen());
    assert.equal(ok.status, 200);
    assert.equal(await Usuario.exists({ id: c.usuario.id }), null);
    assert.equal(await Actividad.countDocuments({ userId: c.usuario.id }), 0);
    assert.equal(await Sesion.countDocuments({ userId: c.usuario.id }), 0);
    assert.equal((await c.get('/api/actividades')).status, 401);
    const registro = JSON.stringify(await Auditoria.find({}).lean());
    assert.ok(!registro.includes(c.usuario.email), 'el correo de la cuenta eliminada no queda en la auditoría');
    assert.ok(!/scrypt\$|clave1234|lt_sid/.test(registro), 'ni contraseñas, ni hashes, ni tokens');
    assert.equal((await a.get('/api/admin/auditoria')).data.acciones[0].accion, 'eliminar');
});

test('cuentas anteriores a la v3.13 (sin el campo «rol» guardado): aceptan los documentos y el panel las gestiona', async () => {
    // Regresión: los filtros usaban { rol: 'usuario' }, que NO coincide con documentos sin el campo (Mongoose solo pone
    // el valor por defecto al leer). La pantalla «Actualizamos nuestros documentos» se quedaba en «Guardando…».
    const c = await e.cliente('Cuenta Antigua');
    await Usuario.collection.updateOne({ id: c.usuario.id }, { $unset: { rol: '', estado: '', aceptacionesLegales: '' } });
    const crudo = await Usuario.collection.findOne({ id: c.usuario.id });
    assert.equal(crudo.rol, undefined, 'simula una cuenta creada antes de la v3.13');
    assert.equal((await c.get('/api/actividades')).status, 428, 'debe aceptar los documentos');
    assert.equal((await c.post('/api/auth/aceptar-documentos', { acepto: true, versiones: DATOS_LEGALES.versiones })).status, 200);
    assert.equal((await c.get('/api/actividades')).status, 200, 'la aceptación se guardó y ya puede seguir');
    assert.equal((await c.get('/api/auth/me')).data.usuario.documentosPendientes, undefined);

    const a = await entrarComoAdmin();
    const lista = await a.get(`/api/admin/cuentas?q=${encodeURIComponent(c.usuario.email)}`);
    assert.deepEqual(lista.data.cuentas.map((x) => x.id), [c.usuario.id], 'aparece en el panel');
    assert.equal((await a.get(`/api/admin/cuentas/${c.usuario.id}`)).status, 200);
    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/suspender`, { motivo: 'Prueba cuenta antigua' }, conOrigen())).status, 200);
    assert.equal((await c.get('/api/actividades')).status, 401, 'suspendida: su sesión se cerró');
    assert.equal((await a.post(`/api/admin/cuentas/${c.usuario.id}/reactivar`, {}, conOrigen())).status, 200);
    // …y la cuenta de administración sigue fuera de todo listado
    assert.ok(!(await a.get('/api/admin/cuentas')).data.cuentas.some((x) => x.email === EMAIL_ADMIN));
});

test('recuperación: «restablecer» cambia la contraseña del administrador y cierra sus sesiones', async () => {
    const a = await entrarComoAdmin();
    const nueva = 'Otra-Clave-Distinta#9';
    const r = await script('restablecer', { entrada: `${nueva}\n${nueva}\n` });
    assert.equal(r.codigo, 0, r.salida);
    assert.equal((await a.get('/api/admin/resumen')).status, 404, 'la sesión anterior quedó cerrada');
    assert.equal((await e.sinSesion().post('/api/auth/login', { email: EMAIL_ADMIN, password: CLAVE_ADMIN })).status, 401);
    assert.equal((await e.sinSesion().post('/api/auth/login', { email: EMAIL_ADMIN, password: nueva })).status, 200);
    const otro = await script('restablecer', { email: 'no.es.admin@prueba.co', entrada: `${nueva}\n${nueva}\n` });
    assert.notEqual(otro.codigo, 0, 'solo con el correo del administrador');
});
