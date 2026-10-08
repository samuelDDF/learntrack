// dashboard.js — "Mi panel" (módulo ES): check-in diario, medidor de carga, consejo de la IA, historial,
// chat compartido y lista del día con su modal de edición.
// La carga se calcula con la MISMA regla que la Agenda y el servidor (compartido/carga.js): una actividad aporta
// sus horas a cada día de su rango, y las completadas siguen contando.
import { cargaDelDia, actividadesDelDia, capacidadDe, normalizarActividad } from '/app/compartido/carga.js';
import { h, api, hoyISO, abrirDialogo, aviso, cerrarSesion } from '/app/comun.js';
import { montarChatIA } from '/app/chat-ia.js';
import { abrirPapelera } from '/app/papelera.js';

const MENSAJE_IA_POR_DEFECTO = '💡 Mantén el equilibrio entre trabajo y descanso.';
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
const modalEditar = $('modal-editar');
const formEditar = $('form-editar-actividad');
const editError = $('edit-error');
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
        const nivel = p > 85 ? 'rojo' : p >= 50 ? 'amarillo' : 'verde';
        return h('div', { class: 'historial-item' }, h('span', { texto: f.slice(5) }), h('strong', { class: `texto-${nivel}`, texto: `${p}%` }));
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
    if (hoy.length === 0) { consejoIa.textContent = '💡 Tu jornada está vacía. Escribe en el chat para añadir compromisos.'; return; }
    consejoIa.textContent = 'Consultando con la IA…';
    const contexto = checkin ? `INFO EXTRA DEL USUARIO HOY -> Durmió: ${checkin.sueno} / Objetivo de hoy: ${checkin.enfoque}` : '';
    try {
        const r = await api('/api/ia/consultar', {
            estadoAnimo: checkin?.animo ?? 'medio', porcentajeCarga: porcentaje,
            actividades: [contexto, ...hoy.map((a) => `${a.titulo} (${a.horas} hrs)`)].filter(Boolean)
        }, 'POST');
        if (turno !== turnoIA) return;
        consejoIa.textContent = (r.ok && r.data.consejo) || MENSAJE_IA_POR_DEFECTO;
    } catch {
        if (turno === turnoIA) consejoIa.textContent = MENSAJE_IA_POR_DEFECTO;
    }
}

// ---------------------------------------------------------------- lista del día
function abrirModalEdicion(a) {
    $('edit-id').value = a.id;
    $('edit-titulo').value = a.titulo;
    $('edit-tipo').value = a.tipo;
    $('edit-exigencia').value = String(a.exigencia);
    $('edit-horas').value = a.horas;
    editError.textContent = '';
    abrirDialogo(modalEditar);
}

async function borrarActividad(a) {
    try {
        const res = await api(`/api/actividades/${encodeURIComponent(a.id)}`, undefined, 'DELETE');
        if (!res.ok) { aviso(res.data.error || 'Error al eliminar.'); return; }
        fijar(res.data);
        renderizar();
        aviso(`🗑 «${a.titulo}» se movió a la papelera.`, {
            accion: 'Deshacer', alPulsar: async () => {
                const r = await api(`/api/papelera/${encodeURIComponent(a.id)}/restaurar`, {}, 'POST').catch(() => null);
                if (r?.ok) { fijar(r.data.actividades); renderizar(); } else aviso('No se pudo restaurar; búscala en la papelera.');
            }
        });
    } catch { aviso('Error de conexión.'); }
}

function renderizar() {
    const hoy = actividadesDeHoy();
    if (hoy.length === 0) {
        gridCalendario.replaceChildren(h('div', { class: 'lista-vacia', texto: 'No hay actividades en el calendario para hoy.' }));
    } else {
        gridCalendario.replaceChildren(...hoy.map((a) => {
            const clase = a.exigencia === 3 ? 'exig-alta' : (a.tipo === 'ocio' || a.tipo === 'deporte') ? 'recarga' : '';
            const rango = a.fecha_fin !== a.fecha_inicio ? ` · ${a.fecha_inicio.slice(5)} → ${a.fecha_fin.slice(5)}` : '';
            const hora = a.hora_inicio ? ` · ${a.hora_inicio}${a.hora_fin ? `–${a.hora_fin}` : ''}` : '';
            // textContent siempre: el título lo escribe el usuario (o la IA)
            const info = h('div', { class: 'act-info' },
                h('strong', { class: a.estado === 'completado' ? 'tachado' : '', texto: a.titulo }),
                h('small', { texto: `${String(a.tipo).toUpperCase()} • ${a.horas} h${hora}${rango} (Exigencia: ${a.exigencia})${a.estado === 'completado' ? ' • completada' : ''}` }));
            const btnDel = h('button', { type: 'button', class: 'btn-icono', texto: '🗑️', 'aria-label': `Eliminar ${a.titulo}` });
            btnDel.addEventListener('click', () => {
                // Confirmación en dos pasos sin diálogos del navegador
                if (btnDel.dataset.confirmar !== '1') {
                    btnDel.dataset.confirmar = '1';
                    btnDel.textContent = '¿Seguro?';
                    btnDel.classList.add('confirmar');
                    setTimeout(() => { if (btnDel.isConnected) { btnDel.dataset.confirmar = ''; btnDel.textContent = '🗑️'; btnDel.classList.remove('confirmar'); } }, 4000);
                    return;
                }
                borrarActividad(a);
            });
            return h('div', { class: `act-dia ${clase}` }, info,
                h('div', { class: 'act-acciones' },
                    h('button', { type: 'button', class: 'btn-icono', texto: '✏️', 'aria-label': `Editar ${a.titulo}`, on: { click: () => abrirModalEdicion(a) } }),
                    btnDel));
        }));
    }
    if (checkin) calcularCargaMental();
    else abrirCheckin();
}

formEditar.addEventListener('submit', async (e) => {
    e.preventDefault();
    editError.textContent = '';
    const id = $('edit-id').value;
    const boton = formEditar.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
        const res = await api(`/api/actividades/${encodeURIComponent(id)}`, {
            titulo: $('edit-titulo').value, tipo: $('edit-tipo').value, exigencia: Number($('edit-exigencia').value), horas: Number($('edit-horas').value)
        }, 'PUT');
        if (!res.ok) { editError.textContent = res.data.error || 'Error al actualizar.'; return; }
        fijar(res.data);
        modalEditar.close();
        renderizar();
    } catch { editError.textContent = 'Error de servidor.'; }
    finally { boton.disabled = false; }
});
$('btn-cancelar-edicion').addEventListener('click', () => modalEditar.close());
$('btn-salir').addEventListener('click', (e) => cerrarSesion(e.currentTarget));
$('btn-papelera').addEventListener('click', () => abrirPapelera({ alRestaurar: (lista) => { fijar(lista); renderizar(); } }));

// ---------------------------------------------------------------- arranque
async function iniciar() {
    try {
        const me = await api('/api/auth/me');
        if (!me.ok || !me.data.usuario) { location.assign('/?acceso=login'); return; }
        usuario = me.data.usuario;
        $('saludo-usuario').textContent = `Hola, ${usuario.nombre}`;
        $('titulo-bienvenida').textContent = `Hola, ${usuario.nombre}. Este es tu día.`;
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
        alActualizar: (lista) => { fijar(lista); renderizar(); },
        bienvenida: '¡Hola! Escribe algo como «Mañana tengo parcial de redes de 2 a 4 pm con exigencia alta» o «Hoy jugué fútbol 1 hora». También puedo liberar un día, reorganizar tu semana o planificar un proyecto.'
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
