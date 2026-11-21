// Documentos legales y edad (v3.13), por la API:
//  · el registro exige aceptar los Términos y la Política (versiones vigentes) — el servidor lo comprueba aunque el
//    navegador también lo haga — y guarda la evidencia (versión, huella del texto y fecha);
//  · edad mínima de 14 años; de 14 a 17, su representante recibe un correo y AUTORIZA (o no) desde el enlace; hasta
//    entonces la cuenta no puede usarse;
//  · si se publica una versión nueva, hay que aceptarla antes de seguir (pero siempre se puede ver el perfil y
//    eliminar la cuenta).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarEntorno, DATOS_LEGALES, hoyLocal } from '../utilidades/entorno.js';
import Usuario from '../../backend/modelos/Usuario.js';
import { VERSIONES_VIGENTES } from '../../compartido/legal.js';
import { huellaDe } from '../../backend/servicios/cuenta/legal.js';

let e;
before(async () => { e = await iniciarEntorno(); });
after(async () => { await e.cerrar(); });

let n = 0;
const correo = () => `legal${Date.now()}_${++n}@prueba.co`;
const hace = (anios, dias = 0) => {
    const [a, m, d] = hoyLocal(300).split('-').map(Number);
    const f = new Date(Date.UTC(a - anios, m - 1, d - dias));
    return f.toISOString().slice(0, 10);
};
const registro = (c, email, extra = {}) => c.post('/api/auth/registro', { nombre: 'Persona Prueba', email, password: 'clave1234', ...DATOS_LEGALES, ...extra });
async function registrarYVerificar(email, extra = {}) {
    const c = e.sinSesion();
    const r = await registro(c, email, extra);
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.equal((await c.post('/api/auth/verificar-correo', { codigo: e.smtp.codigoPara(email) })).status, 200);
    return c;
}
const tokenDe = (emailRepresentante) => /#t=([A-Za-z0-9_-]+)/.exec(e.smtp.paraCorreo(emailRepresentante).at(-1)?.texto ?? '')?.[1] ?? null;
const REPRESENTANTE = (email) => ({ nombre: 'Marta Gómez', email, parentesco: 'madre' });

test('sin aceptar los documentos (o con un valor manipulado) no se crea la cuenta', async () => {
    const c = e.sinSesion();
    for (const truco of [{ aceptaDocumentos: false }, { aceptaDocumentos: 'true' }, { aceptaDocumentos: 1 }, { aceptaDocumentos: undefined }]) {
        const email = correo();
        const r = await registro(c, email, truco);
        assert.equal(r.status, 400, JSON.stringify(truco));
        assert.equal(r.data.codigo, 'aceptacion_requerida');
        assert.equal(await Usuario.exists({ email }), null, 'no se guarda nada');
    }
    const vieja = await registro(c, correo(), { versiones: { terminos: '0.9', privacidad: VERSIONES_VIGENTES.privacidad } });
    assert.equal(vieja.status, 409, 'una versión distinta de la vigente obliga a recargar y leer la nueva');
    assert.equal(vieja.data.codigo, 'version_documentos');
});

test('al aceptar se guarda la evidencia: versión, huella SHA-256 del texto exacto y fecha (sin IP)', async () => {
    const email = correo();
    await registrarYVerificar(email);
    const u = await Usuario.findOne({ email }).lean();
    assert.equal(u.aceptacionesLegales.length, 2);
    for (const a of u.aceptacionesLegales) {
        assert.equal(a.version, VERSIONES_VIGENTES[a.documento]);
        assert.equal(a.huella, huellaDe(a.documento));
        assert.match(a.huella, /^[a-f0-9]{64}$/);
        assert.equal(a.via, 'registro');
        assert.ok(Date.now() - new Date(a.aceptadoEn).getTime() < 60000);
    }
    assert.deepEqual(Object.keys(u.aceptacionesLegales[0]).sort(), ['aceptadoEn', 'documento', 'huella', 'version', 'via'], 'nada más (ni IP ni navegador)');
    assert.equal(u.fechaNacimiento, DATOS_LEGALES.fechaNacimiento);
    assert.equal(u.representanteLegal, undefined);
});

test('edad: menores de 14 no pueden registrarse; fechas imposibles o futuras se rechazan', async () => {
    const c = e.sinSesion();
    const nino = await registro(c, correo(), { fechaNacimiento: hace(13, -1) });     // cumple 14 mañana
    assert.equal(nino.status, 400);
    assert.equal(nino.data.codigo, 'edad_minima');
    for (const f of ['2010-02-30', '2999-01-01', 'ayer', '']) assert.equal((await registro(c, correo(), { fechaNacimiento: f })).status, 400, f);
});

