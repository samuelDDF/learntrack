// Panel privado de LearnTrack (Con Encuesta Diaria)
(() => {
    'use strict';

    const TIPOS_VALIDOS = ['estudio', 'trabajo', 'ocio', 'deporte'];
    const MENSAJE_IA_POR_DEFECTO = '💡 Mantén el equilibrio entre trabajo y descanso.';

    let actividades = [];
    
    // Variables de estado del usuario
    let estadoAnimo = 'medio';
    let contextoEncuestaIA = '';
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

    // Modales
    const modalEditar = $('modal-editar');
    const formEditar = $('form-editar-actividad');
    const editError = $('edit-error');
    
    const modalEncuesta = $('modal-encuesta');
    const formEncuesta = $('form-encuesta');

    async function api(url, cuerpo, metodo = 'POST') {
        const opciones = cuerpo === undefined ? { method: metodo } : {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
        };
        const res = await fetch(url, opciones);
        if (res.status === 401) { location.assign('/?acceso=login'); throw new Error('Sesión no válida'); }
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
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { }
        location.assign('/');
    });

    async function cargarDatosDesdeServidor() {
        try {
            await cargarUsuario();
            const resAct = await api('/api/actividades', undefined, 'GET');
            if (resAct.ok) actividades = resAct.data;

            const resHist = await api('/api/historial', undefined, 'GET');
            if (resHist.ok) actualizarVistaHistorial(resHist.data);

            renderizar();
        } catch (e) {
            console.error(e);
        }
    }

    function obtenerActividadesDeHoy() { return actividades.filter(act => act.fecha === fechaHoyStr); }

    // --- NUEVO FLUJO DE ENCUESTA DIARIA ---
    
    // Evita que el usuario cierre la encuesta con la tecla ESC
    modalEncuesta.addEventListener('cancel', (e) => e.preventDefault());

    function verificarEncuestaDiaria() {
        // Buscamos si ya se llenó la encuesta hoy en el LocalStorage
        const claveCache = `learntrack_encuesta_${fechaHoyStr}`;
        const datosGuardados = localStorage.getItem(claveCache);

        if (datosGuardados) {
            const datos = JSON.parse(datosGuardados);
            estadoAnimo = datos.animo;
            contextoEncuestaIA = datos.contexto;
            return true; // Ya completó el check-in hoy
        }

        // Si no la ha llenado, mostramos el modal obligatoriamente
        modalEncuesta.showModal();
        return false;
    }

    formEncuesta.addEventListener('submit', (e) => {
        e.preventDefault();
        
        estadoAnimo = $('encuesta-animo').value;
        const sueno = $('encuesta-sueno').value;
        const enfoque = $('encuesta-enfoque').value;

        // Formateamos este contexto extra para enviárselo luego a la IA
        contextoEncuestaIA = `INFO EXTRA DEL USUARIO HOY -> Durmió: ${sueno} / Objetivo de hoy: ${enfoque}`;

        // Guardamos en el navegador para que no le vuelva a preguntar hoy
        const claveCache = `learntrack_encuesta_${fechaHoyStr}`;
        localStorage.setItem(claveCache, JSON.stringify({
            animo: estadoAnimo,
            contexto: contextoEncuestaIA
        }));

        modalEncuesta.close();
        
        // Ahora sí, calculamos la carga y llamamos a la IA
        calcularCargaMental();
    });

    // --------------------------------------

    async function calcularCargaMental() {
        let puntosCarga = 0;
        let capacidadBase = estadoAnimo === 'bajo' ? 70 : (estadoAnimo === 'alto' ? 120 : 100);

        const actividadesHoy = obtenerActividadesDeHoy();
        actividadesHoy.forEach(act => { puntosCarga += (parseFloat(act.exigencia) * parseFloat(act.horas) * 10); });

        const porcentaje = Math.max(0, Math.round((puntosCarga / capacidadBase) * 100));

        if (actividadesHoy.length > 0) {
            try {
                const resHist = await api('/api/historial', { fecha: fechaHoyStr, porcentaje }, 'POST');
                if (resHist.ok) actualizarVistaHistorial(resHist.data);
            } catch (e) { console.error(e); }
        }
        await actualizarUI(porcentaje, actividadesHoy);
    }

    function actualizarVistaHistorial(historial) {
        if (!resumenSemanalElem) return;
        const fechas = Object.keys(historial).slice(-5);
        if (fechas.length === 0) { resumenSemanalElem.textContent = 'Sin registros previos.'; return; }

        const grid = document.createElement('div');
        grid.className = 'historial-grid';
        fechas.forEach(f => {
            const porcentaje = historial[f];
            let color = porcentaje > 85 ? '#c62828' : (porcentaje >= 50 ? '#b26a00' : '#2e7d32');

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

        if (porcentaje < 50) { barraCarga.style.backgroundColor = '#4caf50'; estadoMensaje.textContent = '🟢 Estado Equilibrado'; }
        else if (porcentaje <= 85) { barraCarga.style.backgroundColor = '#ff9800'; estadoMensaje.textContent = '🟡 Carga Moderada'; }
        else { barraCarga.style.backgroundColor = '#e53935'; estadoMensaje.textContent = '🔴 Advertencia de Saturación'; }

        if (actividadesHoy.length === 0) {
            turnoIA++;
            consejoIa.textContent = '💡 Tu jornada está vacía. Agrega compromisos para calcular la carga.';
            return;
        }

        consejoIa.textContent = '🤖 Consultando seguro con la IA...';
        const turno = ++turnoIA;

        try {
            // Le pasamos el contexto adicional dentro de la lista de actividades a la IA
            const payloadIA = {
                estadoAnimo: estadoAnimo, 
                porcentajeCarga: porcentaje, 
                actividades: [
                    contextoEncuestaIA, 
                    ...actividadesHoy.map(a => `${a.titulo} (${a.horas} hrs)`)
                ]
            };

            const res = await api('/api/ia/consultar', payloadIA, 'POST');
            
            if (turno !== turnoIA) return;
            consejoIa.textContent = (res.ok && res.data.consejo) || MENSAJE_IA_POR_DEFECTO;
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
            if (!res.ok) { alert(res.data.error || 'Error al eliminar.'); return; }
            actividades = res.data;
            renderizar();
        } catch (err) { alert('Error de conexión.'); }
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
                btnEdit.className = 'btn-icono';
                btnEdit.title = 'Editar actividad';
                btnEdit.textContent = '✏️';
                btnEdit.addEventListener('click', () => abrirModalEdicion(act));

                const btnDelete = document.createElement('button');
                btnDelete.type = 'button';
                btnDelete.className = 'btn-icono';
                btnDelete.title = 'Eliminar actividad';
                btnDelete.textContent = '🗑️';
                btnDelete.addEventListener('click', () => borrarActividad(act.id));

                acciones.append(btnEdit, btnDelete);
                li.append(caja, acciones);
                listaActividades.appendChild(li);
            });
        }
        
        // Bloqueamos el cálculo inicial de la IA si la encuesta aún no se ha respondido
        if (verificarEncuestaDiaria()) {
            calcularCargaMental();
        }
    }

    formActividad.addEventListener('submit', async (e) => {
        e.preventDefault();
        formError.textContent = '';
        const boton = formActividad.querySelector('button[type="submit"]');
        boton.disabled = true;
        try {
            const res = await api('/api/actividades', {
                titulo: $('input-titulo').value, tipo:$('select-tipo').value, exigencia: $('select-exigencia').value, horas:$('input-horas').value, fecha: fechaHoyStr
            }, 'POST');
            if (!res.ok) { formError.textContent = res.data.error || 'No se pudo guardar.'; return; }
            actividades = res.data;
            formActividad.reset();
            renderizar();
        } catch (err) { formError.textContent = 'Error de servidor.'; } finally { boton.disabled = false; }
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();
        editError.textContent = '';
        const id = $('edit-id').value;
        const boton = formEditar.querySelector('button[type="submit"]');
        boton.disabled = true;
        try {
            const res = await api(`/api/actividades/${id}`, {
                titulo: $('edit-titulo').value, tipo:$('edit-tipo').value, exigencia: $('edit-exigencia').value, horas:$('edit-horas').value, fecha: fechaHoyStr
            }, 'PUT');
            if (!res.ok) { editError.textContent = res.data.error || 'Error al actualizar.'; return; }
            actividades = res.data;
            modalEditar.close();
            renderizar();
        } catch (err) { editError.textContent = 'Error de servidor.'; } finally { boton.disabled = false; }
    });

    $('btn-cancelar-edicion').addEventListener('click', () => modalEditar.close());

    document.addEventListener('DOMContentLoaded', cargarDatosDesdeServidor);
})();