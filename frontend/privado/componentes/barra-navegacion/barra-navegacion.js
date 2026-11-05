// barra-navegacion.js — Parte izquierda de la barra de navegación de las páginas privadas (módulo ES):
//  · Avatar  → panel lateral (off-canvas) con el perfil: «Cambiar de cuenta», «Cerrar sesión» y el importador de
//              DÍAS FESTIVOS (Nager.Date a través del servidor). La importación solo SUMA festivos: nunca crea,
//              cambia ni borra tareas o eventos del usuario.
//  · Engranaje → menú desplegable con las secciones de Configuración.
// Uso: <div class="barra-cuenta" id="barra-cuenta"></div> en la cabecera + montarBarraNavegacion().
// Avisa a la página con el evento `festivos-actualizados` (document) cuando cambian los festivos importados.
import { h, api, confirmarEnDosPasos } from '/app/comun/utilidades.js';
import { usuarioActual } from '/app/comun/sesion.js';

export const SECCIONES_CONFIGURACION = [
    { id: 'informacion', icono: '👤', texto: 'Información básica' },
    { id: 'voz', icono: '🗣️', texto: 'Voz de la IA' },
    { id: 'estetica', icono: '🎨', texto: 'Estética de la página' },
    { id: 'cuentas', icono: '🔗', texto: 'Cuentas vinculadas' },
    { id: 'notificaciones', icono: '🔔', texto: 'Notificaciones' },
    { id: 'privacidad', icono: '🔒', texto: 'Privacidad y seguridad' }
];

// ---------------------------------------------------------------- iconos SVG (sin innerHTML)
const NS = 'http://www.w3.org/2000/svg';
function svg(atributos, ...formas) {
    const raiz = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', ...atributos })) raiz.setAttribute(k, v);
    for (const [tag, attrs] of formas) {
        const forma = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) forma.setAttribute(k, v);
        raiz.append(forma);
    }
    return raiz;
}
const iconoEngranaje = () => svg({}, ['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }]);
const iconoCerrar = () => svg({ width: 20, height: 20 }, ['path', { d: 'M6 6l12 12M18 6L6 18' }]);

const inicialDe = (nombre) => (String(nombre ?? '').trim()[0] ?? '?').toUpperCase();
function decir(elem, texto, tipo = '') {
    elem.textContent = texto;
    elem.classList.toggle('ok', tipo === 'ok');
    elem.classList.toggle('error', tipo === 'error');
}

/** Cierra la sesión en el servidor, olvida la apariencia guardada en este navegador y va a `destino` */
async function salir(boton, destino) {
    boton.disabled = true;
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* se redirige igualmente */ }
    window.LearnTrackTema?.olvidar?.();
    location.assign(destino);
}

// ---------------------------------------------------------------- avatar (botón y cabecera del panel)
function avatar(clase) {
    const img = h('img', { alt: '', hidden: true });
    const letra = h('span', { class: 'avatar-inicial', texto: '?' });
    const caja = h('span', { class: `avatar ${clase}`, 'aria-hidden': 'true' }, img, letra);
    caja.pintar = (u) => {
        letra.textContent = inicialDe(u?.nombre);
        const url = u?.avatarUrl ?? null;
        img.hidden = !url; letra.hidden = Boolean(url);
        if (url) img.src = url; else img.removeAttribute('src');
    };
    return caja;
}

// ---------------------------------------------------------------- menú del engranaje (desplegable)
function crearMenuConfiguracion() {
    const enConfiguracion = location.pathname === '/configuracion';
    const boton = h('button', {
        type: 'button', class: `barra-icono barra-engranaje${enConfiguracion ? ' activo' : ''}`, id: 'btn-configuracion',
        'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'menu-configuracion', title: 'Configuración'
    }, iconoEngranaje(), h('span', { class: 'solo-lectores', texto: 'Configuración' }));
    const enlaces = SECCIONES_CONFIGURACION.map((s) => h('li', {},
        h('a', { href: `/configuracion#${s.id}`, 'data-seccion': s.id }, h('span', { 'aria-hidden': 'true', texto: s.icono }), h('span', { texto: s.texto }))));
    const menu = h('div', { class: 'barra-desplegable', id: 'menu-configuracion', hidden: true },
        h('p', { class: 'barra-desplegable-titulo', texto: 'Configuración' }),
        h('ul', {}, enlaces));
    const envoltorio = h('div', { class: 'barra-config' }, boton, menu);

    const abrir = (si, { enfocar = false } = {}) => {
        menu.hidden = !si;
        boton.setAttribute('aria-expanded', String(si));
        if (si && enfocar) menu.querySelector('a')?.focus();
    };
    boton.addEventListener('click', () => abrir(menu.hidden));
    boton.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); abrir(true, { enfocar: true }); } });
    menu.addEventListener('keydown', (e) => {
        const lista = [...menu.querySelectorAll('a')];
        const i = lista.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            lista[(i + (e.key === 'ArrowDown' ? 1 : -1) + lista.length) % lista.length].focus();
        }
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) abrir(false); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !envoltorio.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { abrir(false); boton.focus(); } });
    envoltorio.addEventListener('focusout', (e) => { if (!menu.hidden && e.relatedTarget && !envoltorio.contains(e.relatedTarget)) abrir(false); });
    return envoltorio;
}

