// Mi agenda (módulo ES), diseño «Moderno»: a la izquierda un mini calendario y las próximas entregas; a la derecha
// la vista elegida en el desplegable (Mes, Semana o Día). Debajo, la «Línea de tiempo académica» (cada trabajo
// desde que se asignó hasta su fecha de vencimiento). Kanban y Timeline viven ahora en Proyectos (/proyectos).
// Todo el contenido dinámico se escribe con textContent (nunca innerHTML). La carga por día usa la MISMA regla que
// el panel y el servidor (compartido/carga.js); la urgencia, compartido/prioridad.js.
import { normalizarActividad, actividadesDelDia, cargaDelDia, capacidadDe, esEntregaOExamen } from '/app/compartido/carga.js';
import { sumarDias, sumarMeses, diasEntre, inicioSemana, primerDiaMes, ultimoDiaMes, aMinutos, textoHorario } from '/app/compartido/fechas.js';
import { NOMBRE_TIPO, NOMBRE_EXIGENCIA, NOMBRE_ESTADO } from '/app/compartido/catalogos.js';
import { prioridadDe, porUrgencia, textoVencimiento, NOMBRE_PRIORIDAD } from '/app/compartido/prioridad.js';
import { h, api, aviso, hoyISO } from '/app/comun/utilidades.js';
import { usuarioActual } from '/app/comun/sesion.js';
import { montarBarraNavegacion } from '/app/componentes/barra-navegacion/barra-navegacion.js';
import { montarChatIA } from '/app/componentes/chat-ia/chat-ia.js';
import { abrirPapelera } from '/app/componentes/papelera/papelera.js';
import { crearFormularioActividad } from '/app/componentes/formulario-actividad/formulario-actividad.js';


// ====================== Constantes ======================
// Desplegable de vistas (diseño Moderno). Las direcciones antiguas de vista (v3.3) se traducen.
const VISTAS = {
    mes:    { render: vistaMensual, nav: 'mes', etiqueta: 'Mes' },
    semana: { render: vistaSemanal, nav: 'sem', etiqueta: 'Semana' },
    dia:    { render: vistaDia,     nav: 'dia', etiqueta: 'Día' }
};
const VISTAS_ANTIGUAS = { mensual: 'mes', minimalista: 'mes', timeline: 'mes', kanban: 'mes', eventos: 'mes', semanal: 'semana', diario: 'dia', moderno: 'dia' };
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HPX = 48; // alto en píxeles de una hora en la vista semanal

// ====================== Estado ======================
let actividades = [];
let vista = 'mes';
let cursor = hoyISO();           // fecha de referencia de las vistas
const checkins = new Map();      // 'YYYY-MM-DD' -> ánimo (capacidad del día)
const mesesCargados = new Set();

// ====================== Fechas para mostrar (las cuentas las hace compartido/fechas.js) ======================
const aFecha = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, 12); };
const diasDelMes = (iso) => Number(ultimoDiaMes(iso).slice(8));
function mismoMes(a, b) { return a.slice(0, 7) === b.slice(0, 7); }
function cuadriculaMes(iso) {
    const ini = inicioSemana(primerDiaMes(iso));
    return Array.from({ length: 42 }, (_, i) => sumarDias(ini, i));
}
const fmt = (iso, opc) => aFecha(iso).toLocaleDateString('es', opc);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const mesAnio = (iso) => cap(fmt(iso, { month: 'long', year: 'numeric' }));
const diaLargo = (iso) => cap(fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }));
const diaCorto = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
const horasTxt = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

// ====================== DOM helpers ======================
const $ = (id) => document.getElementById(id);

// ====================== Modelo ======================
// Las actividades antiguas (solo "fecha") se normalizan al vuelo (el servidor también las normaliza).
function fijarActividades(lista) { actividades = (Array.isArray(lista) ? lista : []).map(normalizarActividad); }

const ordenar = (a, b) =>
    (a.hora_inicio || '99:99').localeCompare(b.hora_inicio || '99:99') || a.titulo.localeCompare(b.titulo, 'es');
