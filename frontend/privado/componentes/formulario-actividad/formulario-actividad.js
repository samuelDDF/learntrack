// Componente COMPARTIDO por Mi panel y Mi agenda: ventana para crear, editar y eliminar una actividad,
// y la acción «eliminar con Deshacer». Construye su propio <dialog> (sin innerHTML) y avisa a la pantalla con
// `alCambiar(listaActualizada)` cada vez que las actividades cambian.
import { h, api, abrirDialogo, aviso, confirmarEnDosPasos, hoyISO } from '/app/comun/utilidades.js';
import { TIPOS, NOMBRE_TIPO, EXIGENCIAS, NOMBRE_EXIGENCIA, ESTADOS, NOMBRE_ESTADO, TIPOS_RECARGA } from '/app/compartido/catalogos.js';
import { aMinutos, horasEntre } from '/app/compartido/fechas.js';

const opciones = (valores, nombres) => valores.map((v) => h('option', { value: String(v), texto: nombres[v] }));

/** Borrado lógico (va a la papelera) con un aviso que permite deshacerlo */
export async function eliminarActividad(actividad, alCambiar) {
    const res = await api(`/api/actividades/${encodeURIComponent(actividad.id)}`, undefined, 'DELETE');
    if (!res.ok) return res.data.error || 'No se pudo eliminar.';
    alCambiar(res.data);
    aviso(`🗑 «${actividad.titulo}» se movió a la papelera.`, {
        accion: 'Deshacer', alPulsar: async () => {
            const r = await api(`/api/papelera/${encodeURIComponent(actividad.id)}/restaurar`, {}, 'POST').catch(() => null);
            if (r?.ok) { alCambiar(r.data.actividades); aviso('♻ Restaurada.'); } else aviso('No se pudo restaurar; búscala en la papelera.');
        }
    });
    return null;
}

/**
 * @param {object} op
 * @param {(actividades: object[]) => void} op.alCambiar   se llama con la lista nueva tras guardar o eliminar
 * @param {() => string[]} [op.proyectos]                   sugerencias para el campo «Proyecto»
 * @returns {{ abrir(actividad?: object|null, previos?: { fecha?: string, hora_inicio?: string }): void, dialogo: HTMLDialogElement }}
 */
