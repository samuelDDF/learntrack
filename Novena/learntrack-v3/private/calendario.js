// calendario.js — Mi agenda: 8 vistas, chat con IA y CRUD de actividades (módulo ES).
// Todo el contenido dinámico se escribe con textContent (nunca innerHTML) para no abrir la puerta a XSS.
// La carga por día usa la MISMA regla que el panel y el servidor (compartido/carga.js).
import { normalizarActividad, actividadesDelDia, cargaDelDia, capacidadDe, esHito as esHitoCompartido } from '/app/compartido/carga.js';
import { h, api as apiComun, abrirDialogo, aviso, cerrarSesion, hoyISO as hoyLocal } from '/app/comun.js';
import { montarChatIA } from '/app/chat-ia.js';
import { abrirPapelera } from '/app/papelera.js';

(() => {
    'use strict';

    // ====================== Constantes ======================
    const VISTAS = {
        mensual:     { render: vistaMensual,     nav: 'mes',  etiqueta: 'Mensual' },
        semanal:     { render: vistaSemanal,     nav: 'sem',  etiqueta: 'Semanal' },
        diario:      { render: vistaDiario,      nav: 'dia',  etiqueta: 'Diario' },
        kanban:      { render: vistaKanban,      nav: null,   etiqueta: 'Kanban' },
        timeline:    { render: vistaTimeline,    nav: 'mes',  etiqueta: 'Timeline' },
        minimalista: { render: vistaMinimalista, nav: 'mes',  etiqueta: 'Minimalista' },
        eventos:     { render: vistaEventos,     nav: null,   etiqueta: 'Eventos' },
        moderno:     { render: vistaModerno,     nav: 'mes',  etiqueta: 'Moderno' }
    };
    const TIPOS = { estudio: 'Estudio', trabajo: 'Trabajo', ocio: 'Ocio', deporte: 'Deporte' };
    const EXIGENCIAS = { '3': 'Alta', '2': 'Media', '1': 'Baja', '-2': 'Recarga' };
    const ESTADOS = ['pendiente', 'en_proceso', 'completado'];
    const ESTADO_TXT = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completado' };
    const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const HPX = 48; // alto en píxeles de una hora en la vista semanal

    // ====================== Estado ======================
    let actividades = [];
    let vista = 'mensual';
    let cursor = hoyISO();           // fecha de referencia de las vistas
    let temporizadorHoy = null;
    const checkins = new Map();      // 'YYYY-MM-DD' -> ánimo (capacidad del día)
    const mesesCargados = new Set();

    // ====================== Utilidades de fecha (cadenas YYYY-MM-DD, sin problemas de zona horaria) ======================
    function aISO(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function hoyISO() { return hoyLocal(); }
    function aFecha(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, 12); }
    function sumarDias(iso, n) { const f = aFecha(iso); f.setDate(f.getDate() + n); return aISO(f); }
    function sumarMeses(iso, n) {
        const f = aFecha(iso); f.setDate(1); f.setMonth(f.getMonth() + n); return aISO(f);
    }
    function diasEntre(a, b) { return Math.round((aFecha(b) - aFecha(a)) / 86400000); }
    function inicioSemana(iso) { const f = aFecha(iso); const dow = (f.getDay() + 6) % 7; f.setDate(f.getDate() - dow); return aISO(f); }
    function primerDiaMes(iso) { return iso.slice(0, 8) + '01'; }
    function diasDelMes(iso) { const f = aFecha(iso); return new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate(); }
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
    const aMin = (h) => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };
    const horasTxt = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

    // ====================== DOM helpers ======================
    const $ = (id) => document.getElementById(id);

    // ====================== API ======================
    const api = (url, cuerpo, metodo = 'GET') => apiComun(url, cuerpo, metodo);

    // ====================== Modelo ======================
    // Las actividades antiguas (solo "fecha") se normalizan al vuelo (el servidor también las normaliza).
    const normalizar = normalizarActividad;
    function fijarActividades(lista) { actividades = (Array.isArray(lista) ? lista : []).map(normalizar); }

    const ordenar = (a, b) =>
        (a.hora_inicio || '99:99').localeCompare(b.hora_inicio || '99:99') || a.titulo.localeCompare(b.titulo, 'es');
    const delDia = (iso) => actividadesDelDia(actividades, iso).sort(ordenar);
    const esHito = esHitoCompartido;

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
    const rangoHora = (a) => a.hora_inicio ? (a.hora_fin ? `${a.hora_inicio}–${a.hora_fin}` : a.hora_inicio) : '';
    const claseAct = (a) => `t-${a.tipo} est-${a.estado}${a.exigencia === 3 ? ' exig-alta' : ''}`;
    const descripcionAct = (a) => `${a.titulo}. ${TIPOS[a.tipo]}. ${rangoHora(a) || 'Sin hora'}. ${ESTADO_TXT[a.estado]}.`;

    // ====================== Componentes ======================
    function chip(a) {
        const hora = a.hora_inicio ? h('span', { class: 'h', texto: a.hora_inicio }) : null;
        return h('button', {
            type: 'button', class: `chip ${claseAct(a)}`, title: descripcionAct(a), 'aria-label': descripcionAct(a),
            on: { click: (e) => { e.stopPropagation(); abrirModal(a); } }
        }, hora, h('span', { class: 'tit', texto: a.titulo }));
    }

    const insignia = (texto, clase = '') => h('span', { class: `insignia ${clase}`.trim(), texto });
    const metaActividad = (a) => [
        insignia(TIPOS[a.tipo], `t-${a.tipo}`),
        insignia(`Exigencia ${EXIGENCIAS[a.exigencia] ?? a.exigencia}`, a.exigencia === 3 ? 'alta' : ''),
        insignia(horasTxt(a.horas)),
        insignia(ESTADO_TXT[a.estado], `estado-${a.estado}`),
        a.proyecto ? insignia(`📁 ${a.proyecto}`) : null
    ];

    function vacio(texto, fecha) {
        return h('div', { class: 'vacio' },
            h('div', { texto }),
            h('button', { type: 'button', class: 'cal-btn cal-btn-primario', texto: '+ Agregar actividad', on: { click: () => abrirModal(null, { fecha }) } }));
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
                class: `dia${iso === hoy ? ' hoy' : ''}${mismoMes(iso, cursor) ? '' : ' otro-mes'}`,
                tabindex: '0', role: 'button', 'aria-label': `${diaLargo(iso)}. ${lista.length} actividades. Pulsa para agregar.`,
                on: {
                    click: () => abrirModal(null, { fecha: iso }),
                    keydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrirModal(null, { fecha: iso }); }
                }
            },
                h('div', { class: 'dia-cab' }, h('span', { class: 'num', texto: String(aFecha(iso).getDate()) }), insigniaCarga(iso)),
                visibles.map(chip),
                lista.length > 3 ? h('button', { type: 'button', class: 'mas', texto: `+${lista.length - 3} más`, on: { click: (e) => { e.stopPropagation(); irADia(iso); } } }) : null);
        });
        return h('div', { class: 'mes' }, cabeceraMes(), h('div', { class: 'mes-cuerpo' }, celdas));
    }

    // ====================== Vista 6 · Minimalista (y mini calendario de la vista 8) ======================
    function miniMes(alClic, seleccionado) {
        const hoy = hoyISO();
        const celdas = cuadriculaMes(cursor).map(iso => {
            const lista = delDia(iso);
            const tipos = lista.slice(0, 4);
            return h('button', {
                type: 'button',
                class: `dia${iso === hoy ? ' hoy' : ''}${mismoMes(iso, cursor) ? '' : ' otro-mes'}${iso === seleccionado ? ' sel' : ''}`,
                'aria-label': `${diaLargo(iso)}, ${lista.length} actividades${lista.length ? `, carga ${cargaDia(iso).porcentaje} %` : ''}`,
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
    function vistaMinimalista() { return miniMes(irADia, null); }

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
            desde = Math.min(desde, Math.floor(aMin(a.hora_inicio) / 60));
            hasta = Math.max(hasta, Math.ceil(aMin(a.hora_fin || a.hora_inicio) / 60) + 1);
        }
        hasta = Math.min(24, hasta);

        const cabecera = h('div', { class: 'sem-cab' }, h('div'), dias.map((d, i) =>
            h('div', { class: `cab-dia${d === hoy ? ' hoy' : ''}` }, DIAS_CORTOS[i], h('strong', { texto: String(aFecha(d).getDate()) }), insigniaCarga(d))));

        const sinHora = h('div', { class: 'sem-sinhora' }, h('div', { texto: 'Sin hora' }),
            dias.map(d => h('div', {}, delDia(d).filter(a => !a.hora_inicio).map(chip))));

        const etiquetasHoras = h('div', { class: 'col-horas', estilo: { height: `${(hasta - desde) * HPX}px` } },
            Array.from({ length: hasta - desde }, (_, i) =>
                i === 0 ? null : h('span', { texto: `${String(desde + i).padStart(2, '0')}:00`, estilo: { top: `${i * HPX}px` } })));

        const columnas = dias.map((d, idx) => {
            const items = distribuirSolapes(conHora[idx].map(a => {
                const ini = aMin(a.hora_inicio);
                const fin = a.hora_fin ? aMin(a.hora_fin) : ini + Math.round(a.horas * 60);
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
            }, h('span', { class: 'tit', texto: a.titulo }), h('span', { class: 'h', texto: rangoHora(a) }))));

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

    // ====================== Vista 3 · Diario ======================
    function resumenDia(lista) {
        if (lista.length === 0) return 'Sin actividades';
        const horas = lista.reduce((s, a) => s + a.horas, 0);
        const hechas = lista.filter(a => a.estado === 'completado').length;
        return `${lista.length} ${lista.length === 1 ? 'actividad' : 'actividades'} · ${horasTxt(horas)} · ${hechas} completadas`;
    }

    function vistaDiario() {
        const lista = delDia(cursor);
        const cuerpo = lista.length === 0
            ? vacio('Día libre: no hay nada agendado.', cursor)
            : h('div', { class: 'lista-dia' }, lista.map(a => h('div', { class: 'fila-dia' },
                h('div', { class: 'hora' }, a.hora_inicio ? a.hora_inicio : 'Sin hora', h('small', { texto: a.hora_fin ? `hasta ${a.hora_fin}` : horasTxt(a.horas) })),
                h('div', { class: `tarjeta-act ${claseAct(a)}` },
                    h('div', {}, h('h4', { class: 'tit', texto: a.titulo }), h('div', { class: 'meta' }, metaActividad(a))),
                    h('div', { class: 'acciones' },
                        a.estado !== 'completado'
                            ? h('button', { type: 'button', class: 'cal-btn cal-btn-mini', texto: '✓ Listo', 'aria-label': `Marcar ${a.titulo} como completado`, on: { click: () => cambiarEstado(a, 'completado') } })
                            : null,
                        h('button', { type: 'button', class: 'cal-btn cal-btn-mini', texto: 'Editar', 'aria-label': `Editar ${a.titulo}`, on: { click: () => abrirModal(a) } }))))));
        return h('div', {}, h('div', { class: 'diario-cab' }, h('h3', { texto: diaLargo(cursor) }), h('span', { class: 'resumen-dia' }, resumenDia(lista), ' ', insigniaCarga(cursor))), cuerpo);
    }

    // ====================== Vista 4 · Kanban ======================
    function vistaKanban() {
        const columnas = ESTADOS.map(estado => {
            const lista = actividades.filter(a => a.estado === estado)
                .sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio) || ordenar(x, y));
            const idx = ESTADOS.indexOf(estado);
            const col = h('div', { class: 'kb-col', 'data-estado': estado, role: 'list', 'aria-label': ESTADO_TXT[estado] },
                h('header', {}, h('h3', { texto: ESTADO_TXT[estado] }), h('span', { class: 'kb-cuenta', texto: String(lista.length) })),
                lista.length === 0 ? h('div', { class: 'kb-vacio', texto: 'Arrastra tarjetas aquí' }) : null,
                lista.map(a => h('article', {
                    class: `kb-tarjeta ${claseAct(a)}`, draggable: 'true', role: 'listitem',
                    on: {
                        dragstart: (e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('arrastrando'); },
                        dragend: (e) => e.currentTarget.classList.remove('arrastrando')
                    }
                },
                    h('button', { type: 'button', class: 'tit-k tit', texto: a.titulo, on: { click: () => abrirModal(a) } }),
                    h('div', { class: 'meta' }, insignia(TIPOS[a.tipo], `t-${a.tipo}`), a.exigencia === 3 ? insignia('Alta', 'alta') : null, a.proyecto ? insignia(`📁 ${a.proyecto}`) : null),
                    h('div', { class: 'cuando', texto: `${diaCorto(a.fecha_inicio)}${a.fecha_fin !== a.fecha_inicio ? ` → ${diaCorto(a.fecha_fin)}` : ''}${a.hora_inicio ? ` · ${rangoHora(a)}` : ''} · ${horasTxt(a.horas)}` }),
                    h('div', { class: 'kb-mover' },
                        h('button', { type: 'button', class: 'cal-btn cal-btn-mini', texto: '◀', disabled: idx === 0, 'aria-label': `Mover ${a.titulo} a ${ESTADO_TXT[ESTADOS[idx - 1]] ?? ''}`, on: { click: () => cambiarEstado(a, ESTADOS[idx - 1]) } }),
                        h('button', { type: 'button', class: 'cal-btn cal-btn-mini', texto: '▶', disabled: idx === ESTADOS.length - 1, 'aria-label': `Mover ${a.titulo} a ${ESTADO_TXT[ESTADOS[idx + 1]] ?? ''}`, on: { click: () => cambiarEstado(a, ESTADOS[idx + 1]) } }))))
            );
            col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('sobre'); });
            col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('sobre'); });
            col.addEventListener('drop', (e) => {
                e.preventDefault(); col.classList.remove('sobre');
                const act = actividades.find(x => x.id === e.dataTransfer.getData('text/plain'));
                if (act) cambiarEstado(act, estado);
            });
            return col;
        });
        return h('div', { class: 'kanban' }, columnas);
    }

    // ====================== Vista 5 · Timeline / Gantt ======================
    function vistaTimeline() {
        const hoy = hoyISO();
        const ini = primerDiaMes(cursor);
        const n = diasDelMes(cursor);
        const fin = sumarDias(ini, n - 1);
        const ETQ = 200, DW = 34;
        const plantilla = `${ETQ}px repeat(${n}, ${DW}px)`;
        const dias = Array.from({ length: n }, (_, i) => sumarDias(ini, i));

        const visibles = actividades.filter(a => a.fecha_inicio <= fin && a.fecha_fin >= ini);
        if (visibles.length === 0) return vacio(`No hay actividades en ${mesAnio(cursor)}.`, ini);

        const grupos = new Map();
        for (const a of visibles) {
            const clave = a.proyecto || '';
            if (!grupos.has(clave)) grupos.set(clave, []);
            grupos.get(clave).push(a);
        }
        const claves = [...grupos.keys()].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y, 'es')));

        const celdas = (fila) => dias.map((d, i) => h('div', {
            class: `g-celda${aFecha(d).getDay() % 6 === 0 ? ' fin-sem' : ''}${d === hoy ? ' hoy' : ''}`,
            estilo: { 'grid-column': String(i + 2), 'grid-row': '1' }
        }));
        const columna = (a) => {
            const c1 = Math.max(0, diasEntre(ini, a.fecha_inicio));
            const c2 = Math.min(n - 1, diasEntre(ini, a.fecha_fin));
            return { gridColumn: `${c1 + 2} / ${c2 + 3}`, c1, c2 };
        };

        const cab = h('div', { class: 'g-fila g-cab', estilo: { 'grid-template-columns': plantilla } },
            h('div', { class: 'g-etq', texto: 'Proyecto / actividad' }),
            dias.map(d => h('div', { class: `g-dia${d === hoy ? ' hoy' : ''}` }, h('strong', { texto: String(aFecha(d).getDate()) }), fmt(d, { weekday: 'narrow' }))));

        const filas = [];
        for (const clave of claves) {
            const lista = grupos.get(clave).sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio) || ordenar(x, y));
            const hechas = lista.filter(a => a.estado === 'completado').length;
            const minI = lista.reduce((m, a) => (a.fecha_inicio < m ? a.fecha_inicio : m), lista[0].fecha_inicio);
            const maxF = lista.reduce((m, a) => (a.fecha_fin > m ? a.fecha_fin : m), lista[0].fecha_fin);
            const resumen = columna({ fecha_inicio: minI, fecha_fin: maxF });
            filas.push(h('div', { class: 'g-fila g-grupo', estilo: { 'grid-template-columns': plantilla } },
                h('div', { class: 'g-etq', estilo: { 'grid-column': '1', 'grid-row': '1' } },
                    h('span', { class: 't', texto: clave ? `📁 ${clave}` : 'Sin proyecto' }), h('small', { texto: `${hechas}/${lista.length}` })),
                celdas(),
                h('div', { class: 'g-barra-grupo', estilo: { 'grid-column': resumen.gridColumn, 'grid-row': '1' } })));

            for (const a of lista) {
                const col = columna(a);
                filas.push(h('div', { class: 'g-fila', estilo: { 'grid-template-columns': plantilla } },
                    h('div', { class: 'g-etq', estilo: { 'grid-column': '1', 'grid-row': '1' } }, h('span', { class: `punto t-${a.tipo}` }), h('span', { class: 't', texto: a.titulo, title: a.titulo })),
                    celdas(),
                    h('button', {
                        type: 'button',
                        class: `g-barra ${claseAct(a)}${a.fecha_inicio < ini ? ' corta-izq' : ''}${a.fecha_fin > fin ? ' corta-der' : ''}`,
                        estilo: { 'grid-column': col.gridColumn, 'grid-row': '1' },
                        title: `${descripcionAct(a)} ${diaCorto(a.fecha_inicio)}${a.fecha_fin !== a.fecha_inicio ? ` → ${diaCorto(a.fecha_fin)}` : ''}`,
                        'aria-label': `${descripcionAct(a)} Del ${diaCorto(a.fecha_inicio)} al ${diaCorto(a.fecha_fin)}.`,
                        texto: a.titulo,
                        on: { click: () => abrirModal(a) }
                    })));
            }
        }
        return h('div', { class: 'gantt-marco' }, h('div', { estilo: { 'min-width': `${ETQ + n * DW}px` } }, cab, filas));
    }

    // ====================== Vista 7 · Eventos ======================
    function vistaEventos() {
        const hoy = hoyISO();
        const hitos = actividades.filter(esHito);
        const proximos = hitos.filter(a => a.fecha_fin >= hoy).sort((x, y) => x.fecha_inicio.localeCompare(y.fecha_inicio) || ordenar(x, y));
        const pasados = hitos.filter(a => a.fecha_fin < hoy).sort((x, y) => y.fecha_inicio.localeCompare(x.fecha_inicio));

        const tarjeta = (a, pasado) => {
            const dias = diasEntre(hoy, a.fecha_inicio);
            const cuenta = pasado ? `Hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`
                : dias <= 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`;
            return h('button', { type: 'button', class: `evento ${claseAct(a)}${!pasado && dias <= 3 && a.estado !== 'completado' ? ' urgente' : ''}${pasado ? ' pasado' : ''}`, on: { click: () => abrirModal(a) }, 'aria-label': `${descripcionAct(a)} ${cuenta}` },
                h('div', { class: 'fecha-bloque' }, h('b', { texto: String(aFecha(a.fecha_inicio).getDate()) }), h('span', { texto: fmt(a.fecha_inicio, { month: 'short' }).replace('.', '') })),
                h('div', {}, h('h4', { class: 'tit', texto: a.titulo }), h('div', { class: 'meta' }, [insignia(rangoHora(a) || 'Todo el día'), ...metaActividad(a)])),
                h('div', { class: 'cuenta', texto: cuenta }));
        };

        if (hitos.length === 0) {
            return vacio('Aquí aparecerán tus hitos: exámenes, entregas y actividades de exigencia alta.', hoy);
        }
        return h('div', { class: 'eventos' },
            h('h3', { texto: `Próximos hitos (${proximos.length})` }),
            proximos.length ? proximos.map(a => tarjeta(a, false)) : h('div', { class: 'vacio', texto: 'No tienes hitos pendientes por delante. 🎉' }),
            pasados.length ? h('details', { class: 'pasados' }, h('summary', { texto: `Hitos pasados (${pasados.length})` }), h('div', { class: 'eventos' }, pasados.map(a => tarjeta(a, true)))) : null);
    }

    // ====================== Vista 8 · Moderno ======================
    function vistaModerno() {
        const lista = delDia(cursor);
        const lateral = h('aside', { class: 'moderno-lateral', 'aria-label': 'Mini calendario' },
            h('div', { class: 'mini-cab' },
                h('button', { type: 'button', class: 'cal-btn cal-btn-icono', texto: '‹', 'aria-label': 'Mes anterior', on: { click: () => { cursor = sumarMeses(cursor, -1); render(); } } }),
                h('strong', { texto: mesAnio(cursor) }),
                h('button', { type: 'button', class: 'cal-btn cal-btn-icono', texto: '›', 'aria-label': 'Mes siguiente', on: { click: () => { cursor = sumarMeses(cursor, 1); render(); } } })),
            miniMes((iso) => { cursor = iso; render(); }, cursor));

        const detalle = h('section', { class: 'moderno-detalle', 'aria-label': `Actividades del ${diaLargo(cursor)}` },
            h('h3', { texto: diaLargo(cursor) }),
            h('p', { class: 'resumen-dia' }, resumenDia(lista), ' ', insigniaCarga(cursor)),
            lista.length === 0 ? vacio('No hay actividades para este día.', cursor)
                : h('div', { class: 'det-lista' }, lista.map(a => h('article', { class: `det-card ${claseAct(a)}` },
                    h('div', { class: 'franja' }),
                    h('div', {},
                        h('h4', { class: 'tit', texto: a.titulo }),
                        h('div', { class: 'horario', texto: a.hora_inicio ? `🕒 ${rangoHora(a)}` : 'Sin hora definida' }),
                        h('div', { class: 'meta' }, metaActividad(a)),
                        h('div', { class: 'barra-estado', 'aria-hidden': 'true' }, h('i', { estilo: { width: a.estado === 'completado' ? '100%' : a.estado === 'en_proceso' ? '50%' : '8%' } }))),
                    h('div', { class: 'acciones' },
                        h('button', { type: 'button', class: 'cal-btn cal-btn-mini', texto: 'Editar', 'aria-label': `Editar ${a.titulo}`, on: { click: () => abrirModal(a) } }),
                        a.estado !== 'completado' ? h('button', { type: 'button', class: 'cal-btn cal-btn-mini', texto: '✓ Listo', 'aria-label': `Marcar ${a.titulo} como completado`, on: { click: () => cambiarEstado(a, 'completado') } }) : null)))));
        return h('div', { class: 'moderno' }, lateral, detalle);
    }

    // ====================== Navegación y render ======================
    function irADia(iso) { cursor = iso; setVista('diario'); }

    function tituloActual() {
        switch (VISTAS[vista].nav) {
            case 'mes': return mesAnio(cursor);
            case 'sem': { const a = inicioSemana(cursor), b = sumarDias(a, 6); return `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
            case 'dia': return diaLargo(cursor);
            default: return vista === 'kanban' ? 'Tablero de actividades' : 'Hitos y exámenes';
        }
    }

    function mover(dir) {
        const nav = VISTAS[vista].nav;
        if (nav === 'mes') cursor = sumarMeses(cursor, dir);
        else if (nav === 'sem') cursor = sumarDias(cursor, 7 * dir);
        else if (nav === 'dia') cursor = sumarDias(cursor, dir);
        render();
    }

    function render() {
        const cont = $('cal-vista');
        $('cal-titulo').textContent = tituloActual();
        $('cal-nav').hidden = VISTAS[vista].nav === null;
        document.querySelectorAll('#selector-vistas button').forEach(b => {
            const activa = b.dataset.vista === vista;
            b.setAttribute('aria-selected', activa ? 'true' : 'false');
            b.tabIndex = activa ? 0 : -1;
        });
        cont.setAttribute('aria-label', `Vista ${VISTAS[vista].etiqueta}`);
        cont.replaceChildren(VISTAS[vista].render());
        actualizarSugerenciasProyecto();
        asegurarCheckins(cursor);
    }

    function setVista(nombre) {
        if (!VISTAS[nombre]) nombre = 'mensual';
        vista = nombre;
        try { localStorage.setItem('learntrack_vista_cal', nombre); } catch { /* sin almacenamiento: no pasa nada */ }
        render();
    }

    // ====================== Modal CRUD ======================
    const modal = $('modal-actividad');
    const form = $('form-cal-actividad');
    const campo = (id) => $(`f-${id}`);
    let confirmandoBorrado = false;

    function actualizarSugerenciasProyecto() {
        const proyectos = [...new Set(actividades.map(a => a.proyecto).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es'));
        $('lista-proyectos').replaceChildren(...proyectos.map(p => h('option', { value: p })));
    }

    function resetBotonEliminar() {
        confirmandoBorrado = false;
        const b = $('btn-eliminar');
        b.classList.remove('confirmar');
        b.textContent = 'Eliminar';
    }

    function abrirModal(a, previos = {}) {
        $('modal-error').textContent = '';
        resetBotonEliminar();
        const editando = !!a;
        $('modal-titulo').textContent = editando ? 'Editar actividad' : 'Nueva actividad';
        $('btn-eliminar').hidden = !editando;
        const base = a ?? {
            id: '', titulo: '', tipo: 'estudio', exigencia: 2, horas: 1, estado: 'pendiente', proyecto: '', fija: false,
            fecha_inicio: previos.fecha || (vista === 'diario' || vista === 'moderno' ? cursor : hoyISO()),
            fecha_fin: previos.fecha || (vista === 'diario' || vista === 'moderno' ? cursor : hoyISO()),
            hora_inicio: previos.hora_inicio || null, hora_fin: null
        };
        campo('id').value = base.id;
        campo('titulo').value = base.titulo;
        campo('tipo').value = base.tipo;
        campo('exigencia').value = String(base.exigencia);
        campo('inicio').value = base.fecha_inicio;
        campo('fin').value = base.fecha_fin;
        campo('hora-inicio').value = base.hora_inicio || '';
        campo('hora-fin').value = base.hora_fin || '';
        campo('horas').value = base.horas;
        campo('estado').value = base.estado;
        campo('proyecto').value = base.proyecto;
        campo('fija').checked = base.fija === true;
        actualizarSugerenciasProyecto();
        abrirDialogo(modal);
        campo('titulo').focus();
    }

    // Mantiene coherentes fechas y horas mientras se edita
    campo('inicio').addEventListener('change', () => { if (campo('fin').value < campo('inicio').value) campo('fin').value = campo('inicio').value; });
    campo('tipo').addEventListener('change', () => {
        if (['ocio', 'deporte'].includes(campo('tipo').value)) campo('exigencia').value = '-2';
        else if (campo('exigencia').value === '-2') campo('exigencia').value = '2';
    });
    function sincronizarHoras() {
        const i = campo('hora-inicio').value, f = campo('hora-fin').value;
        if (i && f && aMin(f) > aMin(i)) {
            campo('horas').value = Math.min(12, Math.max(0.5, Math.round(((aMin(f) - aMin(i)) / 60) * 2) / 2));
        }
    }
    campo('hora-inicio').addEventListener('change', sincronizarHoras);
    campo('hora-fin').addEventListener('change', sincronizarHoras);

    $('btn-cancelar').addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); }); // clic en el fondo
    modal.addEventListener('close', resetBotonEliminar);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('modal-error');
        err.textContent = '';
        const id = campo('id').value;
        const cuerpo = {
            titulo: campo('titulo').value,
            tipo: campo('tipo').value,
            exigencia: Number(campo('exigencia').value),
            horas: Number(campo('horas').value),
            fecha_inicio: campo('inicio').value,
            fecha_fin: campo('fin').value || campo('inicio').value,
            hora_inicio: campo('hora-inicio').value,
            hora_fin: campo('hora-fin').value,
            estado: campo('estado').value,
            proyecto: campo('proyecto').value,
            fija: campo('fija').checked
        };
        if (!cuerpo.titulo.trim()) { err.textContent = 'El título es obligatorio.'; campo('titulo').focus(); return; }
        if (!cuerpo.fecha_inicio) { err.textContent = 'Elige la fecha de inicio.'; return; }

        const boton = $('btn-guardar');
        boton.disabled = true;
        try {
            const res = id
                ? await api(`/api/actividades/${encodeURIComponent(id)}`, cuerpo, 'PUT')
                : await api('/api/actividades', cuerpo, 'POST');
            if (!res.ok) { err.textContent = res.data.error || 'No se pudo guardar.'; return; }
            fijarActividades(res.data);
            modal.close();
            render();
        } catch { err.textContent = 'Error de conexión con el servidor.'; }
        finally { boton.disabled = false; }
    });

    $('btn-eliminar').addEventListener('click', async (e) => {
        const boton = e.currentTarget;   // currentTarget deja de existir tras el primer await
        const err = $('modal-error');
        if (!confirmandoBorrado) {       // primer clic: pide confirmación dentro del propio modal
            confirmandoBorrado = true;
            boton.classList.add('confirmar');
            boton.textContent = '¿Seguro? Confirmar';
            return;
        }
        boton.disabled = true;
        const id = campo('id').value;
        const titulo = campo('titulo').value;
        try {
            const res = await api(`/api/actividades/${encodeURIComponent(id)}`, undefined, 'DELETE');
            if (!res.ok) { err.textContent = res.data.error || 'No se pudo eliminar.'; resetBotonEliminar(); return; }
            fijarActividades(res.data);
            modal.close();
            render();
            // Borrado lógico: va a la papelera y se puede deshacer
            aviso(`🗑 «${titulo}» se movió a la papelera.`, {
                accion: 'Deshacer', alPulsar: async () => {
                    const r = await api(`/api/papelera/${encodeURIComponent(id)}/restaurar`, {}, 'POST').catch(() => null);
                    if (r?.ok) { fijarActividades(r.data.actividades); render(); aviso('♻ Restaurada.'); }
                    else aviso('No se pudo restaurar; búscala en la papelera.');
                }
            });
        } catch { err.textContent = 'Error de conexión con el servidor.'; }
        finally { boton.disabled = false; }
    });

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
    $('selector-vistas').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-vista]');
        if (b) setVista(b.dataset.vista);
    });
    $('selector-vistas').addEventListener('keydown', (e) => {   // navegación con flechas entre pestañas
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const nombres = Object.keys(VISTAS);
        const i = nombres.indexOf(vista) + (e.key === 'ArrowRight' ? 1 : -1);
        setVista(nombres[(i + nombres.length) % nombres.length]);
        document.querySelector(`#selector-vistas button[data-vista="${vista}"]`)?.focus();
    });
    $('btn-salir').addEventListener('click', (e) => cerrarSesion(e.currentTarget));
    $('btn-papelera').addEventListener('click', () => abrirPapelera({ alRestaurar: (lista) => { fijarActividades(lista); render(); } }));

    async function iniciar() {
        try { const v = localStorage.getItem('learntrack_vista_cal'); if (v && VISTAS[v]) vista = v; } catch { /* ignorar */ }
        render();
        try {
            const me = await api('/api/auth/me');
            if (!me.ok || !me.data.usuario) { location.assign('/?acceso=login'); return; }
            $('saludo-usuario').textContent = `Hola, ${me.data.usuario.nombre}`;
            const res = await api('/api/actividades');
            if (res.ok) fijarActividades(res.data);
            render();
        } catch (e) { console.error(e); }
        montarChatIA($('chat-ia'), {
            alActualizar: alActualizarDesdeChat,
            bienvenida: '👋 Dime algo como «Mañana tengo parcial de redes de 2 a 4 pm», «libera mi viernes» u «organízame la semana». También puedes dictar 🎤 o adjuntar tu cronograma 📎.'
        });
        // Si la pestaña queda abierta toda la noche, la línea de "hoy" se actualiza sola
        temporizadorHoy = setInterval(() => { if (document.visibilityState === 'visible' && !modal.open) render(); }, 5 * 60 * 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