const delDia = (iso) => actividadesDelDia(actividades, iso).sort(ordenar);

// ---- Carga por día (regla única) ----
const cargaDia = (iso) => cargaDelDia(actividades, iso, capacidadDe(checkins.get(iso)));
function insigniaCarga(iso, { siempre = false } = {}) {
    const c = cargaDia(iso);
    if (!siempre && c.cantidad === 0) return null;
    const txt = c.nivel === 'verde' ? 'equilibrado' : c.nivel === 'amarillo' ? 'moderado' : 'saturado';
    return h('span', { class: `carga-dia nivel-${c.nivel}`, title: `Carga del día: ${c.porcentaje} % (${txt})`, 'aria-label': `Carga ${c.porcentaje} por ciento, ${txt}`, texto: `${c.porcentaje} %` });
}
async function asegurarCheckins(iso) {
    const mes = iso.slice(0, 7);
    if (mesesCargados.has(mes)) return;
    mesesCargados.add(mes);
    const desde = sumarDias(primerDiaMes(iso), -7), hasta = sumarDias(primerDiaMes(sumarMeses(iso, 1)), 7);
    const r = await api(`/api/checkins?desde=${desde}&hasta=${hasta}`).catch(() => null);
    if (r?.ok) { for (const c of r.data.checkins) checkins.set(c.fecha, c.animo); render(); }
    else mesesCargados.delete(mes);
}
// ---- Festivos importados (Perfil › Calendario de días festivos). Viven aparte de las actividades: aquí solo se
//      muestran (no se pueden editar, mover ni borrar desde la agenda y no suman carga). ----
const festivosPorFecha = new Map();   // 'YYYY-MM-DD' -> [{ nombre, region, … }]
function fijarFestivos(lista) {
    festivosPorFecha.clear();
    for (const f of Array.isArray(lista) ? lista : []) {
        if (!festivosPorFecha.has(f.fecha)) festivosPorFecha.set(f.fecha, []);
        festivosPorFecha.get(f.fecha).push(f);
    }
}
const festivosDe = (iso) => festivosPorFecha.get(iso) ?? [];
const textoFestivos = (iso) => festivosDe(iso).map((f) => f.nombre).join(' · ');
const chipsFestivo = (iso) => festivosDe(iso).map((f) =>
    h('span', { class: 'chip-festivo', title: `Festivo: ${f.nombre}${f.region ? ` (${f.region})` : ''}`, texto: `🎉 ${f.nombre}` }));
const avisoFestivo = (iso) => (festivosDe(iso).length ? h('p', { class: 'aviso-festivo', role: 'note', texto: `🎉 Festivo: ${textoFestivos(iso)}` }) : null);
async function cargarFestivos() {
    const r = await api('/api/festivos').catch(() => null);
    if (r?.ok) { fijarFestivos(r.data.festivos); render(); }
}

const claseAct = (a) => `t-${a.tipo} est-${a.estado}${a.exigencia === 3 ? ' exig-alta' : ''}`;
const descripcionAct = (a) => `${a.titulo}. ${NOMBRE_TIPO[a.tipo]}. ${textoHorario(a) || 'Sin hora'}. ${NOMBRE_ESTADO[a.estado]}.`;

// ====================== Componentes ======================
const urgente = (a) => prioridadDe(a, hoyISO()).nivel === 'urgente';
function chip(a) {
    const hora = a.hora_inicio ? h('span', { class: 'h', texto: a.hora_inicio }) : null;
    const desc = `${descripcionAct(a)}${urgente(a) ? ' Urgente.' : ''}`;
    return h('button', {
        type: 'button', class: `chip ${claseAct(a)}${urgente(a) ? ' urgente' : ''}`, title: desc, 'aria-label': desc,
        on: { click: (e) => { e.stopPropagation(); abrirModal(a); } }
    }, hora, h('span', { class: 'tit', texto: a.titulo }));
}