// ---------------------------------------------------------------- importador de festivos
function crearSeccionFestivos() {
    const anioActual = new Date().getFullYear();
    const nombresPais = (() => { try { return new Intl.DisplayNames(['es'], { type: 'region' }); } catch { return null; } })();
    const nombrePais = (p) => { try { return nombresPais?.of(p.codigo) || p.nombre; } catch { return p.nombre; } };

    const selPais = h('select', { id: 'festivo-pais', required: true }, h('option', { value: '', texto: 'Cargando países…' }));
    const selRegion = h('select', { id: 'festivo-region', 'aria-describedby': 'festivo-region-ayuda' }, h('option', { value: '', texto: 'Solo feriados nacionales' }));
    const selAnio = h('select', { id: 'festivo-anio' },
        [anioActual - 1, anioActual, anioActual + 1, anioActual + 2].map((a) => h('option', { value: a, texto: a, selected: a === anioActual })));
    const btnImportar = h('button', { type: 'submit', class: 'boton boton-primario', texto: 'Importar feriados' });
    const estado = h('p', { class: 'mensaje', role: 'status', 'aria-live': 'polite' });
    const resumen = h('p', { class: 'festivos-resumen' });
    const btnQuitar = h('button', { type: 'button', class: 'boton boton-peligro boton-mini', texto: 'Quitar feriados importados', hidden: true });

    const form = h('form', { class: 'festivos-form', novalidate: true },
        h('div', { class: 'campo' }, h('label', { for: 'festivo-pais', texto: 'País' }), selPais),
        h('div', { class: 'campo' }, h('label', { for: 'festivo-region', texto: 'Región o ciudad (opcional)' }), selRegion,
            h('small', { id: 'festivo-region-ayuda', class: 'ayuda', texto: 'Suma también los feriados locales de esa región (estado, provincia o comunidad), si el país los publica.' })),
        h('div', { class: 'campo' }, h('label', { for: 'festivo-anio', texto: 'Año' }), selAnio),
        btnImportar, estado);

    const seccion = h('section', { class: 'offcanvas-seccion festivos', 'aria-labelledby': 'festivos-titulo' },
        h('h3', { id: 'festivos-titulo', texto: 'Tu país/ciudad' }),
        h('p', { class: 'ayuda', texto: 'Añade a tu agenda los dias feriados de tu país.' }),
        form, h('div', { class: 'festivos-pie' }, resumen, btnQuitar));

    let paisesCargados = false;
    const avisar = (festivos) => document.dispatchEvent(new CustomEvent('festivos-actualizados', { detail: { festivos } }));

    function pintarResumen(festivos) {
        const n = festivos.length;
        resumen.textContent = n ? `Tienes ${n} festivo${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'}.` : 'Todavía no has importado el calendario de tu país.';
        btnQuitar.hidden = n === 0;
    }

    async function cargarRegiones() {
        const pais = selPais.value;
        selRegion.replaceChildren(h('option', { value: '', texto: 'Se toma en cuenta el calendario nacional' }));
        selRegion.disabled = true;
        if (!pais) return;
        try {
            const r = await api(`/api/festivos/regiones?pais=${encodeURIComponent(pais)}&anio=${selAnio.value}`);
            if (r.ok && pais === selPais.value) {
                selRegion.append(...r.data.regiones.map((codigo) => h('option', { value: codigo, texto: codigo.replace(`${pais}-`, '') + ` (${codigo})` })));
            }
        } catch { /* sin regiones: solo nacionales */ }
        selRegion.disabled = selRegion.options.length <= 1;
    }

    /** Se llama al abrir el panel: países (una vez), festivos ya importados y país sugerido */
    async function preparar() {
        decir(estado, '');
        try {
            const actuales = await api('/api/festivos');
            const festivos = actuales.ok ? actuales.data.festivos : [];
            pintarResumen(festivos);
            if (paisesCargados) return;
            const r = await api('/api/festivos/paises');
            if (!r.ok) { selPais.replaceChildren(h('option', { value: '', texto: 'No disponible' })); decir(estado, r.data.error ?? 'No se pudo cargar la lista de países.', 'error'); return; }
            const paises = r.data.paises.map((p) => ({ codigo: p.codigo, nombre: nombrePais(p) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            selPais.replaceChildren(h('option', { value: '', texto: 'Elige un país…' }), ...paises.map((p) => h('option', { value: p.codigo, texto: p.nombre })));
            // País sugerido: el último importado o el del idioma del navegador (es-CO → CO)
            const sugerido = festivos.at(-1)?.pais ?? (navigator.language.split('-')[1] ?? '').toUpperCase();
            if (paises.some((p) => p.codigo === sugerido)) selPais.value = sugerido;
            paisesCargados = true;
            await cargarRegiones();
        } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
    }

    selPais.addEventListener('change', cargarRegiones);
    selAnio.addEventListener('change', cargarRegiones);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!selPais.value) { selPais.focus(); return decir(estado, 'Elige un país.', 'error'); }
        btnImportar.disabled = true;
        decir(estado, 'Buscando feriados…');
        try {
            const cuerpo = { pais: selPais.value, anio: Number(selAnio.value) };
            if (selRegion.value) cuerpo.region = selRegion.value;
            const r = await api('/api/festivos/importar', cuerpo);
            if (!r.ok) return decir(estado, r.data.error ?? 'No se pudo importar el calendario.', 'error');
            const { añadidos, yaExistian, limite } = r.data;
            const partes = [añadidos ? `Se añadieron ${añadidos} festivo${añadidos === 1 ? '' : 's'} a tu agenda.` : 'No hay novedades.'];
            if (yaExistian) partes.push(`${yaExistian} ya estaba${yaExistian === 1 ? '' : 'n'}.`);
            if (limite) partes.push('Llegaste al máximo de dias feriados guardados: quita algunos para importar más.');
            partes.push('Tus actividades no se tocaron.');
            decir(estado, partes.join(' '), limite ? 'error' : 'ok');
            pintarResumen(r.data.festivos);
            avisar(r.data.festivos);
        } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
        finally { btnImportar.disabled = false; }
    });
    confirmarEnDosPasos(btnQuitar, async () => {
        try {
            const r = await api('/api/festivos', undefined, 'DELETE');
            if (!r.ok) return decir(estado, r.data.error ?? 'No se pudieron quitar.', 'error');
            decir(estado, `Se quitaron ${r.data.eliminados} dias feriados. Tus actividades siguen igual.`, 'ok');
            pintarResumen([]);
            avisar([]);
        } catch { decir(estado, 'No se pudo conectar con el servidor.', 'error'); }
    }, { textoConfirmar: '¿Quitar todos los dias feriados?' });

    return { seccion, preparar };
}

