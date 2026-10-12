// configuracion.js — Configuración (módulo ES), con pestañas laterales:
//   Información básica (foto, nombre, correo) · Voz de la IA · Estética (temas, paleta con Colormind, fondo)
//   · Cuentas vinculadas · Notificaciones · Privacidad y seguridad (contraseña y baja con doble confirmación).
// Todo el texto dinámico entra con textContent (nunca innerHTML); los colores con style.setProperty (CSSOM).
import { h, api, aviso, abrirDialogo } from '/app/comun/utilidades.js';
import { actualizarUsuario } from '/app/comun/sesion.js';
import { vocesDisponibles, hablar, callar, sintesisDisponible, fijarVozPreferida } from '/app/comun/voz.js';
import { montarBarraNavegacion } from '/app/componentes/barra-navegacion/barra-navegacion.js';

const $ = (id) => document.getElementById(id);
const Tema = () => window.LearnTrackTema;
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

/** Apariencia guardada en la cuenta, en el formato de tema-inicial.js */
const aparienciaGuardada = () => ({ temaSeleccionado: perfil.temaSeleccionado, variablesTema: perfil.variablesTema, imagenFondoUrl: perfil.imagenFondoUrl });

/** fetch para cuerpos binarios o multipart (api() solo envía JSON o FormData sin manejar 413/415 de forma distinta) */
async function enviarArchivo(url, opciones) {
    const res = await fetch(url, opciones);
    if (res.status === 401) { location.assign('/?acceso=login'); throw new Error('Sesión no válida'); }
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/**
 * Reduce una imagen en el navegador y la devuelve como JPEG.
 *  · cuadrado: recorta al centro (foto de perfil).  · si no: conserva la proporción con `lado` como ancho máximo (fondo).
 */
async function reducirImagen(archivo, { lado, cuadrado = false, calidad = 0.86 }) {
    const bitmap = await createImageBitmap(archivo);
    const lienzo = document.createElement('canvas');
    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (cuadrado) {
        const corte = Math.min(sw, sh);
        sx = (sw - corte) / 2; sy = (sh - corte) / 2; sw = sh = corte;
        lienzo.width = lienzo.height = lado;
    } else {
        const escala = Math.min(1, lado / sw);
        lienzo.width = Math.round(sw * escala); lienzo.height = Math.round(sh * escala);
    }
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';                       // PNG con transparencia → fondo blanco (JPEG no tiene alfa)
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);
    bitmap.close?.();
    return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('canvas'))), 'image/jpeg', calidad));
}
const esImagenAceptada = (archivo) => /^image\/(png|jpeg|webp)$/.test(archivo.type);

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
    if (pestana.id === 'tab-voz') prepararVoces();
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
// Direcciones antiguas de «Mi perfil» (v3.1–v3.2) → pestañas nuevas
const HASH_ANTIGUOS = { perfil: 'informacion', apariencia: 'estetica', general: 'notificaciones' };
function pestanaDesdeHash() {
    const id = location.hash.slice(1);
    const p = $(`tab-${HASH_ANTIGUOS[id] ?? id}`);
    mostrarPestana(p && pestanas.includes(p) ? p : pestanas[0], { historial: Boolean(HASH_ANTIGUOS[id]) });
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
        ? 'Modo de demostración: al conectar solo se guarda el estado en tu perfil; todavía no se conecta con el servicio real (falta configurar OAuth en el servidor).'
        : '';
    for (const tarjeta of document.querySelectorAll('.cuenta')) {
        const info = perfil.cuentasVinculadas[tarjeta.dataset.servicio] ?? { vinculada: false };
        const nombre = tarjeta.querySelector('h3').textContent;
        const boton = tarjeta.querySelector('[data-accion]');
        tarjeta.classList.toggle('vinculada', info.vinculada);
        tarjeta.querySelector('[data-estado]').textContent = info.vinculada ? 'Conectado' : 'Desconectado';
        boton.textContent = info.vinculada ? 'Desconectar' : 'Conectar';
        boton.classList.toggle('boton-primario', !info.vinculada);
        boton.classList.toggle('boton-peligro', info.vinculada);
        boton.setAttribute('aria-label', `${info.vinculada ? 'Desconectar' : 'Conectar'} ${nombre}`);
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

/** Muestras de color con CSSOM (la CSP no permite style="" en el HTML) */
function pintarMuestras(contenedor, colores) {
    const muestras = contenedor.querySelectorAll('.sw');
    [colores[0], colores[1], colores[2], colores[3]].forEach((c, i) => { if (muestras[i] && c) muestras[i].style.setProperty('background', c); });
}

function pintarApariencia() {
    const tarjeta = $('tema-personalizado');
    tarjeta.hidden = !perfil.coloresPersonalizados;
    if (perfil.variablesTema) {
        const v = perfil.variablesTema;
        pintarMuestras(tarjeta, [v['--color-fondo'], v['--color-primario'], v['--color-secundario'], v['--color-acento']]);
    }
    for (const r of document.querySelectorAll('input[name="tema"]')) r.checked = r.value === perfil.temaSeleccionado;
    pintarFondo(perfil.imagenFondoUrl);
}

function pintarFondo(url) {
    const vista = $('fondo-vista');
    vista.classList.toggle('con-imagen', Boolean(url));
    if (url) vista.style.setProperty('background-image', `url("${url}")`);
    else vista.style.removeProperty('background-image');
    $('btn-fondo-quitar').hidden = !url;
}

function pintarTodo(datos) {
    perfil = datos.perfil;
    integraciones = datos.integraciones ?? integraciones;
    $('resumen-nombre').textContent = perfil.nombre;
    $('resumen-email').textContent = perfil.email;
    $('perfil-nombre').value = perfil.nombre;
    $('perfil-email').value = perfil.email;
    $('nombre-ia').value = perfil.nombreIA ?? 'Nexo';
    pintarAvatar(perfil.avatarUrl, perfil.nombre);
    pintarApariencia();
    Tema()?.aplicar(aparienciaGuardada());
    pintarCuentas();
    pintarNotificaciones();
    actualizarUsuario({ nombre: perfil.nombre, email: perfil.email, avatarUrl: perfil.avatarUrl, vozAsistente: perfil.vozAsistente, nombreIA: perfil.nombreIA });
}

// ---------------------------------------------------------------- 1. información básica
const formPerfil = $('form-perfil');
const alternarContrasenaActual = () => {
    const sensible = $('perfil-email').value.trim().toLowerCase() !== perfil?.email;
    $('campo-actual').classList.toggle('oculto', !sensible);
    if (!sensible) $('pw-actual').value = '';
};
$('perfil-email').addEventListener('input', alternarContrasenaActual);

formPerfil.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const estado = $('perfil-estado');
    decir(estado, '');
    const cuerpo = {};
    const nombre = $('perfil-nombre').value.trim();
    const email = $('perfil-email').value.trim();
    if (nombre !== perfil.nombre) cuerpo.nombre = nombre;
    if (email.toLowerCase() !== perfil.email) cuerpo.email = email;
    if (Object.keys(cuerpo).length === 0) return decir(estado, 'No hay cambios que guardar.');
    if (cuerpo.email !== undefined) {
        if (!$('pw-actual').value) { $('pw-actual').focus(); return decir(estado, 'Escribe tu contraseña actual para cambiar el correo.', 'error'); }
        cuerpo.passwordActual = $('pw-actual').value;
    }
    const boton = $('btn-guardar-perfil');
    boton.disabled = true;
    try {
        const r = await api('/api/perfil', cuerpo, 'PUT');
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo guardar.', 'error');
        pintarTodo(r.data);
        $('pw-actual').value = '';
        alternarContrasenaActual();
        decir(estado, 'Cambios guardados.', 'ok');
    } catch {
        decir(estado, 'No se pudo conectar con el servidor.', 'error');
    } finally { boton.disabled = false; }
});

