// Panel privado de LearnTrack. Este archivo solo se sirve con una sesión válida.
(() => {
    'use strict';

    const TIPOS_VALIDOS = ['estudio', 'trabajo', 'ocio', 'deporte'];
    const MENSAJE_IA_POR_DEFECTO = '💡 Mantén el equilibrio entre trabajo y descanso.';

    let actividades = [];
    let estadoAnimo = 'medio';
    let turnoIA = 0;

    function obtenerFechaHoy() {
        const d = new Date();
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const dia = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mes}-${dia}`;
    }
    const fechaHoyStr = obtenerFechaHoy();

    const $ = (id) => document.getElementById(id);
    const formActividad = $('form-actividad');
    const formError = $('form-error');
    const listaActividades = $('lista-actividades');
    const barraCarga = $('barra-progreso-carga');
    const porcentajeCarga = $('porcentaje-carga');
    const estadoMensaje = $('estado-mensaje');
    const consejoIa = $('consejo-ia');
    const resumenSemanalElem = $('resumen-semanal');

    // Elementos del Modal de Edición
    const modalEditar = $('modal-editar');
    const formEditar = $('form-editar-actividad');
    const editError = $('edit-error');

    async function api(url, cuerpo, metodo = 'POST') {
        const opciones = cuerpo === undefined ? { method: metodo } : {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
        };
        const res = await fetch(url, opciones);
        if (res.status === 401) {
            location.assign('/?acceso=login');
            throw new Error('Sesión no válida');
        }
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    }

    async function cargarUsuario() {
        const { ok, data } = await api('/api/auth/me', undefined, 'GET');
        if (!ok || !data.usuario) { location.assign('/?acceso=login'); return; }
        $('saludo-usuario').textContent = `Hola, ${data.usuario.nombre}`;
        $('titulo-bienvenida').textContent = `Hola, ${data.usuario.nombre}. Este es tu día.`;
    }

    $('btn-salir').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* se redirige igualmente */ }
        location.assign('/');
    });

    async function cargarDatosDesdeServidor() {
        try {
            await cargarUsuario();

            const resAct = await api('/api/actividades', undefined, 'GET');
            if (!resAct.ok) throw new Error(`Actividades: HTTP ${resAct.status}`);
            actividades = resAct.data;

            const resHist = await api('/api/historial', undefined, 'GET');
            if (!resHist.ok) throw new Error(`Historial: HTTP ${resHist.status}`);
            actualizarVistaHistorial(resHist.data);

            renderizar();
        } catch (e) {
            console.error('Error al cargar datos desde el servidor:', e);
            if (resumenSemanalElem) resumenSemanalElem.textContent = 'No se pudo cargar el historial.';
        }
    }

    function obtenerActividadesDeHoy() {
        return actividades.filter(act => act.fecha === fechaHoyStr);
    }

    async function calcularCargaMental() {
        let puntosCarga = 0;
        let capacidadBase = 100;

        if (estadoAnimo === 'bajo') capacidadBase = 70;
        if (estadoAnimo === 'alto') capacidadBase = 120;

        const actividadesHoy = obtenerActividadesDeHoy();
        actividadesHoy.forEach(act => {
            puntosCarga += (parseFloat(act.exigencia) * parseFloat(act.horas) * 10);
        });

        const porcentaje = Math.max(0, Math.round((puntosCarga / capacidadBase) * 100));

        if (actividadesHoy.length > 0) {
            try {
                const resHist = await api('/api/historial', { fecha: fechaHoyStr, porcentaje }, 'POST');
                if (resHist.ok) actualizarVistaHistorial(resHist.data);
            } catch (e) {
                console.error('Error al guardar historial:', e);
            }
        }

        await actualizarUI(porcentaje, actividadesHoy);
    }

    function actualizarVistaHistorial(historial) {
        if (!resumenSemanalElem) return;
        const fechas = Object.keys(historial).slice(-5);
        if (fechas.length === 0) {
            resumenSemanalElem.textContent = 'Sin registros previos.';
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'historial-grid';
        fechas.forEach(f => {
            const porcentaje = historial[f];
            let color = '#2e7d32';
            if (porcentaje > 85) color = '#c62828';
            else if (porcentaje >= 50) color = '#b26a00';

            const item = document.createElement('div');
            item.className = 'historial-item';
            const fecha = document.createElement('span');
            fecha.textContent = f.slice(5);
            const valor = document.createElement('strong');
            valor.textContent = `${porcentaje}%`;
            valor.style.color = color;
            item.append(fecha, valor);
            grid.appendChild(item);
        });
        resumenSemanalElem.replaceChildren(grid);
    }

    async function actualizarUI(porcentaje, actividadesHoy) {
        porcentajeCarga.textContent = `${porcentaje}%`;
        barraCarga.style.width = `${Math.min(porcentaje, 100)}%`;

        if (porcentaje < 50) {
            barraCarga.style.backgroundColor = '#4caf50';
            estadoMensaje.textContent = '🟢 Estado Equilibrado';
        } else if (porcentaje <= 85) {
            barraCarga.style.backgroundColor = '#ff9800';
            estadoMensaje.textContent = '🟡 Carga Moderada';
        } else {
            barraCarga.style.backgroundColor = '#e53935';
            estadoMensaje.textContent = '🔴 Advertencia de Saturación';
        }

        if (actividadesHoy.length === 0) {
            turnoIA++;
            consejoIa.textContent = '💡 Tu jornada está vacía. Agrega compromisos para calcular la carga.';
            return;
        }

        consejoIa.textContent = '🤖 Consultando seguro con la IA...';
        const turno = ++turnoIA;

        try {
            const res = await api('/api/ia/consultar', {
                estadoAnimo,
                porcentajeCarga: porcentaje,
                actividades: actividadesHoy.map(a => `${a.titulo} (${a.horas} hrs)`)
            }, 'POST');

            if (turno !== turnoIA) return;

            if (res.status === 429) consejoIa.textContent = `⏳ ${res.data.error || 'Demasiadas consultas. Espera unos minutos.'}`;
            else consejoIa.textContent = (res.ok && res.data.consejo) || MENSAJE_IA_POR_DEFECTO;
        } catch {
            if (turno === turnoIA) consejoIa.textContent = MENSAJE_IA_POR_DEFECTO;
        }
    }

    function abrirModalEdicion(actividad) {
        $('edit-id').value = actividad.id;
        $('edit-titulo').value = actividad.titulo;
        $('edit-tipo').value = actividad.tipo;
        $('edit-exigencia').value = actividad.exigencia;
        $('edit-horas').value = actividad.horas;
        editError.textContent = '';
        modalEditar.showModal();
    }

    async function borrarActividad(id) {
        if (!confirm('¿Deseas eliminar esta actividad de tu jornada?')) return;
        try {
            const res = await api(`/api/actividades/${id}`, undefined, 'DELETE');
            if (!res.ok) {
                alert(res.data.error || 'No se pudo eliminar la actividad.');
                return;
            }
            actividades = res.data;
            renderizar();
        } catch (err) {
            if (err.message !== 'Sesión no válida') alert('Error de conexión al eliminar.');
        }
    }

    function renderizar() {
        listaActividades.replaceChildren();
        const actividadesHoy = obtenerActividadesDeHoy();

        if (actividadesHoy.length === 0) {
            const vacio = document.createElement('li');
            vacio.className = 'sin-actividades';
            vacio.textContent = 'Sin actividades hoy.';
            listaActividades.appendChild(vacio);
        } else {
            actividadesHoy.forEach((act) => {
                const li = document.createElement('li');
                const tipo = TIPOS_VALIDOS.includes(act.tipo) ? act.tipo : '';
                li.className = `actividad-item ${tipo}`.trim();

                const caja = document.createElement('div');
                const titulo = document.createElement('strong');
                titulo.textContent = act.titulo;
                const detalle = document.createElement('small');
                detalle.textContent = `${String(act.tipo).toUpperCase()} • ${act.horas} hrs`;
                caja.append(titulo, document.createElement('br'), detalle);

                const acciones = document.createElement('div');
                acciones.className = 'actividad-acciones';

                const btnEdit = document.createElement('button');
                btnEdit.type = 'button';
                btnEdit.className = 'btn-icono btn-editar';
                btnEdit.title = 'Editar actividad';
                btnEdit.textContent = '✏️';
                btnEdit.addEventListener('click', () => abrirModalEdicion(act));

                const btnDelete = document.createElement('button');
                btnDelete.type = 'button';
                btnDelete.className = 'btn-icono btn-eliminar';
                btnDelete.title = 'Eliminar actividad';
                btnDelete.textContent = '🗑️';
                btnDelete.addEventListener('click', () => borrarActividad(act.id));

                acciones.append(btnEdit, btnDelete);

                li.append(caja, acciones);
                listaActividades.appendChild(li);
            });
        }

        calcularCargaMental();
    }

    formActividad.addEventListener('submit', async (e) => {
        e.preventDefault();
        formError.textContent = '';

        const boton = formActividad.querySelector('button[type="submit"]');
        boton.disabled = true;
        try {
            const res = await api('/api/actividades', {
                titulo: $('input-titulo').value,
                tipo: $('select-tipo').value,
                exigencia: $('select-exigencia').value,
                horas: $('input-horas').value,
                fecha: fechaHoyStr
            }, 'POST');
            if (!res.ok) {
                formError.textContent = res.data.error || 'No se pudo guardar la actividad.';
                return;
            }
            actividades = res.data;
            formActividad.reset();
            renderizar();
        } catch (err) {
            if (err.message !== 'Sesión no válida') formError.textContent = 'No se pudo conectar con el servidor.';
        } finally {
            boton.disabled = false;
        }
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();
        editError.textContent = '';

        const id = $('edit-id').value;
        const boton = formEditar.querySelector('button[type="submit"]');
        boton.disabled = true;

        try {
            const res = await api(`/api/actividades/${id}`, {
                titulo: $('edit-titulo').value,
                tipo: $('edit-tipo').value,
                exigencia: $('edit-exigencia').value,
                horas: $('edit-horas').value,
                fecha: fechaHoyStr
            }, 'PUT');

            if (!res.ok) {
                editError.textContent = res.data.error || 'No se pudo actualizar la actividad.';
                return;
            }

            actividades = res.data;
            modalEditar.close();
            renderizar();
        } catch (err) {
            if (err.message !== 'Sesión no válida') editError.textContent = 'Error al guardar cambios.';
        } finally {
            boton.disabled = false;
        }
    });

    $('btn-cancelar-edicion').addEventListener('click', () => {
        modalEditar.close();
    });

    $('select-animo').addEventListener('change', (e) => {
        estadoAnimo = e.target.value;
        calcularCargaMental();
    });

    document.addEventListener('DOMContentLoaded', cargarDatosDesdeServidor);
})();