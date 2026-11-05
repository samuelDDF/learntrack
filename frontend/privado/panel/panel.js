// Mi panel (módulo ES): check-in diario, medidor de carga, consejo de la IA, historial, chat compartido y
// la lista de hoy (se edita con el mismo formulario que Mi agenda).
// La carga se calcula con la MISMA regla que la Agenda y el servidor (compartido/carga.js): una actividad aporta
// sus horas a cada día de su rango, y las completadas siguen contando.
import { cargaDelDia, actividadesDelDia, capacidadDe, normalizarActividad, nivelCarga } from '/app/compartido/carga.js';
import { NOMBRE_TIPO, NOMBRE_EXIGENCIA, TIPOS_RECARGA } from '/app/compartido/catalogos.js';
import { textoHorario } from '/app/compartido/fechas.js';
import { h, api, hoyISO, abrirDialogo, aviso, confirmarEnDosPasos } from '/app/comun/utilidades.js';
import { usuarioActual } from '/app/comun/sesion.js';
import { montarBarraNavegacion } from '/app/componentes/barra-navegacion/barra-navegacion.js';
import { montarChatIA } from '/app/componentes/chat-ia/chat-ia.js';
import { abrirPapelera } from '/app/componentes/papelera/papelera.js';
import { crearFormularioActividad, eliminarActividad } from '/app/componentes/formulario-actividad/formulario-actividad.js';

const MENSAJE_IA_POR_DEFECTO = 'Pensando en ti...';
const fechaHoy = hoyISO();

let actividades = [];
let usuario = null;
let checkin = null;          // fuente de verdad: el servidor; localStorage solo como caché por usuario
let turnoIA = 0;

const $ = (id) => document.getElementById(id);
const barraCarga = $('barra-progreso-carga');
const porcentajeCarga = $('porcentaje-carga');
const estadoMensaje = $('estado-mensaje');
const consejoIa = $('consejo-ia');
const resumenSemanalElem = $('resumen-semanal');
const gridCalendario = $('grid-calendario');
const modalEncuesta = $('modal-encuesta');
const formEncuesta = $('form-encuesta');

const fijar = (lista) => { actividades = (Array.isArray(lista) ? lista : []).map(normalizarActividad); };
const actividadesDeHoy = () => actividadesDelDia(actividades, fechaHoy);

// ---------------------------------------------------------------- check-in (servidor + caché local)
const claveCache = () => `learntrack_checkin_${usuario?.id ?? 'anon'}_${fechaHoy}`;
function leerCache() {
    try { return JSON.parse(localStorage.getItem(claveCache()) || 'null'); } catch { return null; }
}
function escribirCache(datos) {
    try {
        localStorage.setItem(claveCache(), JSON.stringify(datos));
        // La clave antigua (sin usuario) la compartían todas las cuentas del navegador: se elimina
        localStorage.removeItem(`learntrack_encuesta_${fechaHoy}`);
    } catch { /* sin almacenamiento: no pasa nada */ }
}

modalEncuesta.addEventListener('cancel', (e) => { if (!checkin) e.preventDefault(); });   // el primero es obligatorio

function abrirCheckin() {
    if (checkin) {
        $('encuesta-animo').value = checkin.animo;
        $('encuesta-sueno').value = checkin.sueno;
        $('encuesta-enfoque').value = checkin.enfoque;
    }
    abrirDialogo(modalEncuesta);
}
$('btn-rehacer-encuesta').addEventListener('click', abrirCheckin);

formEncuesta.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = { fecha: fechaHoy, animo: $('encuesta-animo').value, sueno: $('encuesta-sueno').value, enfoque: $('encuesta-enfoque').value };
    const boton = formEncuesta.querySelector('button[type="submit"]');
    boton.disabled = true;
    $('encuesta-error').textContent = '';
    try {
        const r = await api('/api/checkin', datos, 'PUT');
        if (!r.ok) { $('encuesta-error').textContent = r.data.error || 'No se pudo guardar el check-in.'; return; }
        checkin = r.data.checkin;
        escribirCache(checkin);
        modalEncuesta.close();
        calcularCargaMental();
    } catch { $('encuesta-error').textContent = 'Error de conexión con el servidor.'; }
    finally { boton.disabled = false; }
});