// ---- foto de perfil (256×256, cuerpo binario) ----
$('avatar-archivo').addEventListener('change', async (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    const estado = $('avatar-estado');
    if (!archivo) return;
    if (!esImagenAceptada(archivo)) return decir(estado, 'Elige una imagen JPG, PNG o WebP.', 'error');
    if (archivo.size > 15 * 1024 * 1024) return decir(estado, 'La imagen es demasiado grande (máximo 15 MB).', 'error');
    decir(estado, 'Subiendo…');
    try {
        const blob = await reducirImagen(archivo, { lado: 256, cuadrado: true });
        const r = await enviarArchivo('/api/perfil/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo subir la foto.', 'error');
        pintarTodo(r.data);
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

// ---------------------------------------------------------------- 2. voz de la IA
const selVoz = $('voz-select');
let vocesListas = false;
async function prepararVoces() {
    if (vocesListas || !perfil) return;
    if (!sintesisDisponible()) {
        $('voz-no-disponible').classList.remove('oculto');
        for (const id of ['voz-select', 'voz-prueba', 'btn-voz-probar']) $(id).disabled = true;
        return;
    }
    vocesListas = true;
    const voces = await vocesDisponibles();
    const grupo = (etiqueta, lista) => lista.length
        ? h('optgroup', { label: etiqueta }, lista.map((v) => h('option', { value: v.name, texto: `${v.name} (${v.lang})${v.localService ? '' : ' · en línea'}` })))
        : null;
    selVoz.append(...[grupo('Español', voces.filter((v) => v.lang.startsWith('es'))), grupo('Otros idiomas', voces.filter((v) => !v.lang.startsWith('es')))].filter(Boolean));
    const guardada = perfil.vozAsistente ?? '';
    if (guardada && !voces.some((v) => v.name === guardada)) {
        // La voz guardada viene de otro dispositivo: se conserva, pero se avisa
        selVoz.append(h('option', { value: guardada, texto: `${guardada} (no disponible en este dispositivo)` }));
    }
    selVoz.value = guardada;
    $('voz-ayuda').textContent = voces.length
        ? `Hay ${voces.length} voces en este dispositivo. Se guarda en tu cuenta.`
        : 'Tu navegador no ofrece voces todavía; se usará la voz por defecto.';
}
// ---- nombre del asistente (se inyecta en el Prompt Maestro) ----
$('form-nombre-ia').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const estado = $('nombre-ia-estado');
    const nombre = $('nombre-ia').value.trim() || 'Nexo';
    try {
        const r = await api('/api/perfil', { nombreIA: nombre }, 'PUT');
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo guardar el nombre.', 'error');
        perfil = r.data.perfil;
        $('nombre-ia').value = perfil.nombreIA;
        actualizarUsuario({ nombreIA: perfil.nombreIA });
        decir(estado, `Listo: el asistente se presentará como «${perfil.nombreIA}».`, 'ok');
    } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
});

$('btn-voz-probar').addEventListener('click', async () => {
    const boton = $('btn-voz-probar');
    if (boton.dataset.hablando === '1') { callar(); return; }
    boton.dataset.hablando = '1'; boton.textContent = '■ Detener';
    try { await hablar($('voz-prueba').value || 'Hola, soy tu asistente de LearnTrack.', { voz: selVoz.value }); }
    finally { delete boton.dataset.hablando; boton.textContent = '▶ Probar voz'; }
});
$('btn-voz-guardar').addEventListener('click', async () => {
    const estado = $('voz-estado');
    const boton = $('btn-voz-guardar');
    boton.disabled = true;
    try {
        const r = await api('/api/perfil', { vozAsistente: selVoz.value }, 'PUT');
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo guardar la voz.', 'error');
        perfil = r.data.perfil;
        fijarVozPreferida(perfil.vozAsistente);
        actualizarUsuario({ vozAsistente: perfil.vozAsistente });
        decir(estado, perfil.vozAsistente ? `Voz guardada: ${perfil.vozAsistente}.` : 'Voz guardada: automática.', 'ok');
    } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
    finally { boton.disabled = false; }
});

// ---------------------------------------------------------------- 3. estética
// ---- temas predeterminados (se aplican al instante y se guardan) ----
for (const radio of document.querySelectorAll('input[name="tema"]')) {
    radio.addEventListener('change', async () => {
        const estado = $('tema-estado');
        const anterior = aparienciaGuardada();
        descartarVistaPrevia({ restaurar: false });
        Tema()?.aplicar({ ...anterior, temaSeleccionado: radio.value, variablesTema: radio.value === 'personalizado' ? perfil.variablesTema : null });
        decir(estado, 'Guardando…');
        try {
            const r = await api('/api/perfil', { temaSeleccionado: radio.value }, 'PUT');
            if (!r.ok) throw new Error(r.data.error);
            perfil = r.data.perfil;
            Tema()?.aplicar(aparienciaGuardada());
            decir(estado, 'Tema guardado en tu cuenta.', 'ok');
        } catch {
            Tema()?.aplicar(anterior);                               // si falla, vuelve al anterior
            for (const r of document.querySelectorAll('input[name="tema"]')) r.checked = r.value === anterior.temaSeleccionado;
            decir(estado, 'No se pudo guardar el tema. Se restauró el anterior.', 'error');
        }
    });
}

// ---- paleta con IA: el navegador pide al servidor POST /api/perfil/paleta { color } y el servidor hace el
//      POST a Colormind (colormind.io solo responde por HTTP y la CSP no deja conectar con otros dominios) ----
let paletaPropuesta = null;              // { colores, variables, fuente }
$('color-semilla').addEventListener('input', (e) => { $('color-semilla-hex').textContent = e.target.value; });

function descartarVistaPrevia({ restaurar = true } = {}) {
    if (!paletaPropuesta) return;
    paletaPropuesta = null;
    $('paleta-resultado').hidden = true;
    if (restaurar) Tema()?.aplicar(aparienciaGuardada());
}

$('form-paleta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const estado = $('paleta-estado');
    const boton = $('btn-paleta-generar');
    boton.disabled = true;
    decir(estado, 'Generando paleta…');
    try {
        const r = await api('/api/perfil/paleta', { color: $('color-semilla').value });
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo generar la paleta.', 'error');
        paletaPropuesta = r.data;
        const lista = $('paleta-colores');
        lista.replaceChildren(...r.data.colores.map((c, i) => {
            const muestra = h('span', { class: 'paleta-muestra', 'aria-hidden': 'true' });
            muestra.style.setProperty('background', c);
            return h('li', {}, muestra, h('code', { texto: c }), i === 0 ? h('small', { texto: 'base' }) : null);
        }));
        $('paleta-resultado').hidden = false;
        // Vista previa en toda la página (sin guardar todavía)
        Tema()?.aplicar({ temaSeleccionado: 'personalizado', variablesTema: r.data.variables, imagenFondoUrl: perfil.imagenFondoUrl }, false);
        decir(estado, r.data.fuente === 'colormind'
            ? 'Paleta generada por Colormind. Así se vería la página: guárdala si te gusta.'
            : 'Colormind no respondió; generamos una paleta armónica parecida. Así se vería la página.', r.data.fuente === 'colormind' ? 'ok' : '');
    } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
    finally { boton.disabled = false; }
});
$('btn-paleta-guardar').addEventListener('click', async () => {
    if (!paletaPropuesta) return;
    const estado = $('paleta-estado');
    try {
        const r = await api('/api/perfil', { temaSeleccionado: 'personalizado', coloresPersonalizados: paletaPropuesta.colores }, 'PUT');
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo guardar la paleta.', 'error');
        paletaPropuesta = null;
        $('paleta-resultado').hidden = true;
        pintarTodo(r.data);
        decir(estado, 'Paleta guardada: ahora es tu tema «Mi paleta».', 'ok');
    } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
});
$('btn-paleta-descartar').addEventListener('click', () => { descartarVistaPrevia(); decir($('paleta-estado'), 'Vista previa descartada.'); });

