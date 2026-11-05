// perfil.js — "Mi perfil" (módulo ES): pestañas laterales, edición de datos, foto, tema, cuentas vinculadas,
// notificaciones y baja de cuenta. Todo el texto dinámico entra con textContent (nunca innerHTML).
import { api, aviso, abrirDialogo, cerrarSesion } from '/app/comun/utilidades.js';

const $ = (id) => document.getElementById(id);
let perfil = null;                 // última copia del servidor
let integraciones = { modo: 'simulado' };

// ---------------------------------------------------------------- utilidades
/** Muestra un mensaje de estado bajo un bloque (ok = verde, error = rojo) */
function decir(elem, texto, tipo = '') {
    elem.textContent = texto;
    elem.classList.toggle('ok', tipo === 'ok');
    elem.classList.toggle('error', tipo === 'error');
}
const inicialDe = (nombre) => (String(nombre).trim()[0] ?? '?').toUpperCase();

// ---------------------------------------------------------------- pestañas (patrón ARIA tabs, con flechas)
const pestanas = [...document.querySelectorAll('.pestana')];
function mostrarPestana(pestana, { enfocar = false, historial = true } = {}) {
    for (const p of pestanas) {
        const activa = p === pestana;
        p.setAttribute('aria-selected', String(activa));
        p.tabIndex = activa ? 0 : -1;
        $(p.getAttribute('aria-controls')).hidden = !activa;
    }
    if (enfocar) pestana.focus();
    if (historial) history.replaceState(null, '', `#${pestana.id.replace('tab-', '')}`);
}
pestanas.forEach((p, i) => {
    p.addEventListener('click', () => mostrarPestana(p));
    p.addEventListener('keydown', (ev) => {
        const vertical = window.matchMedia('(min-width: 861px)').matches;
        const siguiente = vertical ? 'ArrowDown' : 'ArrowRight', anterior = vertical ? 'ArrowUp' : 'ArrowLeft';
        let destino = null;
        if (ev.key === siguiente) destino = pestanas[(i + 1) % pestanas.length];
        else if (ev.key === anterior) destino = pestanas[(i - 1 + pestanas.length) % pestanas.length];
        else if (ev.key === 'Home') destino = pestanas[0];
        else if (ev.key === 'End') destino = pestanas[pestanas.length - 1];
        if (destino) { ev.preventDefault(); mostrarPestana(destino, { enfocar: true }); }
    });
});
function pestanaDesdeHash() {
    const p = $(`tab-${location.hash.slice(1)}`);
    mostrarPestana(p && pestanas.includes(p) ? p : pestanas[0], { historial: false });
}
window.addEventListener('hashchange', pestanaDesdeHash);

// ---------------------------------------------------------------- pintar el perfil
function pintarAvatar(url, nombre) {
    for (const [img, ini] of [[$('avatar-img'), $('avatar-inicial')], [$('resumen-avatar'), $('resumen-inicial')]]) {
        ini.textContent = inicialDe(nombre);
        img.hidden = !url;
        ini.hidden = Boolean(url);
        if (url) img.src = url; else img.removeAttribute('src');
    }
    $('btn-avatar-quitar').hidden = !url;
}

function pintarCuentas() {
    $('nota-modo').classList.toggle('oculto', integraciones.modo !== 'simulado');
    $('nota-modo').textContent = integraciones.modo === 'simulado'
        ? 'Modo de demostración: al vincular solo se guarda el estado en tu perfil; todavía no se conecta con el servicio real (falta configurar OAuth en el servidor).'
        : '';
    for (const tarjeta of document.querySelectorAll('.cuenta')) {
        const info = perfil.cuentasVinculadas[tarjeta.dataset.servicio];
        const nombre = tarjeta.querySelector('h3').textContent;
        const boton = tarjeta.querySelector('[data-accion]');
        tarjeta.classList.toggle('vinculada', info.vinculada);
        tarjeta.querySelector('[data-estado]').textContent = info.vinculada ? 'Conectado' : 'Sin vincular';
        boton.textContent = info.vinculada ? 'Desconectar' : 'Vincular cuenta';
        boton.classList.toggle('boton-primario', !info.vinculada);
        boton.classList.toggle('boton-peligro', info.vinculada);
        boton.setAttribute('aria-label', `${info.vinculada ? 'Desconectar' : 'Vincular'} ${nombre}`);
        boton.disabled = false;
    }
}

function pintarNotificaciones() {
    const general = perfil.notificacionesActivas;
    $('sw-general').checked = general;
    $('sw-alertas').checked = perfil.preferenciasNotificaciones.alertasTareas;
    $('sw-ia').checked = perfil.preferenciasNotificaciones.recordatoriosIA;
    $('sw-alertas').disabled = !general;      // las finas solo aplican si el interruptor general está activo
    $('sw-ia').disabled = !general;
}