const insignia = (texto, clase = '') => h('span', { class: `insignia ${clase}`.trim(), texto });
const metaActividad = (a) => [
    insignia(NOMBRE_TIPO[a.tipo], `t-${a.tipo}`),
    insignia(`Exigencia ${NOMBRE_EXIGENCIA[a.exigencia] ?? a.exigencia}`, a.exigencia === 3 ? 'alta' : ''),
    insignia(horasTxt(a.horas)),
    insignia(NOMBRE_ESTADO[a.estado], `estado-${a.estado}`),
    a.proyecto ? insignia(`📁 ${a.proyecto}`) : null,
    insigniaPrioridad(a)
];
/** «⚠ Urgente · vence mañana» (solo si hay prioridad que mostrar) */
function insigniaPrioridad(a) {
    const p = prioridadDe(a, hoyISO());
    if (p.nivel === 'ninguna' || (p.nivel === 'media' && !p.vencimiento)) return null;
    const texto = [p.nivel === 'urgente' ? '⚠ Urgente' : `Prioridad ${NOMBRE_PRIORIDAD[p.nivel].toLowerCase()}`, textoVencimiento(p)].filter(Boolean).join(' · ');
    return insignia(texto, `prioridad-${p.nivel}`);
}

function vacio(texto, fecha) {
    return h('div', { class: 'vacio' },
        h('div', { texto }),
        h('button', { type: 'button', class: 'boton boton-primario', texto: '+ Agregar actividad', on: { click: () => abrirModal(null, { fecha }) } }));
}

async function cambiarEstado(a, estado) {
    if (a.estado === estado) return;
    const anterior = a.estado;
    a.estado = estado;            // actualización optimista
    render();
    const res = await api(`/api/actividades/${encodeURIComponent(a.id)}`, { estado }, 'PUT').catch(() => null);
    if (res?.ok) { fijarActividades(res.data); }
    else { a.estado = anterior; aviso('No pude cambiar el estado. Inténtalo de nuevo.'); }
    render();
}

function cabeceraMes(clase = '') {
    return h('div', { class: 'mes-cab' }, DIAS_CORTOS.map(d => h('div', { texto: d })));
}

// ====================== Vista 1 · Mensual ======================
function vistaMensual() {
    const hoy = hoyISO();
    const celdas = cuadriculaMes(cursor).map(iso => {
        const lista = delDia(iso);
        const visibles = lista.slice(0, 3);
        return h('div', {
            class: `dia${iso === hoy ? ' hoy' : ''}${mismoMes(iso, cursor) ? '' : ' otro-mes'}${festivosDe(iso).length ? ' festivo' : ''}`,
            tabindex: '0', role: 'button', 'aria-label': `${diaLargo(iso)}.${festivosDe(iso).length ? ` Festivo: ${textoFestivos(iso)}.` : ''} ${lista.length} actividades. Pulsa para agregar.`,
            on: {
                click: () => abrirModal(null, { fecha: iso }),
                keydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrirModal(null, { fecha: iso }); }
            }
        },
            h('div', { class: 'dia-cab' }, h('span', { class: 'num', texto: String(aFecha(iso).getDate()) }), insigniaCarga(iso)),
            chipsFestivo(iso),
            visibles.map(chip),
            lista.length > 3 ? h('button', { type: 'button', class: 'mas', texto: `+${lista.length - 3} más`, on: { click: (e) => { e.stopPropagation(); irADia(iso); } } }) : null);
    });
    return h('div', { class: 'mes' }, cabeceraMes(), h('div', { class: 'mes-cuerpo' }, celdas));
}