// ---- fondo personalizado: multipart (campo "imagen") → multer en el servidor ----
$('fondo-archivo').addEventListener('change', async (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    const estado = $('fondo-estado');
    if (!archivo) return;
    if (!esImagenAceptada(archivo)) return decir(estado, 'Elige una imagen JPG, PNG o WebP.', 'error');
    if (archivo.size > 25 * 1024 * 1024) return decir(estado, 'La imagen es demasiado grande (máximo 25 MB).', 'error');
    decir(estado, 'Subiendo fondo…');
    try {
        const blob = await reducirImagen(archivo, { lado: 1920, calidad: 0.82 });
        const datos = new FormData();
        datos.append('imagen', blob, 'fondo.jpg');
        const r = await enviarArchivo('/api/perfil/fondo', { method: 'POST', body: datos });
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo subir el fondo.', 'error');
        pintarTodo(r.data);
        decir(estado, 'Fondo aplicado en todas tus páginas.', 'ok');
    } catch {
        decir(estado, 'No pude leer esa imagen. Prueba con otra.', 'error');
    }
});
$('btn-fondo-quitar').addEventListener('click', async () => {
    const r = await api('/api/perfil/fondo', undefined, 'DELETE');
    if (!r.ok) return decir($('fondo-estado'), r.data.error ?? 'No se pudo quitar el fondo.', 'error');
    pintarTodo(r.data);
    decir($('fondo-estado'), 'Fondo quitado.', 'ok');
});