// ---------------------------------------------------------------- carga, historial y consejo
async function calcularCargaMental() {
    const hoy = actividadesDeHoy();
    const carga = cargaDelDia(actividades, fechaHoy, capacidadDe(checkin));
    actualizarUI(carga);
    if (hoy.length > 0) {
        // El servidor recalcula el % con la misma regla y su check-in; solo guarda días <= hoy
        const r = await api('/api/historial', { fecha: fechaHoy, fechaHoy }, 'POST').catch(() => null);
        if (r?.ok) actualizarVistaHistorial(r.data);
    }
    pedirConsejo(carga.porcentaje, hoy);
}

function actualizarVistaHistorial(historial) {
    const fechas = Object.keys(historial).filter((f) => f <= fechaHoy).slice(-5);
    if (fechas.length === 0) { resumenSemanalElem.textContent = 'Sin registros previos.'; return; }
    const grid = h('div', { class: 'historial-grid' }, fechas.map((f) => {
        const p = historial[f];
        return h('div', { class: 'historial-item' }, h('span', { texto: f.slice(5) }), h('strong', { class: `nivel-${nivelCarga(p)}`, texto: `${p}%` }));
    }));
    resumenSemanalElem.replaceChildren(grid);
}

const ESTADO_TXT = { verde: '🟢 Estado Equilibrado', amarillo: '🟡 Carga Moderada', rojo: '🔴 Advertencia de Saturación' };
function actualizarUI({ porcentaje, nivel }) {
    porcentajeCarga.textContent = `${porcentaje}%`;
    barraCarga.style.width = `${Math.min(porcentaje, 100)}%`;          // CSSOM: permitido por la CSP
    barraCarga.classList.remove('nivel-barra-verde', 'nivel-barra-amarillo', 'nivel-barra-rojo');
    barraCarga.classList.add(`nivel-barra-${nivel}`);
    $('barra-carga-rol').setAttribute('aria-valuenow', String(Math.min(porcentaje, 100)));
    estadoMensaje.textContent = ESTADO_TXT[nivel];
}

async function pedirConsejo(porcentaje, hoy) {
    const turno = ++turnoIA;
    
    if (hoy.length === 0) { 
        consejoIa.textContent = MENSAJE_IA_POR_DEFECTO; 
        $('consejo-ia').parentElement.classList.add('pensando');
        return; 
    }
    
    consejoIa.textContent = MENSAJE_IA_POR_DEFECTO;
    $('consejo-ia').parentElement.classList.add('pensando'); 

    const contexto = checkin ? `INFO EXTRA DEL USUARIO HOY -> Durmió: ${checkin.sueno} / Objetivo de hoy: ${checkin.enfoque}` : '';
    try {
        const r = await api('/api/ia/consultar', {
            estadoAnimo: checkin?.animo ?? 'medio', porcentajeCarga: porcentaje,
            actividades: [contexto, ...hoy.map((a) => `${a.titulo} (${a.horas} hrs)`)].filter(Boolean)
        }, 'POST');
        if (turno !== turnoIA) return;
        
        consejoIa.textContent = (r.ok && r.data.consejo) || MENSAJE_IA_POR_DEFECTO;
        $('consejo-ia').parentElement.classList.remove('pensando');

    } catch {
        if (turno === turnoIA) {
            consejoIa.textContent = MENSAJE_IA_POR_DEFECTO;
            $('consejo-ia').parentElement.classList.remove('pensando');
        }
    }
}

// ---------------------------------------------------------------- lista del día
const alCambiar = (lista) => { fijar(lista); renderizar(); };
const formulario = crearFormularioActividad({ alCambiar });