// ====================== Mini calendario (lateral) ======================
function miniMes(alClic, seleccionado) {
    const hoy = hoyISO();
    const celdas = cuadriculaMes(cursor).map(iso => {
        const lista = delDia(iso);
        const tipos = lista.slice(0, 4);
        return h('button', {
            type: 'button',
            class: `dia${iso === hoy ? ' hoy' : ''}${mismoMes(iso, cursor) ? '' : ' otro-mes'}${iso === seleccionado ? ' sel' : ''}${festivosDe(iso).length ? ' festivo' : ''}`,
            'aria-label': `${diaLargo(iso)}${festivosDe(iso).length ? `, festivo: ${textoFestivos(iso)}` : ''}, ${lista.length} actividades${lista.length ? `, carga ${cargaDia(iso).porcentaje} %` : ''}`,
            title: festivosDe(iso).length ? `🎉 ${textoFestivos(iso)}` : null,
            'aria-pressed': iso === seleccionado ? 'true' : 'false',
            on: { click: () => alClic(iso) }
        },
            h('span', { class: 'num', texto: String(aFecha(iso).getDate()) }),
            lista.length ? h('span', { class: `barra-carga nivel-${cargaDia(iso).nivel}`, title: `Carga ${cargaDia(iso).porcentaje} %` }) : null,
            h('span', { class: 'puntos' },
                tipos.map(a => h('span', { class: `punto t-${a.tipo}` })),
                lista.length > 4 ? h('span', { class: 'mas-p', texto: '+' }) : null));
    });
    return h('div', { class: 'mini-vista' }, h('div', { class: 'mes' }, cabeceraMes(), h('div', { class: 'mes-cuerpo' }, celdas)));
}

// ====================== Vista Semana ======================
// ====================== Vista 2 · Semanal ======================
function distribuirSolapes(items) {
    // Agrupa bloques que se solapan y reparte el ancho en carriles
    const ord = [...items].sort((x, y) => x.ini - y.ini || y.fin - x.fin);
    const grupos = [];
    let grupo = null, finGrupo = -1;
    for (const it of ord) {
        if (!grupo || it.ini >= finGrupo) { grupo = []; grupos.push(grupo); finGrupo = -1; }
        grupo.push(it);
        finGrupo = Math.max(finGrupo, it.fin);
    }
    for (const g of grupos) {
        const finCarril = [];
        for (const it of g) {
            let c = finCarril.findIndex(f => f <= it.ini);
            if (c === -1) { c = finCarril.length; finCarril.push(0); }
            finCarril[c] = it.fin; it.carril = c;
        }
        g.forEach(it => { it.carriles = finCarril.length; });
    }
    return ord;
}

