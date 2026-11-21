// /api/admin — Panel de administración (v3.13). SOLO la cuenta con rol «admin» (comprobado en el servidor en cada
// petición). A cualquier otra persona se le responde 404, igual que a una ruta inexistente.
//   GET    /api/admin/resumen                       → totales y comprobación de integridad (un solo administrador)
//   GET    /api/admin/cuentas?q=&estado=&pagina=    → listado (nunca incluye la cuenta de administración)
//   GET    /api/admin/cuentas/:id                   → detalle: metadatos y CONTEOS de uso (nunca el contenido)
//   POST   /api/admin/cuentas/:id/suspender         { motivo, hasta? } → suspende y cierra sus sesiones
//   POST   /api/admin/cuentas/:id/reactivar
//   POST   /api/admin/cuentas/:id/cerrar-sesiones
//   DELETE /api/admin/cuentas/:id                   { confirmacion: <correo de la cuenta>, motivo } → baja completa
//   GET    /api/admin/auditoria?pagina=             → acciones registradas
// Cada acción que cambia algo queda en la auditoría (sin contraseñas, tokens ni el correo de una cuenta eliminada).
import express from 'express';
import * as db from '../datos/index.js';
import { requiereAdmin } from '../middleware/autenticacion.js';
import { validarConsultaCuentas, validarPagina, validarSuspension, validarEliminacion, esIdCuenta } from '../validacion/index.js';

const noEncontrada = (res) => res.status(404).json({ error: 'Cuenta no encontrada.' });

export function crearRutasAdmin(limites) {
    const rutas = express.Router();
    rutas.use(requiereAdmin, limites.admin);
    // :id siempre es un id de cuenta válido y NUNCA el del propio administrador (no puede suspenderse ni borrarse)
    rutas.param('id', (req, res, next, id) => (esIdCuenta(id) && id !== req.usuario.id ? next() : noEncontrada(res)));

    rutas.get('/resumen', async (req, res) => {
        await db.reactivarSuspensionesVencidasBD();
        res.json(await db.resumenAdminBD());
    });

    rutas.get('/cuentas', async (req, res) => {
        const { error, valor } = validarConsultaCuentas(req.query);
        if (error) return res.status(400).json({ error });
        await db.reactivarSuspensionesVencidasBD();
        res.json(await db.listarCuentasBD(valor));
    });

    rutas.get('/cuentas/:id', async (req, res) => {
        const cuenta = await db.detalleCuentaBD(req.params.id);
        if (!cuenta) return noEncontrada(res);
        res.json({ cuenta });
    });

    rutas.post('/cuentas/:id/suspender', async (req, res) => {
        const { error, valor } = validarSuspension(req.body);
        if (error) return res.status(400).json({ error });
        const ok = await db.suspenderCuentaBD(req.params.id, valor);
        if (!ok) return noEncontrada(res);
        await db.registrarAuditoriaBD({ accion: 'suspender', adminId: req.usuario.id, cuentaId: req.params.id, detalle: valor });
        res.json({ mensaje: 'Cuenta suspendida. Sus sesiones abiertas se cerraron.', cuenta: await db.detalleCuentaBD(req.params.id) });
    });

    rutas.post('/cuentas/:id/reactivar', async (req, res) => {
        const ok = await db.reactivarCuentaBD(req.params.id);
        if (ok === null) return noEncontrada(res);
        if (ok === false) return res.status(409).json({ error: 'La cuenta no está suspendida.' });
        await db.registrarAuditoriaBD({ accion: 'reactivar', adminId: req.usuario.id, cuentaId: req.params.id });
        res.json({ mensaje: 'Cuenta reactivada.', cuenta: await db.detalleCuentaBD(req.params.id) });
    });

    rutas.post('/cuentas/:id/cerrar-sesiones', async (req, res) => {
        const n = await db.cerrarSesionesCuentaBD(req.params.id);
        if (n === null) return noEncontrada(res);
        await db.registrarAuditoriaBD({ accion: 'cerrar_sesiones', adminId: req.usuario.id, cuentaId: req.params.id });
        res.json({ mensaje: n ? `Se cerraron ${n} ${n === 1 ? 'sesión' : 'sesiones'}.` : 'La cuenta no tenía sesiones abiertas.' });
    });

    rutas.delete('/cuentas/:id', async (req, res) => {
        const { error, valor } = validarEliminacion(req.body);
        if (error) return res.status(400).json({ error });
        const cuenta = await db.esCuentaDeUsuarioBD(req.params.id);
        if (!cuenta) return noEncontrada(res);
        if (cuenta.email !== valor.confirmacion) return res.status(400).json({ error: 'El correo escrito no coincide con el de la cuenta. No se eliminó nada.', codigo: 'confirmacion' });
        // Misma baja completa que usa la persona desde «Mi perfil»: borra TODOS sus datos (ver datos/usuarios.js)
        await db.eliminarCuentaBD(req.params.id);
        await db.registrarAuditoriaBD({ accion: 'eliminar', adminId: req.usuario.id, cuentaId: req.params.id, detalle: { motivo: valor.motivo } });
        res.json({ mensaje: 'Cuenta eliminada con todos sus datos.' });
    });

    rutas.get('/auditoria', async (req, res) => {
        const { error, valor } = validarPagina(req.query);
        if (error) return res.status(400).json({ error });
        res.json(await db.listarAuditoriaBD({ pagina: valor }));
    });

    return rutas;
}
