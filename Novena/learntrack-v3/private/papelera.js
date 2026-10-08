// Papelera compartida (Mi panel y Mi agenda): lista lo eliminado y permite restaurarlo a mano.
import { h, api, abrirDialogo, aviso } from '/app/comun.js';
import { fechaCorta } from '/app/compartido/fechas.js';

const fmtDia = (fecha) => new Date(fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const cuando = (a) => `${fechaCorta(a.fecha_inicio)}${a.fecha_fin && a.fecha_fin !== a.fecha_inicio ? ` → ${fechaCorta(a.fecha_fin)}` : ''}${a.hora_inicio ? `, ${a.hora_inicio}` : ''}`;

function construir() {
    const lista = h('ul', { class: 'papelera-lista', 'aria-live': 'polite' });
    const nota = h('p', { class: 'papelera-nota' });
    const error = h('p', { class: 'papelera-error', role: 'alert' });
    const cerrar = h('button', { type: 'button', class: 'cal-btn', texto: 'Cerrar' });
    const dlg = h('dialog', { id: 'dlg-papelera', class: 'dlg-papelera', 'aria-labelledby': 'papelera-titulo' },
        h('div', { class: 'papelera-cuerpo' },
            h('h3', { id: 'papelera-titulo', texto: '🗑 Papelera' }), nota, lista, error,
            h('div', { class: 'papelera-pie' }, cerrar)));
    cerrar.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    return { dlg, lista, nota, error };
}

let ui = null;

/** Abre la papelera. alRestaurar(actividades) se llama tras cada restauración. */
export async function abrirPapelera({ alRestaurar = () => {} } = {}) {
    ui ??= construir();
    const { dlg, lista, nota, error } = ui;
    error.textContent = '';
    lista.replaceChildren(h('li', { class: 'vacia', texto: 'Cargando…' }));
    abrirDialogo(dlg);
    const r = await api('/api/papelera').catch(() => null);
    if (!r?.ok) { lista.replaceChildren(); error.textContent = 'No pude cargar la papelera.'; return; }
    nota.textContent = `Lo que eliminas se guarda ${r.data.dias} días y luego se borra solo.`;
    if (r.data.actividades.length === 0) { lista.replaceChildren(h('li', { class: 'vacia', texto: 'La papelera está vacía.' })); return; }
    lista.replaceChildren(...r.data.actividades.map((a) => {
        const li = h('li', { class: 'papelera-item' },
            h('div', {}, h('strong', { texto: a.titulo }), h('small', { texto: ` · ${cuando(a)}` }),
                h('div', { class: 'papelera-meta', texto: `Eliminada ${fmtDia(a.eliminadaEn)}` })));
        li.append(h('button', {
            type: 'button', class: 'cal-btn cal-btn-mini', texto: '♻ Restaurar', 'aria-label': `Restaurar ${a.titulo}`, on: {
                click: async (e) => {
                    const b = e.currentTarget; b.disabled = true;
                    const res = await api(`/api/papelera/${encodeURIComponent(a.id)}/restaurar`, {}).catch(() => null);
                    if (!res?.ok) { b.disabled = false; error.textContent = res?.data?.error || 'No se pudo restaurar.'; return; }
                    li.remove();
                    if (!lista.children.length) lista.append(h('li', { class: 'vacia', texto: 'La papelera está vacía.' }));
                    alRestaurar(res.data.actividades);
                    aviso(`♻ «${a.titulo}» restaurada.${res.data.avisos?.length ? ` ${res.data.avisos.join(' ')}` : ''}`);
                }
            }
        }));
        return li;
    }));
}