function pintarTodo(datos) {
    perfil = datos.perfil;
    integraciones = datos.integraciones;
    $('saludo-usuario').textContent = `Hola, ${perfil.nombre.split(' ')[0]}`;
    $('resumen-nombre').textContent = perfil.nombre;
    $('resumen-email').textContent = perfil.email;
    $('perfil-nombre').value = perfil.nombre;
    $('perfil-email').value = perfil.email;
    pintarAvatar(perfil.avatarUrl, perfil.nombre);
    for (const r of document.querySelectorAll('input[name="tema"]')) r.checked = r.value === perfil.temaEstetico;
    window.LearnTrackTema?.aplicar(perfil.temaEstetico);
    pintarCuentas();
    pintarNotificaciones();
}

// ---------------------------------------------------------------- 1. datos del perfil
const formPerfil = $('form-perfil');
const alternarContrasenaActual = () => {
    const sensible = $('perfil-email').value.trim().toLowerCase() !== perfil?.email || $('pw-nueva').value !== '';
    $('campo-actual').classList.toggle('oculto', !sensible);
    if (!sensible) $('pw-actual').value = '';
};
['perfil-email', 'pw-nueva'].forEach((id) => $(id).addEventListener('input', alternarContrasenaActual));

formPerfil.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const estado = $('perfil-estado');
    decir(estado, '');
    const cuerpo = {};
    const nombre = $('perfil-nombre').value.trim();
    const email = $('perfil-email').value.trim();
    if (nombre !== perfil.nombre) cuerpo.nombre = nombre;
    if (email.toLowerCase() !== perfil.email) cuerpo.email = email;
    if ($('pw-nueva').value) {
        if ($('pw-nueva').value !== $('pw-confirma').value) return decir(estado, 'Las contraseñas nuevas no coinciden.', 'error');
        cuerpo.passwordNueva = $('pw-nueva').value;
    }
    if (Object.keys(cuerpo).length === 0) return decir(estado, 'No hay cambios que guardar.');
    if (cuerpo.email !== undefined || cuerpo.passwordNueva !== undefined) {
        if (!$('pw-actual').value) { $('pw-actual').focus(); return decir(estado, 'Escribe tu contraseña actual para cambiar el correo o la contraseña.', 'error'); }
        cuerpo.passwordActual = $('pw-actual').value;
    }
    const boton = $('btn-guardar-perfil');
    boton.disabled = true;
    try {
        const r = await api('/api/perfil', cuerpo, 'PUT');
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo guardar.', 'error');
        pintarTodo(r.data);
        for (const id of ['pw-nueva', 'pw-confirma', 'pw-actual']) $(id).value = '';
        alternarContrasenaActual();
        decir(estado, r.data.passwordCambiada ? 'Guardado. Cerramos tus otras sesiones por seguridad.' : 'Cambios guardados.', 'ok');
    } catch (e) {
        decir(estado, 'No se pudo conectar con el servidor.', 'error');
    } finally { boton.disabled = false; }
});

// ---------------------------------------------------------------- foto de perfil
/** Recorta al centro y reduce a 256×256 JPEG en el navegador (la foto sube pesando decenas de KB, no megas) */
async function reducirImagen(archivo, lado = 256) {
    const bitmap = await createImageBitmap(archivo);
    const corte = Math.min(bitmap.width, bitmap.height);
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = lado;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';                       // PNG con transparencia → fondo blanco (JPEG no tiene alfa)
    ctx.fillRect(0, 0, lado, lado);
    ctx.drawImage(bitmap, (bitmap.width - corte) / 2, (bitmap.height - corte) / 2, corte, corte, 0, 0, lado, lado);
    bitmap.close?.();
    return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('canvas'))), 'image/jpeg', 0.86));
}

$('avatar-archivo').addEventListener('change', async (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    const estado = $('avatar-estado');
    if (!archivo) return;
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) return decir(estado, 'Elige una imagen JPG, PNG o WebP.', 'error');
    if (archivo.size > 15 * 1024 * 1024) return decir(estado, 'La imagen es demasiado grande (máximo 15 MB).', 'error');
    decir(estado, 'Subiendo…');
    try {
        const blob = await reducirImagen(archivo);
        const res = await fetch('/api/perfil/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        if (res.status === 401) { location.assign('/?acceso=login'); return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return decir(estado, data.error ?? 'No se pudo subir la foto.', 'error');
        pintarTodo(data);
        decir(estado, 'Foto actualizada.', 'ok');
    } catch {
        decir(estado, 'No pude leer esa imagen. Prueba con otra.', 'error');
    }
});

$('btn-avatar-quitar').addEventListener('click', async () => {
    const r = await api('/api/perfil/avatar', undefined, 'DELETE');
    if (!r.ok) return decir($('avatar-estado'), r.data.error ?? 'No se pudo quitar la foto.', 'error');
    pintarTodo(r.data);
    decir($('avatar-estado'), 'Foto eliminada.', 'ok');
});