test('14 a 17 años: exige representante; la cuenta espera su autorización y él decide desde el enlace del correo', async () => {
    const c0 = e.sinSesion();
    const sinRep = await registro(c0, correo(), { fechaNacimiento: hace(15) });
    assert.equal(sinRep.status, 400);
    assert.equal(sinRep.data.codigo, 'representante_requerido');
    const mismo = correo();
    assert.equal((await registro(c0, mismo, { fechaNacimiento: hace(15), representante: REPRESENTANTE(mismo) })).status, 400, 'el representante no puede ser el mismo correo');
    assert.equal((await registro(c0, correo(), { fechaNacimiento: hace(15), representante: { ...REPRESENTANTE('m@prueba.co'), parentesco: 'vecino' } })).status, 400);

    const email = correo(), emailRep = `rep_${email}`;
    const c = await registrarYVerificar(email, { fechaNacimiento: hace(14), representante: REPRESENTANTE(emailRep) });
    // Sesión sí, pero sin poder usar la app
    const act = await c.get('/api/actividades');
    assert.equal(act.status, 403);
    assert.equal(act.data.codigo, 'autorizacion_representante');
    const me = (await c.get('/api/auth/me')).data.usuario;
    assert.equal(me.representante.estado, 'pendiente');
    assert.match(me.representante.correo, /^r\*\*\*@p\*\*\*\.co$/, 'el correo del representante va oculto');
    assert.equal((await c.get('/api/perfil')).status, 200, 'su perfil sí lo puede ver');

    // El representante recibe el correo con el enlace (token en el fragmento #t=…)
    const mensaje = e.smtp.paraCorreo(emailRep).at(-1);
    assert.match(mensaje.texto, /exige tu autorización/);
    const token = tokenDe(emailRep);
    assert.ok(token, 'el correo trae el enlace');
    assert.match(mensaje.texto, /\/autorizacion-representante#t=/);
    const u = await Usuario.findOne({ email }).lean();
    assert.notEqual(u.representanteLegal.tokenHash, token, 'en la base de datos solo está el hash');
    assert.equal((await c.post('/api/auth/representante/reenviar')).status, 429, 'reenviar tiene espera');

    const anon = e.sinSesion();
    const info = await anon.post('/api/auth/representante/consultar', { token });
    assert.equal(info.status, 200);
    assert.deepEqual(info.data.menor, { nombre: 'Persona Prueba' }, 'solo el nombre del menor, nada más');
    assert.equal((await anon.post('/api/auth/representante/consultar', { token: 'x'.repeat(43) })).status, 404);
    assert.equal((await anon.post('/api/auth/representante/decidir', { token, decision: 'autorizar' })).status, 400, 'debe aceptar los documentos');
    const ok = await anon.post('/api/auth/representante/decidir', { token, decision: 'autorizar', acepto: true, versiones: VERSIONES_VIGENTES });
    assert.equal(ok.status, 200);
    assert.equal((await anon.post('/api/auth/representante/decidir', { token, decision: 'autorizar', acepto: true, versiones: VERSIONES_VIGENTES })).status, 404, 'el enlace es de un solo uso');

    assert.equal((await c.get('/api/actividades')).status, 200, 'ya puede usar LearnTrack');
    const despues = await Usuario.findOne({ email }).lean();
    assert.equal(despues.representanteLegal.estado, 'autorizado');
    assert.ok(despues.representanteLegal.autorizadoEn);
    assert.equal(despues.aceptacionesLegales.filter((a) => a.via === 'representante').length, 2, 'queda la aceptación del representante');
});

test('si el representante NO autoriza, la cuenta del menor y sus datos se eliminan', async () => {
    const email = correo(), emailRep = `rep_${email}`;
    const c = await registrarYVerificar(email, { fechaNacimiento: hace(16), representante: REPRESENTANTE(emailRep) });
    const r = await e.sinSesion().post('/api/auth/representante/decidir', { token: tokenDe(emailRep), decision: 'rechazar' });
    assert.equal(r.status, 200);
    assert.equal(await Usuario.exists({ email }), null);
    assert.equal((await c.get('/api/auth/me')).data.usuario, null, 'su sesión ya no existe');
});

test('versión nueva de los documentos: hay que aceptarla para seguir; perfil y baja siguen disponibles', async () => {
    const email = correo();
    const c = await registrarYVerificar(email);
    assert.equal((await c.get('/api/actividades')).status, 200);
    // Simula que se publicó una versión nueva de los Términos (la que aceptó deja de ser la vigente)
    const antes = (await Usuario.findOne({ email }).lean()).aceptacionesLegales;
    await Usuario.updateOne({ email }, { $set: { aceptacionesLegales: antes.map((a) => (a.documento === 'terminos' ? { ...a, version: '0.9' } : a)) } });
    const bloqueada = await c.get('/api/actividades');
    assert.equal(bloqueada.status, 428);
    assert.deepEqual(bloqueada.data.documentos, ['terminos']);
    assert.deepEqual((await c.get('/api/auth/me')).data.usuario.documentosPendientes.documentos, ['terminos']);
    assert.equal((await c.get('/api/perfil')).status, 200);
    assert.equal((await c.post('/api/estudio', { tema: 'Algo' })).status, 428);
    assert.equal((await c.post('/api/auth/aceptar-documentos', { acepto: false, versiones: VERSIONES_VIGENTES })).status, 400);
    assert.equal((await c.post('/api/auth/aceptar-documentos', { acepto: true, versiones: { terminos: '0.9', privacidad: VERSIONES_VIGENTES.privacidad } })).status, 409);
    assert.equal((await c.post('/api/auth/aceptar-documentos', { acepto: true, versiones: VERSIONES_VIGENTES })).status, 200);
    assert.equal((await c.get('/api/actividades')).status, 200);
    const u = await Usuario.findOne({ email }).lean();
    assert.equal(u.aceptacionesLegales.filter((a) => a.via === 'actualizacion').map((a) => a.documento).join(), 'terminos', 'solo lo que faltaba');
    // Las cuentas anteriores a la v3.13 (sin ninguna aceptación) también deben aceptar antes de seguir
    await Usuario.updateOne({ email }, { $unset: { aceptacionesLegales: '' } });
    assert.equal((await c.get('/api/actividades')).status, 428);
    // …pero siempre pueden irse: eliminar la cuenta no exige aceptar nada
    assert.equal((await c.crudo('DELETE', '/api/perfil', { password: 'clave1234', confirmacion: 'ELIMINAR' })).status, 200);
});
