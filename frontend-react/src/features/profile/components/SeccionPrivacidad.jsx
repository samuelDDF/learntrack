// Mi perfil › Privacidad y seguridad: cambiar la contraseña (el servidor cierra las otras sesiones) y eliminar la
// cuenta con DOBLE confirmación. Tras la baja la sesión ya no existe: se olvida en la app y se va a la portada.
import { useState } from 'react';
import { Dialogo } from '../../../components/common/Dialogo.jsx';
import { Mensaje, estadoMsg } from '../../../components/common/Mensaje.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { mensajeDeError } from '../../../services/errores.js';
import { perfil as apiPerfil } from '../services/perfil.service.js';

export function SeccionPrivacidad({ fijarPerfil }) {
    const [pw, setPw] = useState({ actual: '', nueva: '', confirma: '' });
    const [estado, setEstado] = useState(estadoMsg());
    const [cambiando, setCambiando] = useState(false);
    const [baja, setBaja] = useState(false);
    const cambiar = (k) => (e) => setPw((x) => ({ ...x, [k]: e.target.value }));

    async function cambiarPassword(ev) {
        ev.preventDefault();
        if (!pw.actual) { document.getElementById('pw-actual-cambio')?.focus(); setEstado(estadoMsg('Escribe tu contraseña actual.', 'error')); return; }
        if (!pw.nueva) { document.getElementById('pw-nueva')?.focus(); setEstado(estadoMsg('Escribe la contraseña nueva.', 'error')); return; }
        if (pw.nueva !== pw.confirma) { document.getElementById('pw-confirma')?.focus(); setEstado(estadoMsg('Las contraseñas nuevas no coinciden.', 'error')); return; }
        setCambiando(true);
        try {
            const r = await apiPerfil.guardar({ passwordActual: pw.actual, passwordNueva: pw.nueva });
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, 'No se pudo cambiar la contraseña.'), 'error')); return; }
            fijarPerfil(r.data.perfil);
            setPw({ actual: '', nueva: '', confirma: '' });
            setEstado(estadoMsg('Contraseña cambiada. Cerramos tus otras sesiones por seguridad.', 'ok'));
        } catch (e) { setEstado(estadoMsg(mensajeDeError(e), 'error')); } finally { setCambiando(false); }
    }

    return (
        <>
            <h2>Privacidad y seguridad</h2>
            <form id="form-password" className="form-perfil" noValidate onSubmit={cambiarPassword}>
                <h3 className="subtitulo">Cambiar contraseña</h3>
                <div className="campo">
                    <label htmlFor="pw-actual-cambio">Contraseña actual</label>
                    <input id="pw-actual-cambio" type="password" maxLength={128} autoComplete="current-password" required value={pw.actual} onChange={cambiar('actual')} />
                </div>
                <div className="campo">
                    <label htmlFor="pw-nueva">Contraseña nueva</label>
                    <input id="pw-nueva" type="password" minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="pw-ayuda" required value={pw.nueva} onChange={cambiar('nueva')} />
                    <small id="pw-ayuda" className="ayuda">Mínimo 8 caracteres, con una letra y un número.</small>
                </div>
                <div className="campo">
                    <label htmlFor="pw-confirma">Repite la contraseña nueva</label>
                    <input id="pw-confirma" type="password" maxLength={128} autoComplete="new-password" required value={pw.confirma} onChange={cambiar('confirma')} />
                </div>
                <Mensaje estado={estado} id="password-estado" />
                <div className="acciones-form">
                    <button type="submit" className="boton boton-primario" id="btn-cambiar-password" disabled={cambiando} aria-busy={cambiando}>Cambiar contraseña</button>
                </div>
                <p className="ayuda">Al cambiarla cerramos tus otras sesiones abiertas.</p>
            </form>
            <div className="zona-peligro">
                <h3>Zona de peligro</h3>
                <p>Eliminar tu cuenta borra para siempre tu perfil, actividades, festivos importados, papelera, historial, check-ins, foto y fondo. No se puede deshacer.</p>
                <button type="button" className="boton boton-peligro" id="btn-eliminar-cuenta" onClick={() => setBaja(true)}>Eliminar cuenta…</button>
            </div>
            <Dialogo abierto={baja} alCerrar={() => setBaja(false)} id="dlg-eliminar" className="dialogo" aria-labelledby="titulo-eliminar">
                <FormularioBaja alCancelar={() => setBaja(false)} />
            </Dialogo>
        </>
    );
}

/** Baja con DOBLE confirmación: 1) botón «Eliminar cuenta…»; 2) contraseña + escribir ELIMINAR */
function FormularioBaja({ alCancelar }) {
    const { olvidarSesion } = useAuth();
    const [password, setPassword] = useState('');
    const [confirmacion, setConfirmacion] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    async function eliminar(ev) {
        ev.preventDefault();
        setError('');
        if (!password) { setError('Escribe tu contraseña.'); return; }
        if (confirmacion.trim() !== 'ELIMINAR') { setError('Escribe ELIMINAR en mayúsculas para confirmar.'); return; }
        setEnviando(true);
        try {
            const r = await apiPerfil.eliminarCuenta(password, confirmacion.trim());
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo eliminar la cuenta.')); return; }
            olvidarSesion({ destino: '/' });         // el servidor ya borró la cuenta y su sesión
        } catch (e) { setError(mensajeDeError(e)); } finally { setEnviando(false); }
    }
    return (
        <form id="form-eliminar" className="formulario-dialogo form-eliminar" noValidate onSubmit={eliminar}>
            <h3 id="titulo-eliminar">¿Eliminar tu cuenta?</h3>
            <p className="campo-ancho">Se borrarán <strong>todos</strong> tus datos de forma permanente. Para confirmar, escribe tu contraseña y la palabra <strong>ELIMINAR</strong>.</p>
            <div className="campo campo-ancho">
                <label htmlFor="eliminar-password">Contraseña</label>
                <input id="eliminar-password" type="password" maxLength={128} autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="campo campo-ancho">
                <label htmlFor="eliminar-confirmacion">Escribe ELIMINAR</label>
                <input id="eliminar-confirmacion" type="text" maxLength={20} autoComplete="off" required value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
            </div>
            <p className="error-formulario campo-ancho" id="eliminar-error" role="alert">{error}</p>
            <div className="modal-pie campo-ancho">
                <span className="espaciador" />
                <button type="button" className="boton" id="btn-eliminar-cancelar" onClick={alCancelar}>Cancelar</button>
                <button type="submit" className="boton boton-peligro confirmar" id="btn-eliminar-confirmar" disabled={enviando} aria-busy={enviando}>Eliminar para siempre</button>
            </div>
        </form>
    );
}
