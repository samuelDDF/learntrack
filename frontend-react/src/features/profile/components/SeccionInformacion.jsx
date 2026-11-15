// Mi perfil › Información básica: foto, nombre y correo (PUT /api/perfil y /api/perfil/avatar). Para cambiar el
// correo el servidor exige la contraseña actual.
import { useState } from 'react';
import { Mensaje, estadoMsg } from '../../../components/common/Mensaje.jsx';
import { mensajeDeError } from '../../../services/errores.js';
import { perfil as apiPerfil } from '../services/perfil.service.js';
import { Avatar } from '../../../components/layout/privado/Avatar.jsx';
import { reducirImagen, esImagenAceptada } from '../../settings/utils/imagenes.js';

export function SeccionInformacion({ perfil, pintarTodo }) {
    const [nombre, setNombre] = useState(perfil.nombre);
    const [email, setEmail] = useState(perfil.email);
    const [actual, setActual] = useState('');
    const [estado, setEstado] = useState(estadoMsg());
    const [estadoAvatar, setEstadoAvatar] = useState(estadoMsg());
    const [guardando, setGuardando] = useState(false);
    const sensible = email.trim().toLowerCase() !== perfil.email;

    async function guardar(ev) {
        ev.preventDefault();
        setEstado(estadoMsg());
        const cuerpo = {};
        if (nombre.trim() !== perfil.nombre) cuerpo.nombre = nombre.trim();
        if (email.trim().toLowerCase() !== perfil.email) cuerpo.email = email.trim();
        if (Object.keys(cuerpo).length === 0) { setEstado(estadoMsg('No hay cambios que guardar.')); return; }
        if (cuerpo.email !== undefined) {
            if (!actual) { document.getElementById('pw-actual')?.focus(); setEstado(estadoMsg('Escribe tu contraseña actual para cambiar el correo.', 'error')); return; }
            cuerpo.passwordActual = actual;
        }
        setGuardando(true);
        try {
            const r = await apiPerfil.guardar(cuerpo);
            if (!r.ok) { setEstado(estadoMsg(mensajeDeError(r, 'No se pudo guardar.'), 'error')); return; }
            pintarTodo(r.data);
            setNombre(r.data.perfil.nombre); setEmail(r.data.perfil.email); setActual('');
            setEstado(estadoMsg('Cambios guardados.', 'ok'));
        } catch (e) { setEstado(estadoMsg(mensajeDeError(e), 'error')); } finally { setGuardando(false); }
    }

    async function subirAvatar(ev) {
        const archivo = ev.target.files?.[0];
        ev.target.value = '';
        if (!archivo) return;
        if (!esImagenAceptada(archivo)) { setEstadoAvatar(estadoMsg('Elige una imagen JPG, PNG o WebP.', 'error')); return; }
        if (archivo.size > 15 * 1024 * 1024) { setEstadoAvatar(estadoMsg('La imagen es demasiado grande (máximo 15 MB).', 'error')); return; }
        setEstadoAvatar(estadoMsg('Subiendo…'));
        try {
            const blob = await reducirImagen(archivo, { lado: 256, cuadrado: true });
            const r = await apiPerfil.subirAvatar(blob);
            if (!r.ok) { setEstadoAvatar(estadoMsg(mensajeDeError(r, 'No se pudo subir la foto.'), 'error')); return; }
            pintarTodo(r.data);
            setEstadoAvatar(estadoMsg('Foto actualizada.', 'ok'));
        } catch { setEstadoAvatar(estadoMsg('No pude leer esa imagen. Prueba con otra.', 'error')); }
    }
    async function quitarAvatar() {
        const r = await apiPerfil.quitarAvatar().catch(() => null);
        if (!r?.ok) { setEstadoAvatar(estadoMsg(mensajeDeError(r, 'No se pudo quitar la foto.'), 'error')); return; }
        pintarTodo(r.data);
        setEstadoAvatar(estadoMsg('Foto eliminada.', 'ok'));
    }

    return (
        <>
            <h2>Información básica</h2>
            <p className="panel-intro">Tu foto, tu nombre y tu correo. Para cambiar el correo te pedimos la contraseña actual.</p>
            <div className="avatar-bloque">
                <Avatar usuario={perfil} clase="avatar-grande" alt="Tu foto de perfil" />
                <div className="avatar-acciones">
                    <label className="boton" htmlFor="avatar-archivo">Cambiar foto</label>
                    <input type="file" id="avatar-archivo" className="solo-lectores" accept="image/png,image/jpeg,image/webp" onChange={subirAvatar} />
                    {perfil.avatarUrl ? <button type="button" className="boton boton-peligro" id="btn-avatar-quitar" onClick={quitarAvatar}>Quitar foto</button> : null}
                    <p className="ayuda" id="avatar-ayuda">JPG, PNG o WebP. La reducimos a 256 × 256 px antes de subirla.</p>
                    <Mensaje estado={estadoAvatar} id="avatar-estado" />
                </div>
            </div>
            <form id="form-perfil" className="form-perfil" noValidate autoComplete="off" onSubmit={guardar}>
                <div className="campo">
                    <label htmlFor="perfil-nombre">Nombre de usuario</label>
                    <input id="perfil-nombre" name="nombre" type="text" minLength={2} maxLength={60} required autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div className="campo">
                    <label htmlFor="perfil-email">Correo electrónico</label>
                    <input id="perfil-email" name="email" type="email" maxLength={254} required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {sensible ? (
                    <div className="campo campo-actual" id="campo-actual">
                        <label htmlFor="pw-actual">Contraseña actual <span className="opcional">(necesaria para cambiar el correo)</span></label>
                        <input id="pw-actual" type="password" maxLength={128} autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
                    </div>
                ) : null}
                <Mensaje estado={estado} id="perfil-estado" />
                <div className="acciones-form">
                    <button type="submit" className="boton boton-primario" id="btn-guardar-perfil" disabled={guardando} aria-busy={guardando}>Guardar cambios</button>
                </div>
            </form>
        </>
    );
}
