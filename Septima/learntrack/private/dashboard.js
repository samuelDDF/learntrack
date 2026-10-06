// dashboard.js
(() => {
    'use strict';

    const TIPOS_VALIDOS = ['estudio', 'trabajo', 'ocio', 'deporte'];
    const MENSAJE_IA_POR_DEFECTO = '💡 Mantén el equilibrio entre trabajo y descanso.';

    let actividades = [];
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
    const barraCarga = $('barra-progreso-carga');
    const porcentajeCarga = $('porcentaje-carga');
    const estadoMensaje = $('estado-mensaje');
    const consejoIa = $('consejo-ia');
    const resumenSemanalElem = $('resumen-semanal');
    
    const formChat = $('form-chat-ia');
    const inputChatTexto = $('input-chat-texto');
    const chatContenedor = $('chat-contenedor');
    const chatError = $('chat-error');
    const gridCalendario = $('grid-calendario');

    const modalEditar = $('modal-editar');
    const formEditar = $('form-editar-actividad');
    const editError = $('edit-error');
    const modalEncuesta = $('modal-encuesta');
    const formEncuesta = $('form-encuesta');
    const btnRehacerEncuesta = $('btn-rehacer-encuesta');

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

    modalEncuesta.addEventListener('cancel', (e) => e.preventDefault());

    function verificarEncuestaDiaria() {
        const claveCache = `learntrack_encuesta_${fechaHoyStr}`;
        const datosGuardados = localStorage.getItem(claveCache);

        if (datosGuardados) {
            const datos = JSON.parse(datosGuardados);
            estadoAnimo = datos.animo;
            contextoEncuestaIA = datos.contexto;
            return true;
        }

        modalEncuesta.showModal();
        return false;
    }

    btnRehacerEncuesta.addEventListener('click', () => {
        const claveCache = `learntrack_encuesta_${fechaHoyStr}`;
        const datosGuardados = localStorage.getItem(claveCache);
        
        if (datosGuardados) {
            const datos = JSON.parse(datosGuardados);
            if (datos.animo) $('encuesta-animo').value = datos.animo;
            if (datos.sueno) $('encuesta-sueno').value = datos.sueno;
            if (datos.enfoque) $('encuesta-enfoque').value = datos.enfoque;
        }
        
        modalEncuesta.showModal();
    });

    formEncuesta.addEventListener('submit', (e) => {
        e.preventDefault();
        
        estadoAnimo = $('encuesta-animo').value;
        const sueno = $('encuesta-sueno').value;
        const enfoque = $('encuesta-enfoque').value;

        contextoEncuestaIA = `INFO EXTRA DEL USUARIO HOY -> Durmió: ${sueno} / Objetivo de hoy: ${enfoque}`;
        localStorage.setItem(`learntrack_encuesta_${fechaHoyStr}`, JSON.stringify({
            animo: estadoAnimo, sueno: sueno, enfoque: enfoque, contexto: contextoEncuestaIA
        }));

        modalEncuesta.close();
        calcularCargaMental();
    });

    // --- MANEJO DEL CHAT CON IA ---
    function agregarMensajeChat(texto, remitente, idCustom = null) {
        const div = document.createElement('div');
        if (idCustom) div.id = idCustom;
        div.className = `chat-mensaje ${remitente}`;
        div.style.cssText = remitente === 'usuario' 
            ? 'background: #0366d6; color: white; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem; max-width: 85%; align-self: flex-end;'
            : 'background: #e1effe; color: #24292e; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem; max-width: 85%; align-self: flex-start;';
        div.textContent = texto;
        chatContenedor.appendChild(div);
        chatContenedor.scrollTop = chatContenedor.scrollHeight;
    }

    formChat.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textoUsuario = inputChatTexto.value.trim();
        if (!textoUsuario) return;

        chatError.textContent = '';
        agregarMensajeChat(textoUsuario, 'usuario');
        inputChatTexto.value = '';

        const botonEnvio = formChat.querySelector('button');
        botonEnvio.disabled = true;
        agregarMensajeChat('Analizando con Llama 3.2...', 'ia', 'temp-ia');

        try {
            const res = await api('/api/ia/parsear', { texto: textoUsuario, fechaHoy: fechaHoyStr });
            document.getElementById('temp-ia')?.remove();

            if (!res.ok || !res.data.actividad) {
                agregarMensajeChat('⚠️️ No pude interpretar los detalles. Intenta ser más claro.', 'ia');
                return;
            }

            const actParseada = res.data.actividad;
            const resGuardar = await api('/api/actividades', {
<<<<<<< HEAD
                titulo: actParseada.titulo,
=======
                ...actParseada,
>>>>>>> calendario
                tipo: TIPOS_VALIDOS.includes(actParseada.tipo) ? actParseada.tipo : 'estudio',
                exigencia: actParseada.exigencia || 2,
                horas: actParseada.horas || 1,
                fecha: actParseada.fecha || fechaHoyStr
            }, 'POST');

            if (!resGuardar.ok) {
                agregarMensajeChat('❌ Error al guardar en el sistema.', 'ia');
                return;
            }

            actividades = resGuardar.data;
            renderizar();
            agregarMensajeChat(`✅ ¡Agendado! "${actParseada.titulo}" (${actParseada.horas} hrs) se ha guardado en el sistema.`, 'ia');

        } catch (err) {
            document.getElementById('temp-ia')?.remove();
            chatError.textContent = 'Error de conexión con la IA local.';
        } finally {
            botonEnvio.disabled = false;
        }
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
            consejoIa.textContent = '💡 Tu jornada está vacía. Escribe en el chat para añadir compromisos.';
            return;
        }

        consejoIa.textContent = '🤖 Consultando seguro con la IA...';
        const turno = ++turnoIA;

        try {
            const payloadIA = {
                estadoAnimo: estadoAnimo, 
                porcentajeCarga: porcentaje, 
                actividades: [contextoEncuestaIA, ...actividadesHoy.map(a => `${a.titulo} (${a.horas} hrs)`)]
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
        gridCalendario.replaceChildren();
        const actividadesHoy = obtenerActividadesDeHoy();

        if (actividadesHoy.length === 0) {
            const vacio = document.createElement('div');
            vacio.style.cssText = 'padding: 15px; text-align: center; color: #666; font-size: 0.9rem; background: #fff; border-radius: 6px; border: 1px dashed #ccc;';
            vacio.textContent = 'No hay actividades en el calendario para hoy.';
            gridCalendario.appendChild(vacio);
        } else {
            actividadesHoy.forEach((act) => {
                const bloque = document.createElement('div');
                bloque.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 12px; border-radius: 6px; border-left: 4px solid var(--azul); box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 8px;';
                
                if (act.tipo === 'ocio' || act.tipo === 'deporte') bloque.style.borderLeftColor = '#2e7d32';
                if (act.exigencia == 3) bloque.style.borderLeftColor = '#e53935';

                const info = document.createElement('div');
                info.innerHTML = `<strong>${act.titulo}</strong><br><small style="color: #666;">${String(act.tipo).toUpperCase()} • ${act.horas} hrs (Exigencia: ${act.exigencia})</small>`;

                const acciones = document.createElement('div');
                acciones.style.display = 'flex';
                acciones.style.gap = '5px';

                const btnEdit = document.createElement('button');
                btnEdit.type = 'button';
                btnEdit.className = 'btn-icono';
                btnEdit.textContent = '✏️';
                btnEdit.addEventListener('click', () => abrirModalEdicion(act));

                const btnDel = document.createElement('button');
                btnDel.type = 'button';
                btnDel.className = 'btn-icono';
                btnDel.textContent = '🗑️';
                btnDel.addEventListener('click', () => borrarActividad(act.id));

                acciones.append(btnEdit, btnDel);
                bloque.append(info, acciones);
                gridCalendario.appendChild(bloque);
            });
        }
        
        if (verificarEncuestaDiaria()) {
            calcularCargaMental();
        }
    }

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();
        editError.textContent = '';
        const id = $('edit-id').value;
        const boton = formEditar.querySelector('button[type="submit"]');
        boton.disabled = true;
        try {
            const res = await api(`/api/actividades/${id}`, {
                titulo: $('edit-titulo').value, tipo:$('edit-tipo').value, exigencia: $('edit-exigencia').value, horas:$('edit-horas').value
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