function vistaSemanal() {
    const hoy = hoyISO();
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana(cursor), i));
    const conHora = dias.map(d => delDia(d).filter(a => a.hora_inicio));
    const todas = conHora.flat();
    let desde = 6, hasta = 22;
    for (const a of todas) {
        desde = Math.min(desde, Math.floor(aMinutos(a.hora_inicio) / 60));
        hasta = Math.max(hasta, Math.ceil(aMinutos(a.hora_fin || a.hora_inicio) / 60) + 1);
    }
    hasta = Math.min(24, hasta);

    const cabecera = h('div', { class: 'sem-cab' }, h('div'), dias.map((d, i) =>
        h('div', { class: `cab-dia${d === hoy ? ' hoy' : ''}${festivosDe(d).length ? ' festivo' : ''}` }, DIAS_CORTOS[i], h('strong', { texto: String(aFecha(d).getDate()) }), insigniaCarga(d), chipsFestivo(d))));

    const sinHora = h('div', { class: 'sem-sinhora' }, h('div', { texto: 'Sin hora' }),
        dias.map(d => h('div', {}, delDia(d).filter(a => !a.hora_inicio).map(chip))));

    const etiquetasHoras = h('div', { class: 'col-horas', estilo: { height: `${(hasta - desde) * HPX}px` } },
        Array.from({ length: hasta - desde }, (_, i) =>
            i === 0 ? null : h('span', { texto: `${String(desde + i).padStart(2, '0')}:00`, estilo: { top: `${i * HPX}px` } })));

    const columnas = dias.map((d, idx) => {
        const items = distribuirSolapes(conHora[idx].map(a => {
            const ini = aMinutos(a.hora_inicio);
            const fin = a.hora_fin ? aMinutos(a.hora_fin) : ini + Math.round(a.horas * 60);
            return { a, ini, fin: Math.max(fin, ini + 20) };
        }));
        const col = h('div', {
            class: `col-dia${d === hoy ? ' hoy' : ''}`, estilo: { '--hpx': `${HPX}px`, height: `${(hasta - desde) * HPX}px` },
            'aria-label': `Columna del ${diaLargo(d)}. Pulsa para agregar a esa hora.`,
            on: {
                click: (e) => {
                    if (e.target !== e.currentTarget) return;
                    const hora = desde + Math.floor(e.offsetY / HPX);
                    abrirModal(null, { fecha: d, hora_inicio: `${String(Math.min(hora, 23)).padStart(2, '0')}:00` });
                }
            }
        }, items.map(({ a, ini, fin, carril, carriles }) => h('button', {
            type: 'button', class: `bloque ${claseAct(a)}`, title: descripcionAct(a), 'aria-label': descripcionAct(a),
            estilo: {
                top: `${((ini - desde * 60) / 60) * HPX}px`, height: `${Math.max(((fin - ini) / 60) * HPX - 2, 22)}px`,
                left: `calc(${(carril / carriles) * 100}% + 2px)`, width: `calc(${100 / carriles}% - 4px)`
            },
            on: { click: (e) => { e.stopPropagation(); abrirModal(a); } }
        }, h('span', { class: 'tit', texto: a.titulo }), h('span', { class: 'h', texto: textoHorario(a) }))));

        if (d === hoy) {
            const ahora = new Date();
            const min = ahora.getHours() * 60 + ahora.getMinutes();
            if (min >= desde * 60 && min <= hasta * 60) col.append(h('div', { class: 'ahora', estilo: { top: `${((min - desde * 60) / 60) * HPX}px` } }));
        }
        return col;
    });

    const scroll = h('div', { class: 'sem-scroll' }, h('div', { class: 'sem-cuerpo' }, etiquetasHoras, columnas));
    // Al montarse, desplaza la cuadrícula hasta las 7–8 am para ver el inicio de la jornada
    requestAnimationFrame(() => { scroll.scrollTop = Math.max(0, (7 - desde) * HPX); });
    return h('div', { class: 'sem' }, cabecera, sinHora, scroll);
}

// ====================== Resumen del día ======================
function resumenDia(lista) {
    if (lista.length === 0) return 'Sin actividades';
    const horas = lista.reduce((s, a) => s + a.horas, 0);
    const hechas = lista.filter(a => a.estado === 'completado').length;
    return `${lista.length} ${lista.length === 1 ? 'actividad' : 'actividades'} · ${horasTxt(horas)} · ${hechas} completadas`;
}


// ====================== Vista Día (tarjetas del diseño Moderno) ======================
function vistaDia() {
    const lista = delDia(cursor);
    return h('section', { class: 'moderno-detalle', 'aria-label': `Actividades del ${diaLargo(cursor)}` },
        h('h3', { texto: diaLargo(cursor) }),
        h('p', { class: 'resumen-dia' }, resumenDia(lista), ' ', insigniaCarga(cursor)),
        avisoFestivo(cursor),
        lista.length === 0 ? vacio('No hay actividades para este día.', cursor)
            : h('div', { class: 'det-lista' }, lista.map(a => h('article', { class: `det-card ${claseAct(a)}${urgente(a) ? ' urgente' : ''}` },
                h('div', { class: 'franja' }),
                h('div', {},
                    h('h4', { class: 'tit', texto: a.titulo }),
                    h('div', { class: 'horario', texto: a.hora_inicio ? `🕒 ${textoHorario(a)}` : 'Sin hora definida' }),
                    h('div', { class: 'meta' }, metaActividad(a)),
                    h('div', { class: 'barra-estado', 'aria-hidden': 'true' }, h('i', { estilo: { width: a.estado === 'completado' ? '100%' : a.estado === 'en_proceso' ? '50%' : '8%' } }))),
                h('div', { class: 'acciones' },
                    h('button', { type: 'button', class: 'boton boton-mini', texto: 'Editar', 'aria-label': `Editar ${a.titulo}`, on: { click: () => abrirModal(a) } }),
                    a.estado !== 'completado' ? h('button', { type: 'button', class: 'boton boton-mini', texto: '✓ Listo', 'aria-label': `Marcar ${a.titulo} como completado`, on: { click: () => cambiarEstado(a, 'completado') } }) : null)))));
}