// ---------------------------------------------------------------- 2. tema (se aplica al instante y se guarda)
for (const radio of document.querySelectorAll('input[name="tema"]')) {
    radio.addEventListener('change', async () => {
        const estado = $('tema-estado');
        const anterior = perfil.temaEstetico;
        window.LearnTrackTema?.aplicar(radio.value);                  // instantáneo: no espera al servidor
        decir(estado, 'Guardando…');
        try {
            const r = await api('/api/perfil', { temaEstetico: radio.value }, 'PUT');
            if (!r.ok) throw new Error(r.data.error);
            perfil = r.data.perfil;
            decir(estado, 'Tema guardado en tu cuenta.', 'ok');
        } catch (e) {
            window.LearnTrackTema?.aplicar(anterior);                 // si falla, vuelve al anterior
            for (const r of document.querySelectorAll('input[name="tema"]')) r.checked = r.value === anterior;
            decir(estado, 'No se pudo guardar el tema. Se restauró el anterior.', 'error');
        }
    });
}

// ---------------------------------------------------------------- 3. cuentas vinculadas
for (const tarjeta of document.querySelectorAll('.cuenta')) {
    const boton = tarjeta.querySelector('[data-accion]');
    boton.addEventListener('click', async () => {
        const servicio = tarjeta.dataset.servicio;
        const nombre = tarjeta.querySelector('h3').textContent;
        const vincular = !perfil.cuentasVinculadas[servicio].vinculada;
        const estado = $('cuentas-estado');
        boton.disabled = true;
        decir(estado, '');
        try {
            const r = vincular
                ? await api('/api/perfil/vincular', { servicio })
                : await api(`/api/perfil/vincular/${servicio}`, undefined, 'DELETE');
            if (!r.ok) { decir(estado, r.data.error ?? `No se pudo ${vincular ? 'vincular' : 'desconectar'} ${nombre}.`, 'error'); return; }
            perfil = r.data.perfil; integraciones = r.data.integraciones;
            decir(estado, vincular ? `${nombre} conectado.` : `${nombre} desconectado.`, 'ok');
        } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
        finally { pintarCuentas(); }
    });
}

// ---------------------------------------------------------------- 4. notificaciones
async function guardarNotificaciones(cuerpo) {
    const estado = $('notif-estado');
    try {
        const r = await api('/api/perfil', cuerpo, 'PUT');
        if (!r.ok) throw new Error();
        perfil = r.data.perfil;
        decir(estado, 'Preferencias guardadas.', 'ok');
    } catch { decir(estado, 'No se pudo guardar. Inténtalo de nuevo.', 'error'); }
    pintarNotificaciones();                                          // deja los interruptores como están en el servidor
}
$('sw-general').addEventListener('change', (ev) => guardarNotificaciones({ notificacionesActivas: ev.target.checked }));
$('sw-alertas').addEventListener('change', (ev) => guardarNotificaciones({ preferenciasNotificaciones: { alertasTareas: ev.target.checked } }));
$('sw-ia').addEventListener('change', (ev) => guardarNotificaciones({ preferenciasNotificaciones: { recordatoriosIA: ev.target.checked } }));

// ---------------------------------------------------------------- eliminar cuenta (doble confirmación)
const dlg = $('dlg-eliminar');
$('btn-eliminar-cuenta').addEventListener('click', () => {
    $('form-eliminar').reset();
    $('eliminar-error').textContent = '';
    abrirDialogo(dlg);
    $('eliminar-password').focus();
});
$('btn-eliminar-cancelar').addEventListener('click', () => dlg.close());
$('form-eliminar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const error = $('eliminar-error');
    error.textContent = '';
    const password = $('eliminar-password').value;
    const confirmacion = $('eliminar-confirmacion').value.trim();
    if (!password) return (error.textContent = 'Escribe tu contraseña.');
    if (confirmacion !== 'ELIMINAR') return (error.textContent = 'Escribe ELIMINAR en mayúsculas para confirmar.');
    const boton = $('btn-eliminar-confirmar');
    boton.disabled = true;
    try {
        const r = await api('/api/perfil', { password, confirmacion }, 'DELETE');
        if (!r.ok) { error.textContent = r.data.error ?? 'No se pudo eliminar la cuenta.'; return; }
        try { localStorage.removeItem('learntrack_tema'); } catch { /* sin almacenamiento */ }
        location.assign('/');
    } catch { error.textContent = 'No se pudo conectar con el servidor.'; }
    finally { boton.disabled = false; }
});

// ---------------------------------------------------------------- arranque
$('btn-salir').addEventListener('click', (ev) => cerrarSesion(ev.currentTarget));
pestanaDesdeHash();
(async () => {
    try {
        const r = await api('/api/perfil');
        if (!r.ok) throw new Error();
        pintarTodo(r.data);
    } catch {
        $('resumen-nombre').textContent = 'No se pudo cargar tu perfil';
        aviso('No se pudo cargar tu perfil. Recarga la página.');
    }
})();
