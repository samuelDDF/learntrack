// Proyectos (módulo ES): eliges un proyecto de la lista y ves el progreso de sus subtareas como Kanban (Pendiente /
// En proceso / Completado, con arrastrar y soltar) o como Línea de tiempo (Gantt con la fecha de vencimiento).
// Kanban y Timeline estaban antes en Mi agenda. Incluye las tareas archivadas por la limpieza automática (cuentan
// para el progreso y se pueden devolver a la agenda). Todo el texto entra con textContent (nunca innerHTML).
import { normalizarActividad } from '/app/compartido/carga.js';
import { sumarDias, diasEntre, textoHorario } from '/app/compartido/fechas.js';
import { ESTADOS, NOMBRE_TIPO, NOMBRE_ESTADO } from '/app/compartido/catalogos.js';
import { prioridadDe, porUrgencia, textoVencimiento, NOMBRE_PRIORIDAD } from '/app/compartido/prioridad.js';
import { h, api, aviso, hoyISO } from '/app/comun/utilidades.js';
import { usuarioActual } from '/app/comun/sesion.js';
import { montarBarraNavegacion } from '/app/componentes/barra-navegacion/barra-navegacion.js';
import { crearFormularioActividad } from '/app/componentes/formulario-actividad/formulario-actividad.js';

const $ = (id) => document.getElementById(id);
const CLAVE_MODO = 'learntrack_vista_proyecto';
let actividades = [];          // activas + archivadas
let proyectos = [];            // resumen del servidor (/api/proyectos)
let seleccionado = null;       // nombre del proyecto
let modo = 'kanban';           // 'kanban' | 'timeline'

// ---------------------------------------------------------------- utilidades de presentación
const aFecha = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, 12); };
const fmt = (iso, opc) => aFecha(iso).toLocaleDateString('es', opc);
const diaCorto = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
const horasTxt = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
const claseAct = (a) => `t-${a.tipo} est-${a.estado}${a.exigencia === 3 ? ' exig-alta' : ''}${a.archivada ? ' archivada' : ''}`;
const insignia = (texto, clase = '') => h('span', { class: `insignia ${clase}`.trim(), texto });
const delProyecto = () => actividades.filter((a) => a.proyecto === seleccionado);
function insigniaPrioridad(a) {
    const p = prioridadDe(a, hoyISO());
    if (p.nivel === 'ninguna' || (p.nivel === 'media' && !p.vencimiento)) return null;
    return insignia([p.nivel === 'urgente' ? '⚠ Urgente' : NOMBRE_PRIORIDAD[p.nivel], textoVencimiento(p)].filter(Boolean).join(' · '), `prioridad-${p.nivel}`);
}

// ---------------------------------------------------------------- datos
async function cargar() {
    const [rp, ra] = await Promise.all([api('/api/proyectos'), api('/api/actividades?archivadas=incluir')]);
    if (rp.ok) proyectos = rp.data.proyectos;
    if (ra.ok) actividades = ra.data.map(normalizarActividad);
    if (!proyectos.some((p) => p.nombre === seleccionado)) seleccionado = proyectos.find((p) => p.progreso < 100)?.nombre ?? proyectos[0]?.nombre ?? null;
    pintar();
}

async function cambiarEstado(a, estado) {
    if (a.estado === estado || a.archivada) return;
    const anterior = a.estado;
    a.estado = estado;                       // actualización optimista
    pintarDetalle();
    const r = await api(`/api/actividades/${encodeURIComponent(a.id)}`, { estado }, 'PUT').catch(() => null);
    if (!r?.ok) { a.estado = anterior; aviso('No pude cambiar el estado. Inténtalo de nuevo.'); pintarDetalle(); return; }
    await cargar();
}

async function desarchivar(a) {
    const r = await api(`/api/actividades/${encodeURIComponent(a.id)}/desarchivar`, {}).catch(() => null);
    if (r?.ok) { aviso(`«${a.titulo}» vuelve a tu agenda.`); await cargar(); } else aviso('No se pudo devolver a la agenda.');
}