// ====================== Lateral (diseño Moderno): mini calendario y próximas entregas ======================
function lateral() {
    const hoy = hoyISO();
    const proximas = actividades
        .filter((a) => a.estado !== 'completado' && prioridadDe(a, hoy).vencimiento && prioridadDe(a, hoy).dias >= -3)
        .sort(porUrgencia(hoy)).slice(0, 5);
    return h('div', { class: 'moderno-lateral-contenido' },
        h('div', { class: 'mini-cab' },
            h('button', { type: 'button', class: 'boton boton-icono', texto: '‹', 'aria-label': 'Mes anterior', on: { click: () => { cursor = sumarMeses(cursor, -1); render(); } } }),
            h('strong', { texto: mesAnio(cursor) }),
            h('button', { type: 'button', class: 'boton boton-icono', texto: '›', 'aria-label': 'Mes siguiente', on: { click: () => { cursor = sumarMeses(cursor, 1); render(); } } })),
        miniMes((iso) => { cursor = iso; render(); }, cursor),
        h('section', { class: 'proximas', 'aria-labelledby': 'proximas-titulo' },
            h('h3', { id: 'proximas-titulo', texto: '⏰ Próximas entregas' }),
            proximas.length === 0
                ? h('p', { class: 'proximas-vacio', texto: 'Nada con fecha de entrega cerca. 🎉' })
                : h('ul', {}, proximas.map((a) => {
                    const p = prioridadDe(a, hoy);
                    return h('li', { class: `prioridad-${p.nivel}` },
                        h('button', { type: 'button', class: 'proxima', on: { click: () => abrirModal(a) }, 'aria-label': `${a.titulo}, ${textoVencimiento(p)}` },
                            h('span', { class: 'tit', texto: a.titulo }),
                            h('small', { texto: `${textoVencimiento(p)}${a.proyecto ? ` · ${a.proyecto}` : ''}` })));
                }))));
}

// ====================== Línea de tiempo académica ======================
/**
 * Cada trabajo o tarea de la universidad (tipo «estudio» con fecha de vencimiento, o un examen/entrega) desde el día
 * en que se asignó hasta su vencimiento. Los proyectos se resumen en una fila con su progreso.
 */