// ---------------------------------------------------------------- panel lateral del perfil (off-canvas)
function crearPanelPerfil() {
    const avatarGrande = avatar('avatar-grande');
    const nombre = h('h2', { id: 'offcanvas-titulo', texto: 'Mi perfil' });
    const email = h('p', { class: 'offcanvas-email' });
    const btnCerrar = h('button', { type: 'button', class: 'barra-icono offcanvas-cerrar', title: 'Cerrar' }, iconoCerrar(), h('span', { class: 'solo-lectores', texto: 'Cerrar' }));
    const btnCambiar = h('button', { type: 'button', class: 'boton', id: 'btn-cambiar-cuenta', texto: '🔁 Cambiar de cuenta' });
    const btnSalir = h('button', { type: 'button', class: 'boton boton-peligro', id: 'btn-salir', texto: '↪ Cerrar sesión' });
    const festivos = crearSeccionFestivos();

    const dialogo = h('dialog', { class: 'offcanvas', id: 'menu-perfil', 'aria-labelledby': 'offcanvas-titulo' },
        h('div', { class: 'offcanvas-cabecera' }, avatarGrande, h('div', { class: 'offcanvas-quien' }, nombre, email), btnCerrar),
        h('nav', { class: 'offcanvas-acciones', 'aria-label': 'Cuenta' },
            h('a', { class: 'boton', href: '/configuracion#informacion', texto: '✏️ Editar mi perfil' }),
            btnCambiar, btnSalir),
        festivos.seccion);

    btnCerrar.addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });   // clic en el fondo
    btnCambiar.addEventListener('click', () => salir(btnCambiar, '/?acceso=login'));
    btnSalir.addEventListener('click', () => salir(btnSalir, '/'));

    const pintar = (u) => {
        avatarGrande.pintar(u);
        nombre.textContent = u?.nombre ?? 'Mi perfil';
        email.textContent = u?.email ?? '';
    };
    return { dialogo, pintar, preparar: festivos.preparar };
}