const formulario = crearFormularioActividad({ alCambiar: () => cargar(), proyectos: () => proyectos.map((p) => p.nombre) });
const abrir = (a) => { if (!a.archivada) formulario.abrir(a); };

// ---------------------------------------------------------------- lista de proyectos
function pintarLista() {
    const lista = $('lista-proyectos');
    if (proyectos.length === 0) {
        lista.replaceChildren(h('li', { class: 'proyectos-vacio' },
            h('p', { texto: 'Todavía no tienes proyectos.' }),
            h('p', { texto: 'Pídeselo al asistente («Tengo que hacer un proyecto de bases de datos para el 20 de noviembre») o ponle un nombre de proyecto a tus actividades.' }),
            h('a', { class: 'boton boton-primario', href: '/panel', texto: 'Ir al asistente' })));
        return;
    }
    lista.replaceChildren(...proyectos.map((p) => {
        const activo = p.nombre === seleccionado;
        const barra = h('span', { class: 'proyecto-barra', 'aria-hidden': 'true' }, h('i'));
        barra.firstChild.style.setProperty('width', `${p.progreso}%`);
        return h('li', {}, h('button', {
            type: 'button', class: `proyecto-tarjeta prioridad-${p.prioridad}${activo ? ' activo' : ''}`, 'aria-pressed': String(activo),
            'aria-label': `${p.nombre}: ${p.progreso} % (${p.completadas} de ${p.total} tareas)`,
            on: { click: () => { seleccionado = p.nombre; history.replaceState(null, '', `#${encodeURIComponent(p.nombre)}`); pintar(); } }
        },
            h('span', { class: 'proyecto-nombre', texto: `📁 ${p.nombre}` }),
            barra,
            h('span', { class: 'proyecto-datos', texto: `${p.progreso} % · ${p.completadas}/${p.total} tareas${p.fin ? ` · hasta ${diaCorto(p.fin)}` : ''}` }),
            p.siguiente ? h('small', { class: 'proyecto-siguiente', texto: `Siguiente: ${p.siguiente.titulo}` }) : h('small', { class: 'proyecto-siguiente', texto: '✓ Todo terminado' })));
    }));
}

// ---------------------------------------------------------------- Kanban del proyecto
function vistaKanban() {
    const tareas = delProyecto();
    const columnas = ESTADOS.map((estado) => {
        const lista = tareas.filter((a) => a.estado === estado).sort(porUrgencia(hoyISO()));
        const idx = ESTADOS.indexOf(estado);
        const col = h('div', { class: 'kb-col', 'data-estado': estado, role: 'list', 'aria-label': NOMBRE_ESTADO[estado] },
            h('header', {}, h('h3', { texto: NOMBRE_ESTADO[estado] }), h('span', { class: 'kb-cuenta', texto: String(lista.length) })),
            lista.length === 0 ? h('div', { class: 'kb-vacio', texto: 'Arrastra tarjetas aquí' }) : null,
            lista.map((a) => h('article', {
                class: `kb-tarjeta ${claseAct(a)}`, draggable: a.archivada ? 'false' : 'true', role: 'listitem',
                on: {
                    dragstart: (e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('arrastrando'); },
                    dragend: (e) => e.currentTarget.classList.remove('arrastrando')
                }
            },
                h('button', { type: 'button', class: 'tit-k tit', texto: a.titulo, disabled: a.archivada, on: { click: () => abrir(a) } }),
                h('div', { class: 'meta' }, insignia(NOMBRE_TIPO[a.tipo], `t-${a.tipo}`), a.exigencia === 3 ? insignia('Alta', 'alta') : null, insigniaPrioridad(a), a.archivada ? insignia('🗄 Archivada') : null),
                h('div', { class: 'cuando', texto: `${diaCorto(a.fecha_inicio)}${a.fecha_fin !== a.fecha_inicio ? ` → ${diaCorto(a.fecha_fin)}` : ''}${a.hora_inicio ? ` · ${textoHorario(a)}` : ''} · ${horasTxt(a.horas)}${a.fecha_vencimiento ? ` · vence ${diaCorto(a.fecha_vencimiento)}` : ''}` }),
                a.archivada
                    ? h('div', { class: 'kb-mover' }, h('button', { type: 'button', class: 'boton boton-mini', texto: '↩ Devolver a la agenda', on: { click: () => desarchivar(a) } }))
                    : h('div', { class: 'kb-mover' },
                        h('button', { type: 'button', class: 'boton boton-mini', texto: '◀', disabled: idx === 0, 'aria-label': `Mover ${a.titulo} a ${NOMBRE_ESTADO[ESTADOS[idx - 1]] ?? ''}`, on: { click: () => cambiarEstado(a, ESTADOS[idx - 1]) } }),
                        h('button', { type: 'button', class: 'boton boton-mini', texto: '▶', disabled: idx === ESTADOS.length - 1, 'aria-label': `Mover ${a.titulo} a ${NOMBRE_ESTADO[ESTADOS[idx + 1]] ?? ''}`, on: { click: () => cambiarEstado(a, ESTADOS[idx + 1]) } })))));
        col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('sobre'); });
        col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('sobre'); });
        col.addEventListener('drop', (e) => {
            e.preventDefault(); col.classList.remove('sobre');
            const act = actividades.find((x) => x.id === e.dataTransfer.getData('text/plain'));
            if (act) cambiarEstado(act, estado);
        });
        return col;
    });
    return h('div', { class: 'kanban' }, columnas);
}