export function crearFormularioActividad({ alCambiar, proyectos = () => [] }) {
    // ---- Construcción del formulario ----
    const campo = (id, etiqueta, control, { ancho = false, opcional = '' } = {}) =>
        h('div', { class: `campo${ancho ? ' campo-ancho' : ''}` },
            h('label', { for: id }, etiqueta, opcional ? h('span', { class: 'opcional', texto: ` (${opcional})` }) : null),
            control);
    const f = {
        id: h('input', { type: 'hidden', id: 'f-id' }),
        titulo: h('input', { type: 'text', id: 'f-titulo', maxlength: '100', required: true }),
        tipo: h('select', { id: 'f-tipo' }, opciones(TIPOS, NOMBRE_TIPO)),
        exigencia: h('select', { id: 'f-exigencia' }, opciones(EXIGENCIAS, { ...NOMBRE_EXIGENCIA, '-2': 'Recarga de energía' })),
        inicio: h('input', { type: 'date', id: 'f-inicio', required: true }),
        fin: h('input', { type: 'date', id: 'f-fin' }),
        horaInicio: h('input', { type: 'time', id: 'f-hora-inicio' }),
        horaFin: h('input', { type: 'time', id: 'f-hora-fin' }),
        horas: h('input', { type: 'number', id: 'f-horas', min: '0.5', max: '12', step: '0.5', value: '1' }),
        estado: h('select', { id: 'f-estado' }, opciones(ESTADOS, NOMBRE_ESTADO)),
        proyecto: h('input', { type: 'text', id: 'f-proyecto', maxlength: '60', list: 'lista-proyectos' }),
        fija: h('input', { type: 'checkbox', id: 'f-fija' })
    };
    const titulo = h('h3', { id: 'modal-titulo', texto: 'Nueva actividad' });
    const error = h('p', { id: 'modal-error', class: 'error-formulario campo-ancho', role: 'alert' });
    const listaProyectos = h('datalist', { id: 'lista-proyectos' });
    const btnEliminar = h('button', { type: 'button', class: 'boton boton-peligro', id: 'btn-eliminar', texto: 'Eliminar', hidden: true });
    const btnCancelar = h('button', { type: 'button', class: 'boton', id: 'btn-cancelar', texto: 'Cancelar' });
    const btnGuardar = h('button', { type: 'submit', class: 'boton boton-primario', id: 'btn-guardar', texto: 'Guardar' });

    const form = h('form', { id: 'form-actividad', class: 'formulario-dialogo', novalidate: true },
        titulo, f.id,
        campo('f-titulo', 'Título', f.titulo, { ancho: true }),
        campo('f-tipo', 'Tipo', f.tipo),
        campo('f-exigencia', 'Exigencia', f.exigencia),
        campo('f-inicio', 'Fecha de inicio', f.inicio),
        campo('f-fin', 'Fecha de fin', f.fin),
        campo('f-hora-inicio', 'Hora de inicio', f.horaInicio),
        campo('f-hora-fin', 'Hora de fin', f.horaFin),
        campo('f-horas', 'Horas', f.horas),
        campo('f-estado', 'Estado', f.estado),
        campo('f-proyecto', 'Proyecto', [f.proyecto, listaProyectos], { ancho: true, opcional: 'opcional, agrupa en el Timeline' }),
        h('div', { class: 'campo campo-ancho campo-check' }, f.fija,
            h('label', { for: 'f-fija' }, 'Fija', h('span', { class: 'opcional', texto: ' (el asistente no la moverá al liberar días o reorganizar)' }))),
        error,
        h('div', { class: 'modal-pie campo-ancho' }, btnEliminar, h('span', { class: 'espaciador' }), btnCancelar, btnGuardar));
    const dialogo = h('dialog', { id: 'modal-actividad', class: 'dialogo', 'aria-labelledby': 'modal-titulo' }, form);
    document.body.append(dialogo);

    // ---- Coherencia mientras se edita ----
    f.inicio.addEventListener('change', () => { if (f.fin.value < f.inicio.value) f.fin.value = f.inicio.value; });
    f.tipo.addEventListener('change', () => {
        if (TIPOS_RECARGA.includes(f.tipo.value)) f.exigencia.value = '-2';
        else if (f.exigencia.value === '-2') f.exigencia.value = '2';
    });
    const sincronizarHoras = () => {
        const i = f.horaInicio.value, fin = f.horaFin.value;
        if (i && fin && aMinutos(fin) > aMinutos(i)) f.horas.value = horasEntre(i, fin);
    };
    f.horaInicio.addEventListener('change', sincronizarHoras);
    f.horaFin.addEventListener('change', sincronizarHoras);

    btnCancelar.addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });   // clic en el fondo

    // ---- Guardar ----
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.textContent = '';
        const cuerpo = {
            titulo: f.titulo.value, tipo: f.tipo.value, exigencia: Number(f.exigencia.value), horas: Number(f.horas.value),
            fecha_inicio: f.inicio.value, fecha_fin: f.fin.value || f.inicio.value,
            hora_inicio: f.horaInicio.value, hora_fin: f.horaFin.value,
            estado: f.estado.value, proyecto: f.proyecto.value, fija: f.fija.checked
        };
        if (!cuerpo.titulo.trim()) { error.textContent = 'El título es obligatorio.'; f.titulo.focus(); return; }
        if (!cuerpo.fecha_inicio) { error.textContent = 'Elige la fecha de inicio.'; return; }
        btnGuardar.disabled = true;
        try {
            const id = f.id.value;
            const res = id
                ? await api(`/api/actividades/${encodeURIComponent(id)}`, cuerpo, 'PUT')
                : await api('/api/actividades', cuerpo, 'POST');
            if (!res.ok) { error.textContent = res.data.error || 'No se pudo guardar.'; return; }
            dialogo.close();
            alCambiar(res.data);
        } catch { error.textContent = 'Error de conexión con el servidor.'; }
        finally { btnGuardar.disabled = false; }
    });

    // ---- Eliminar (confirmación dentro de la propia ventana) ----
    const restablecerEliminar = confirmarEnDosPasos(btnEliminar, async () => {
        btnEliminar.disabled = true;
        try {
            const fallo = await eliminarActividad({ id: f.id.value, titulo: f.titulo.value }, alCambiar);
            if (fallo) error.textContent = fallo; else dialogo.close();
        } catch { error.textContent = 'Error de conexión con el servidor.'; }
        finally { btnEliminar.disabled = false; }
    }, { textoConfirmar: '¿Seguro? Confirmar', ms: 60000 });
    dialogo.addEventListener('close', restablecerEliminar);

    // ---- Abrir ----
    function abrir(actividad = null, previos = {}) {
        error.textContent = '';
        restablecerEliminar();
        titulo.textContent = actividad ? 'Editar actividad' : 'Nueva actividad';
        btnEliminar.hidden = !actividad;
        const fecha = previos.fecha || hoyISO();
        const a = actividad ?? {
            id: '', titulo: '', tipo: 'estudio', exigencia: 2, horas: 1, estado: 'pendiente', proyecto: '', fija: false,
            fecha_inicio: fecha, fecha_fin: fecha, hora_inicio: previos.hora_inicio || null, hora_fin: null
        };
        f.id.value = a.id;
        f.titulo.value = a.titulo;
        f.tipo.value = a.tipo;
        f.exigencia.value = String(a.exigencia);
        f.inicio.value = a.fecha_inicio;
        f.fin.value = a.fecha_fin;
        f.horaInicio.value = a.hora_inicio || '';
        f.horaFin.value = a.hora_fin || '';
        f.horas.value = a.horas;
        f.estado.value = a.estado;
        f.proyecto.value = a.proyecto;
        f.fija.checked = a.fija === true;
        listaProyectos.replaceChildren(...proyectos().map((p) => h('option', { value: p })));
        abrirDialogo(dialogo);
        f.titulo.focus();
    }

    return { abrir, dialogo };
}