// ---------------------------------------------------------------- 4. cuentas vinculadas
for (const tarjeta of document.querySelectorAll('.cuenta')) {
    const boton = tarjeta.querySelector('[data-accion]');
    boton.addEventListener('click', async () => {
        const servicio = tarjeta.dataset.servicio;
        const nombre = tarjeta.querySelector('h3').textContent;
        const vincular = !perfil.cuentasVinculadas[servicio]?.vinculada;
        const estado = $('cuentas-estado');
        boton.disabled = true;
        decir(estado, '');
        try {
            const r = vincular
                ? await api('/api/perfil/vincular', { servicio })
                : await api(`/api/perfil/vincular/${servicio}`, undefined, 'DELETE');
            if (!r.ok) { decir(estado, r.data.error ?? `No se pudo ${vincular ? 'conectar' : 'desconectar'} ${nombre}.`, 'error'); return; }
            perfil = r.data.perfil; integraciones = r.data.integraciones;
            decir(estado, vincular ? `${nombre}: conectado.` : `${nombre}: desconectado.`, 'ok');
        } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
        finally { pintarCuentas(); }
    });
}

// ---------------------------------------------------------------- 5. notificaciones
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

// ---------------------------------------------------------------- 6. privacidad y seguridad
$('form-password').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const estado = $('password-estado');
    const actual = $('pw-actual-cambio').value, nueva = $('pw-nueva').value;
    if (!actual) { $('pw-actual-cambio').focus(); return decir(estado, 'Escribe tu contraseña actual.', 'error'); }
    if (!nueva) { $('pw-nueva').focus(); return decir(estado, 'Escribe la contraseña nueva.', 'error'); }
    if (nueva !== $('pw-confirma').value) { $('pw-confirma').focus(); return decir(estado, 'Las contraseñas nuevas no coinciden.', 'error'); }
    const boton = $('btn-cambiar-password');
    boton.disabled = true;
    try {
        const r = await api('/api/perfil', { passwordActual: actual, passwordNueva: nueva }, 'PUT');
        if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo cambiar la contraseña.', 'error');
        perfil = r.data.perfil;
        $('form-password').reset();
        decir(estado, 'Contraseña cambiada. Cerramos tus otras sesiones por seguridad.', 'ok');
    } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
    finally { boton.disabled = false; }
});

// ---- eliminar cuenta: doble confirmación (1. botón → ventana; 2. contraseña + escribir ELIMINAR) ----
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
        Tema()?.olvidar();
        location.assign('/');
    } catch { error.textContent = 'No se pudo conectar con el servidor.'; }
    finally { boton.disabled = false; }
});

// ---------------------------------------------------------------- arranque
montarBarraNavegacion();
pestanaDesdeHash();
(async () => {
    try {
        const r = await api('/api/perfil');
        if (!r.ok) throw new Error();
        pintarTodo(r.data);
        if (!$('panel-voz').hidden) prepararVoces();
    } catch {
        $('resumen-nombre').textContent = 'No se pudo cargar tu configuración';
        aviso('No se pudo cargar tu configuración. Recarga la página.');
    }
})();