// ---------------------------------------------------------------- Línea de tiempo (Gantt) del proyecto
function vistaTimeline() {
    const hoy = hoyISO();
    const tareas = delProyecto().sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio) || x.titulo.localeCompare(y.titulo, 'es'));
    if (tareas.length === 0) return h('div', { class: 'vacio', texto: 'Este proyecto no tiene tareas.' });
    const fechas = tareas.flatMap((a) => [a.fecha_inicio, a.fecha_fin, a.fecha_vencimiento].filter(Boolean)).concat(hoy).sort();
    const ini = sumarDias(fechas[0], -1), fin = sumarDias(fechas.at(-1), 1);
    const n = Math.min(diasEntre(ini, fin) + 1, 120);
    const ETQ = 220, DW = 30;
    const plantilla = `${ETQ}px repeat(${n}, ${DW}px)`;
    const dias = Array.from({ length: n }, (_, i) => sumarDias(ini, i));
    const ultimo = dias.at(-1);
    const columna = (desde, hasta) => {
        const c1 = Math.max(0, diasEntre(ini, desde)), c2 = Math.min(n - 1, diasEntre(ini, hasta));
        return `${c1 + 2} / ${c2 + 3}`;
    };
    const celdas = () => dias.map((d, i) => h('div', {
        class: `g-celda${aFecha(d).getDay() % 6 === 0 ? ' fin-sem' : ''}${d === hoy ? ' hoy' : ''}`,
        estilo: { 'grid-column': String(i + 2), 'grid-row': '1' }
    }));
    const cab = h('div', { class: 'g-fila g-cab', estilo: { 'grid-template-columns': plantilla } },
        h('div', { class: 'g-etq', texto: 'Tarea' }),
        dias.map((d) => h('div', { class: `g-dia${d === hoy ? ' hoy' : ''}` }, h('strong', { texto: String(aFecha(d).getDate()) }), fmt(d, { month: 'short' }).replace('.', ''))));
    const filas = tareas.map((a) => {
        const desc = `${a.titulo}. ${NOMBRE_ESTADO[a.estado]}. Del ${diaCorto(a.fecha_inicio)} al ${diaCorto(a.fecha_fin)}${a.fecha_vencimiento ? `, vence el ${diaCorto(a.fecha_vencimiento)}` : ''}.`;
        return h('div', { class: 'g-fila', estilo: { 'grid-template-columns': plantilla } },
            h('div', { class: 'g-etq', estilo: { 'grid-column': '1', 'grid-row': '1' } }, h('span', { class: `punto t-${a.tipo}` }), h('span', { class: 't', texto: a.titulo, title: a.titulo }),
                prioridadDe(a, hoy).nivel === 'urgente' ? h('span', { class: 'g-urgente', title: 'Urgente: vence en 2 días o menos', texto: '⚠' }) : null),
            celdas(),
            a.fecha_vencimiento && a.fecha_vencimiento <= ultimo
                ? h('span', { class: 'g-vence', title: `Vence el ${diaCorto(a.fecha_vencimiento)}`, 'aria-hidden': 'true', texto: '◆', estilo: { 'grid-column': columna(a.fecha_vencimiento, a.fecha_vencimiento), 'grid-row': '1' } })
                : null,
            h('button', {
                type: 'button', class: `g-barra ${claseAct(a)}`, texto: a.titulo, title: desc, 'aria-label': desc, disabled: a.archivada,
                estilo: { 'grid-column': columna(a.fecha_inicio, a.fecha_fin), 'grid-row': '1' },
                on: { click: () => abrir(a) }
            }));
    });
    return h('div', {},
        h('div', { class: 'gantt-marco' }, h('div', { estilo: { 'min-width': `${ETQ + n * DW}px` } }, cab, filas)),
        h('p', { class: 'gantt-leyenda', texto: '◆ = fecha de vencimiento · franja sombreada = hoy · las barras rayadas están en proceso' }));
}