/** Una fila de la lista de hoy: título, detalle y botones Editar / Eliminar (con confirmación) */
function filaActividad(a) {
    const clase = a.exigencia === 3 ? 'exig-alta' : TIPOS_RECARGA.includes(a.tipo) ? 'recarga' : '';
    const rango = a.fecha_fin !== a.fecha_inicio ? ` · ${a.fecha_inicio.slice(5)} → ${a.fecha_fin.slice(5)}` : '';
    const hora = a.hora_inicio ? ` · ${textoHorario(a)}` : '';
    const detalle = `${NOMBRE_TIPO[a.tipo].toUpperCase()} • ${a.horas} h${hora}${rango} (Exigencia: ${NOMBRE_EXIGENCIA[a.exigencia]})${a.estado === 'completado' ? ' • completada' : ''}`;
    const btnEliminar = h('button', { type: 'button', class: 'btn-icono', texto: '🗑️', 'aria-label': `Eliminar ${a.titulo}` });
    confirmarEnDosPasos(btnEliminar, async () => {
        const fallo = await eliminarActividad(a, alCambiar).catch(() => 'Error de conexión.');
        if (fallo) aviso(fallo);
    });
    return h('div', { class: `act-dia ${clase}` },
        h('div', { class: 'act-info' },
            h('strong', { class: a.estado === 'completado' ? 'tachado' : '', texto: a.titulo }),     // textContent: lo escribe el usuario o la IA
            h('small', { texto: detalle })),
        h('div', { class: 'act-acciones' },
            h('button', { type: 'button', class: 'btn-icono', texto: '✏️', 'aria-label': `Editar ${a.titulo}`, on: { click: () => formulario.abrir(a) } }),
            btnEliminar));
}

function renderizar() {
    const hoy = actividadesDeHoy();
    gridCalendario.replaceChildren(...(hoy.length
        ? hoy.map(filaActividad)
        : [h('div', { class: 'lista-vacia', texto: 'No hay actividades en el calendario para hoy.' })]));
    if (checkin) calcularCargaMental();
    else abrirCheckin();
}

montarBarraNavegacion();

// ---------------------------------------------------------------- festivo de hoy (importado desde el menú del perfil)
function mostrarFestivoDeHoy(festivos) {
    const deHoy = festivos.filter((f) => fechaHoy === f.fecha);   // festivos, no actividades: no entran en la carga
    const caja = $('aviso-festivo');
    caja.hidden = deHoy.length === 0;
    caja.textContent = deHoy.length ? `🎉 Hoy es festivo: ${deHoy.map((f) => f.nombre).join(' · ')}. Tómatelo con calma.` : '';
}
async function cargarFestivoDeHoy() {
    const r = await api(`/api/festivos?desde=${fechaHoy}&hasta=${fechaHoy}`).catch(() => null);
    if (r?.ok) mostrarFestivoDeHoy(r.data.festivos);
}
document.addEventListener('festivos-actualizados', (e) => mostrarFestivoDeHoy(e.detail?.festivos ?? []));
$('btn-papelera').addEventListener('click', () => abrirPapelera({ alRestaurar: alCambiar }));

// ---------------------------------------------------------------- arranque
async function iniciar() {
    try {
        usuario = await usuarioActual();
        if (!usuario) { location.assign('/?acceso=login'); return; }
        $('titulo-bienvenida').textContent = `Hola ${usuario.nombre},  Que tenemos hoy.`;
        cargarFestivoDeHoy();
        $('fecha-actual-label').textContent = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

        checkin = leerCache();               // pinta rápido con la caché…
        const [resAct, resHist, resChk] = await Promise.all([
            api('/api/actividades'), api('/api/historial'), api(`/api/checkin?fecha=${fechaHoy}`)
        ]);
        if (resAct.ok) fijar(resAct.data);
        if (resHist.ok) actualizarVistaHistorial(resHist.data);
        if (resChk.ok) {                     // …pero manda el servidor
            if (resChk.data.checkin) { checkin = resChk.data.checkin; escribirCache(checkin); }
            else if (checkin?.animo && checkin?.sueno && checkin?.enfoque) {
                // Caché de esta cuenta que no llegó al servidor: se sube
                const r = await api('/api/checkin', { fecha: fechaHoy, animo: checkin.animo, sueno: checkin.sueno, enfoque: checkin.enfoque }, 'PUT').catch(() => null);
                checkin = r?.ok ? r.data.checkin : null;
            } else checkin = null;
        }
        renderizar();
    } catch (e) { console.error(e); }

    montarChatIA($('chat-ia'), {
        alActualizar: alCambiar,
        bienvenida: 'Escribe algo como «Mañana tengo parcial de redes de 2 a 4 pm con exigencia alta» o «Hoy jugué fútbol 1 hora». También puedo liberar un día, reorganizar tu semana, planificar un proyecto o leer un archivo (📎 + tu mensaje).'
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