function lineaAcademica() {
    const hoy = hoyISO();
    const academicas = actividades.filter((a) => a.tipo === 'estudio' && (a.fecha_vencimiento || esEntregaOExamen(a)));
    const filas = [];
    // Un proyecto con alguna entrega académica se resume en UNA fila con TODAS sus subtareas de estudio
    const proyectosAcademicos = new Set(academicas.map((a) => a.proyecto).filter(Boolean));
    const porProyecto = new Map([...proyectosAcademicos].map((p) => [p, actividades.filter((a) => a.proyecto === p && a.tipo === 'estudio')]));
    for (const a of academicas) {
        if (a.proyecto) continue;
        const venc = prioridadDe(a, hoy).vencimiento ?? a.fecha_fin;
        filas.push({ titulo: a.titulo, inicio: [a.fecha_asignacion, a.fecha_inicio].filter(Boolean).sort()[0], fin: venc, hecho: a.estado === 'completado', act: a, progreso: a.estado === 'completado' ? 100 : a.estado === 'en_proceso' ? 50 : 0 });
    }
    for (const [nombre, lista] of porProyecto) {
        const inicios = lista.flatMap((a) => [a.fecha_asignacion, a.fecha_inicio].filter(Boolean)).sort();
        const fines = lista.map((a) => prioridadDe(a, hoy).vencimiento ?? a.fecha_fin).sort();
        const hechas = lista.filter((a) => a.estado === 'completado').length;
        filas.push({ titulo: `📁 ${nombre}`, inicio: inicios[0], fin: fines.at(-1), hecho: hechas === lista.length, proyecto: nombre, progreso: Math.round((hechas / lista.length) * 100), detalle: `${hechas}/${lista.length} tareas` });
    }
    const visibles = filas.filter((f) => f.fin >= sumarDias(hoy, -7)).sort((x, y) => x.fin.localeCompare(y.fin));
    const cuerpo = h('div', { class: 'linea-cuerpo' });
    if (visibles.length === 0) {
        cuerpo.append(h('p', { class: 'linea-vacia', texto: 'Cuando tengas trabajos, exámenes o entregas con fecha límite, aparecerán aquí desde el día en que se asignaron hasta que vencen.' }));
    } else {
        const desde = [...visibles.map((f) => f.inicio), hoy].sort()[0];
        const hasta = [...visibles.map((f) => f.fin), hoy].sort().at(-1);
        const total = Math.max(1, diasEntre(desde, hasta) + 1);
        const pos = (iso) => `${(diasEntre(desde, iso) / total) * 100}%`;
        // «Hoy» va en su posición; si cae en un extremo, se une a esa fecha para que no se solapen
        const relHoy = diasEntre(desde, hoy) / total;
        const etiquetaEje = (iso) => `${fmt(iso, { day: 'numeric', month: 'short' })}${iso === hoy ? ' (hoy)' : ''}`;
        cuerpo.append(h('div', { class: 'linea-eje', 'aria-hidden': 'true' },
            h('span', { texto: etiquetaEje(desde) }),
            relHoy >= 0.1 && relHoy <= 0.9 ? h('span', { class: 'eje-hoy', estilo: { left: pos(hoy) }, texto: 'Hoy' }) : null,
            h('span', { texto: etiquetaEje(hasta) })));
        for (const f of visibles) {
            const p = f.act ? prioridadDe(f.act, hoy) : { nivel: f.hecho ? 'ninguna' : (diasEntre(hoy, f.fin) <= 2 ? 'urgente' : 'media'), dias: diasEntre(hoy, f.fin) };
            const ancho = `${((diasEntre(f.inicio, f.fin) + 1) / total) * 100}%`;
            const etiquetaFechas = `${fmt(f.inicio, { day: 'numeric', month: 'short' })} → ${fmt(f.fin, { day: 'numeric', month: 'short' })}`;
            cuerpo.append(h('div', { class: `linea-fila${f.hecho ? ' hecha' : ''} prioridad-${p.nivel}` },
                h('div', { class: 'linea-etq' },
                    f.act ? h('button', { type: 'button', class: 'linea-tit', texto: f.titulo, on: { click: () => abrirModal(f.act) } })
                        : h('a', { class: 'linea-tit', href: `/proyectos#${encodeURIComponent(f.proyecto)}`, texto: f.titulo }),
                    h('small', { texto: f.hecho ? '✓ Terminado' : [f.detalle, textoVencimiento(p)].filter(Boolean).join(' · ') })),
                h('div', { class: 'linea-pista', role: 'img', 'aria-label': `${f.titulo}: asignado ${etiquetaFechas}, ${f.progreso} % hecho` },
                    h('span', { class: 'linea-hoy', estilo: { left: pos(hoy) } }),
                    h('span', { class: 'linea-barra', estilo: { left: pos(f.inicio), width: ancho }, title: etiquetaFechas },
                        h('i', { estilo: { width: `${f.progreso}%` } })))));
        }
    }
    $('linea-academica-cuerpo').replaceChildren(cuerpo);
}

// ====================== Navegación y render ======================
function irADia(iso) { cursor = iso; setVista('dia'); }