// ---------------------------------------------------------------- detalle del proyecto
function pintarDetalle() {
    const p = proyectos.find((x) => x.nombre === seleccionado);
    $('detalle-vacio').hidden = Boolean(p);
    $('detalle-proyecto').hidden = !p;
    if (!p) return;
    const tareas = delProyecto();
    const hechas = tareas.filter((a) => a.estado === 'completado').length;
    const progreso = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;
    $('proyecto-titulo').textContent = p.nombre;
    $('proyecto-resumen').textContent = `${hechas} de ${tareas.length} tareas completadas${p.inicio && p.fin ? ` · ${diaCorto(p.inicio)} → ${diaCorto(p.fin)}` : ''}`;
    $('proyecto-progreso-texto').textContent = `${progreso} %`;
    $('proyecto-progreso').style.setProperty('width', `${progreso}%`);
    $('proyecto-progreso-rol').setAttribute('aria-valuenow', String(progreso));
    for (const b of document.querySelectorAll('[data-modo]')) b.setAttribute('aria-pressed', String(b.dataset.modo === modo));
    $('vista-proyecto').replaceChildren(modo === 'kanban' ? vistaKanban() : vistaTimeline());
}

function pintar() {
    pintarLista();
    pintarDetalle();
}

// ---------------------------------------------------------------- arranque
montarBarraNavegacion();
for (const b of document.querySelectorAll('[data-modo]')) {
    b.addEventListener('click', () => {
        modo = b.dataset.modo;
        try { localStorage.setItem(CLAVE_MODO, modo); } catch { /* sin almacenamiento */ }
        pintarDetalle();
    });
}
$('btn-nueva-tarea').addEventListener('click', () => formulario.abrir(null, { proyecto: seleccionado ?? '' }));
window.addEventListener('hashchange', () => { const n = decodeURIComponent(location.hash.slice(1)); if (proyectos.some((p) => p.nombre === n)) { seleccionado = n; pintar(); } });

(async () => {
    try { const m = localStorage.getItem(CLAVE_MODO); if (m === 'kanban' || m === 'timeline') modo = m; } catch { /* nada */ }
    if (location.hash.length > 1) seleccionado = decodeURIComponent(location.hash.slice(1));
    if (!(await usuarioActual())) { location.assign('/?acceso=login'); return; }
    try { await cargar(); } catch { aviso('No se pudieron cargar tus proyectos. Recarga la página.'); }
})();