// ---------------------------------------------------------------- montaje
export function montarBarraNavegacion() {
    const zona = document.getElementById('barra-cuenta');
    if (!zona) return;
    const avatarBoton = avatar('avatar-mini');
    const btnPerfil = h('button', {
        type: 'button', class: 'barra-icono barra-avatar', id: 'btn-perfil',
        'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'menu-perfil', title: 'Mi perfil'
    }, avatarBoton, h('span', { class: 'solo-lectores', texto: 'Mi perfil' }));
    const panel = crearPanelPerfil();
    zona.replaceChildren(btnPerfil, crearMenuConfiguracion());
    document.body.append(panel.dialogo);

    btnPerfil.addEventListener('click', () => {
        if (panel.dialogo.open) return;
        panel.dialogo.showModal();
        btnPerfil.setAttribute('aria-expanded', 'true');
        panel.preparar();
    });
    panel.dialogo.addEventListener('close', () => { btnPerfil.setAttribute('aria-expanded', 'false'); btnPerfil.focus(); });

    const saludo = document.getElementById('saludo-usuario');
    const pintar = (u) => {
        avatarBoton.pintar(u);
        if (saludo) saludo.textContent = u?.nombre ? `Hola, ${u.nombre.split(' ')[0]}` : '';
        panel.pintar(u);
        btnPerfil.title = u?.nombre ? `Mi perfil (${u.nombre})` : 'Mi perfil';
    };
    usuarioActual().then(pintar);
    document.addEventListener('usuario-actualizado', (e) => pintar(e.detail));
}