function tituloActual() {
    switch (VISTAS[vista].nav) {
        case 'mes': return mesAnio(cursor);
        case 'sem': { const a = inicioSemana(cursor), b = sumarDias(a, 6); return `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
        default: return diaLargo(cursor);
    }
}

function mover(dir) {
    const nav = VISTAS[vista].nav;
    if (nav === 'mes') cursor = sumarMeses(cursor, dir);
    else if (nav === 'sem') cursor = sumarDias(cursor, 7 * dir);
    else cursor = sumarDias(cursor, dir);
    render();
}

function render() {
    const cont = $('cal-vista');
    $('cal-titulo').textContent = tituloActual();
    $('selector-vista').value = vista;
    cont.setAttribute('aria-label', `Vista ${VISTAS[vista].etiqueta}`);
    cont.replaceChildren(VISTAS[vista].render());
    $('cal-lateral').replaceChildren(lateral());
    lineaAcademica();
    asegurarCheckins(cursor);
}

function setVista(nombre) {
    vista = VISTAS[nombre] ? nombre : (VISTAS_ANTIGUAS[nombre] ?? 'mes');
    try { localStorage.setItem('learntrack_vista_cal', vista); } catch { /* sin almacenamiento: no pasa nada */ }
    render();
}

// ====================== Formulario de actividad (componente compartido con Mi panel) ======================
const proyectosUsados = () => [...new Set(actividades.map((a) => a.proyecto).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es'));
const formulario = crearFormularioActividad({ alCambiar: (lista) => { fijarActividades(lista); render(); }, proyectos: proyectosUsados });
/** Nueva actividad: por defecto en el día que se está viendo (vista Día) o en hoy */
function abrirModal(a, previos = {}) {
    const fecha = previos.fecha ?? (vista === 'dia' ? cursor : hoyISO());
    formulario.abrir(a, { ...previos, fecha });
}

// ====================== Chat con IA (componente compartido) ======================
function alActualizarDesdeChat(lista) {
    const previos = new Set(actividades.map((a) => a.id));
    fijarActividades(lista);
    const nueva = actividades.find((a) => !previos.has(a.id));
    if (nueva && VISTAS[vista].nav) cursor = nueva.fecha_inicio;   // salta a la fecha de lo recién creado
    render();
}

// ====================== Arranque ======================
$('btn-prev').addEventListener('click', () => mover(-1));
$('btn-next').addEventListener('click', () => mover(1));
$('btn-hoy').addEventListener('click', () => { cursor = hoyISO(); render(); });
$('btn-nueva').addEventListener('click', () => abrirModal(null));
$('selector-vista').addEventListener('change', (e) => setVista(e.target.value));
montarBarraNavegacion();
document.addEventListener('festivos-actualizados', (e) => { fijarFestivos(e.detail?.festivos); render(); });
$('btn-papelera').addEventListener('click', () => abrirPapelera({ alRestaurar: (lista) => { fijarActividades(lista); render(); } }));

async function iniciar() {
    try { const v = localStorage.getItem('learntrack_vista_cal'); if (v) vista = VISTAS[v] ? v : (VISTAS_ANTIGUAS[v] ?? 'mes'); } catch { /* ignorar */ }
    render();
    try {
        if (!(await usuarioActual())) { location.assign('/?acceso=login'); return; }
        const res = await api('/api/actividades');
        if (res.ok) fijarActividades(res.data);
        render();
        cargarFestivos();
    } catch (e) { console.error(e); }
    montarChatIA($('chat-ia'), {
        alActualizar: alActualizarDesdeChat,
        bienvenida: 'Dime algo como «Mañana tengo parcial de redes de 2 a 4 pm», «libera mi viernes» u «organízame la semana». También puedes dictar 🎤 o adjuntar tu cronograma 📎 con un mensaje.'
    });
    // Si la pestaña queda abierta toda la noche, la línea de "hoy" (y el auto-estado) se actualizan solos
    setInterval(async () => {
        if (document.visibilityState !== 'visible' || formulario.dialogo.open) return;
        const res = await api('/api/actividades').catch(() => null);
        if (res?.ok) fijarActividades(res.data);
        render();
    }, 5 * 60 * 1000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
