// Componente de chat con IA COMPARTIDO por "Mi panel" y "Mi agenda" (mismo comportamiento en ambas páginas):
// burbujas, indicador de escritura, chips de sugerencias, dictado por voz, archivos (botón y arrastrar-soltar),
// tarjetas de propuesta (antes/después, Aplicar, Cancelar, Deshacer) y aclaraciones con respuestas rápidas.
// VOZ BIDIRECCIONAL: dictado (Speech-to-Text con webkitSpeechRecognition), lectura de respuestas (Text-to-Speech con
// speechSynthesis y la voz elegida en Configuración) y «modo conversación»: escucha → envía → responde en voz alta
// → vuelve a escuchar.
// ARCHIVO + MENSAJE: el archivo adjunto (📎 o arrastrar) queda preparado en el cuadro de texto; la persona escribe
// una explicación («son de la materia Redes», «solo los exámenes») y al pulsar Enviar viajan JUNTOS (multipart).
// El asistente se presenta con su nombre (nombreIA, Configuración › Voz de la IA).
// Sin innerHTML: todo el contenido que llega del servidor o del modelo se pinta con textContent.
import { h, api, hoyISO, tzOffset, aviso, horaLocal } from '/app/comun/utilidades.js';
import { usuarioActual } from '/app/comun/sesion.js';
import { hablar, callar, sintesisDisponible, cargarVozPreferida } from '/app/comun/voz.js';

const MAX_TURNOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ICONO_OP = { crear: '＋', mover: '↷', editar: '✎', eliminar: '🗑', restaurar: '♻' };
const NOMBRE_OP = { crear: 'Crear', mover: 'Mover', editar: 'Editar', eliminar: 'Eliminar', restaurar: 'Restaurar' };

let contador = 0;

/**
 * Dictado: «mañana estudio y luego entreno» → «mañana estudio, luego entreno». Separa las actividades que la persona
 * encadena con «y luego», «luego», «también» o «y» + fecha/hora, para que el asistente las distinga (idea de la 3.4.2).
 */
export function separarConectores(texto) {
    return String(texto ?? '')
        .replace(/\s+y luego\s+/gi, ', luego ')
        .replace(/(^|[^,])\s+luego\s+/gi, '$1, luego ')
        .replace(/\s+tambi[eé]n\s+/gi, ', también ')
        .replace(/\s+y\s+(?=(mañana|hoy|el|la|las|los|a las|de \d|despu[eé]s)\b)/gi, ', ');
}

const SUGERENCIAS = [
    { etiqueta: '¿Qué tengo mañana?', texto: '¿Qué tengo mañana?' },
    { etiqueta: 'Libera mi viernes', texto: 'Libera mi agenda del viernes' },
    { etiqueta: 'Organízame la semana', texto: 'Organízame la semana, tengo demasiado' },
    { etiqueta: 'Planificar un proyecto', texto: 'Tengo que hacer un proyecto de bases de datos para el ' },
    { etiqueta: 'Recuperar lo borrado', texto: 'Recupera lo que borré hoy' }
];

/**
 * @param {HTMLElement} raiz contenedor vacío
 * @param {object} op
 * @param {(actividades: object[]) => void} op.alActualizar se llama con la lista nueva cada vez que algo cambia
 * @param {string} [op.bienvenida]
 */
export function montarChatIA(raiz, { alActualizar = () => {}, bienvenida = '', sugerencias = SUGERENCIAS } = {}) {
    const id = `chatia-${++contador}`;
    const estado = {
        historial: [], propuestaPendiente: null, aclaracion: null, enviando: false, formatos: ['.txt', '.md', '.csv', '.ics', '.pdf', '.docx'], imagenes: false,
        leer: false, conversacion: false, silencios: 0, adjunto: null
    };

    // ---------------------------------------------------------------- DOM
    const log = h('div', { class: 'chatia-log', id: `${id}-log`, role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Conversación con el asistente', tabindex: '0' });
    const escribiendo = h('div', { class: 'chatia-escribiendo', hidden: true },
        h('span', { class: 'puntos', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'texto', texto: 'El asistente está pensando…' }));
    const entrada = h('textarea', { id: `${id}-texto`, class: 'chatia-entrada', rows: '2', maxlength: '500', placeholder: 'Escribe o dicta…', title: 'Enter envía · Mayús+Enter hace un salto de línea' });
    const inputArchivo = h('input', { type: 'file', class: 'solo-lectores', tabindex: '-1', 'aria-hidden': 'true' });
    const btnAdjuntar = h('button', { type: 'button', class: 'chatia-icono', 'aria-label': 'Adjuntar archivo', title: 'Adjuntar archivo (máx. 5 MB)', texto: '📎' });
    const btnMic = h('button', { type: 'button', class: 'chatia-icono chatia-mic', 'aria-pressed': 'false', 'aria-label': 'Dictar por voz', title: 'Dictar por voz', texto: '🎤' });
    const btnEnviar = h('button', { type: 'submit', class: 'chatia-enviar', texto: 'Enviar' });
    const btnLeer = h('button', { type: 'button', class: 'chatia-voz-btn', 'aria-pressed': 'false', title: 'Leer las respuestas en voz alta', texto: '🔊 Leer respuestas' });
    const btnConversar = h('button', { type: 'button', class: 'chatia-voz-btn', 'aria-pressed': 'false', title: 'Hablar con el asistente sin teclado: escucha, responde en voz alta y vuelve a escuchar', texto: '🗣 Conversación por voz' });
    const barraVoz = h('div', { class: 'chatia-voz', role: 'group', 'aria-label': 'Voz del asistente' }, btnLeer, btnConversar);
    // Archivo preparado para enviarse JUNTO con el mensaje
    const adjuntoNombre = h('span', { class: 'chatia-adjunto-nombre' });
    const btnQuitarAdjunto = h('button', { type: 'button', class: 'chatia-adjunto-quitar', 'aria-label': 'Quitar el archivo adjunto', title: 'Quitar el archivo', texto: '✕' });
    const adjunto = h('div', { class: 'chatia-adjunto', hidden: true, role: 'status' }, h('span', { 'aria-hidden': 'true', texto: '📎' }), adjuntoNombre, btnQuitarAdjunto);
    const form = h('form', { class: 'chatia-form', autocomplete: 'off' },
        h('label', { for: `${id}-texto`, class: 'solo-lectores', texto: 'Mensaje para el asistente' }),
        btnAdjuntar, inputArchivo, entrada, btnMic, btnEnviar);
    const estadoVoz = h('p', { class: 'chatia-estado', role: 'status', 'aria-live': 'polite' });
    const privacidad = h('p', { class: 'chatia-privacidad', hidden: true, texto: 'Dictado: en Chrome y Edge el audio lo procesa el servicio de reconocimiento del navegador (puede enviarse a sus servidores). LearnTrack no graba ni guarda audio: solo recibe el texto que tú revisas y envías.' });
    const ayudaArchivos = h('p', { class: 'chatia-ayuda' });
    const chips = h('div', { class: 'chatia-chips', role: 'group', 'aria-label': 'Sugerencias' },
        sugerencias.map((s) => h('button', { type: 'button', class: 'chatia-chip', texto: s.etiqueta, on: { click: () => { entrada.value = s.texto; entrada.focus(); entrada.setSelectionRange(entrada.value.length, entrada.value.length); } } })));
    const marco = h('div', { class: 'chatia' }, log, escribiendo, chips, adjunto, form, barraVoz, estadoVoz, privacidad, ayudaArchivos);
    raiz.replaceChildren(marco);

    const desplazar = () => { log.scrollTop = log.scrollHeight; };
    function burbuja(texto, quien = 'ia') {
        const b = h('div', { class: `msg ${quien}` }, h('span', { class: 'solo-lectores', texto: quien === 'usuario' ? 'Tú: ' : quien === 'error' ? 'Error: ' : 'Asistente: ' }), h('span', { texto }));
        log.append(b); desplazar();
        return b;
    }
    const listaTextos = (clase, titulo, textos) => (textos?.length
        ? h('div', { class: clase }, h('strong', { texto: titulo }), h('ul', {}, textos.map((t) => h('li', { texto: t }))))
        : null);
    function tiraCargas(cargas) {
        if (!cargas?.length) return null;
        return h('div', { class: 'chatia-cargas' },
            h('strong', { texto: 'Carga por día (antes → después)' }),
            h('ul', {}, cargas.slice(0, 14).map((c) => h('li', {},
                h('span', { class: 'cg-dia', texto: c.etiqueta }),
                h('span', { class: `pill nivel-${c.nivelAntes}`, texto: `${c.antes} %`, title: `Antes: ${c.antes} % (${c.nivelAntes})` }),
                h('span', { 'aria-hidden': 'true', texto: '→' }),
                h('span', { class: `pill nivel-${c.nivelDespues}`, texto: `${c.despues} %`, title: `Después: ${c.despues} % (${c.nivelDespues})` })))));
    }
    const recordar = (rol, texto) => { estado.historial.push({ rol, texto: String(texto).slice(0, 300) }); estado.historial = estado.historial.slice(-MAX_TURNOS); };
    const ocupado = (si) => { estado.enviando = si; escribiendo.hidden = !si; btnEnviar.disabled = si; btnAdjuntar.disabled = si; marco.classList.toggle('ocupado', si); if (si) desplazar(); };

    // ---------------------------------------------------------------- respuestas
    function botonDeshacer(loteId, contenedor) {
        return h('button', {
            type: 'button', class: 'chatia-btn', texto: '↩ Deshacer', on: {
                click: async (e) => {
                    const b = e.currentTarget; b.disabled = true;
                    const r = await api(`/api/operaciones/${encodeURIComponent(loteId)}/deshacer`, {}).catch(() => null);
                    if (r?.ok) { b.replaceWith(h('span', { class: 'chatia-hecho', texto: '↩ Deshecho' })); alActualizar(r.data.actividades); recordar('asistente', r.data.mensaje); }
                    else { b.disabled = false; contenedor.append(h('p', { class: 'chatia-error-linea', texto: r?.data?.error || 'No se pudo deshacer.' })); }
                }
            }
        });
    }

    function pintar(data) {
        recordar('asistente', data.mensaje ?? '');
        if (Array.isArray(data.actividades)) alActualizar(data.actividades);
        if (data.tipo === 'propuesta') return pintarPropuesta(data);
        if (data.tipo === 'aclaracion') return pintarAclaracion(data);
        const b = burbuja(data.mensaje || 'Hecho.', 'ia');
        const extra = [listaTextos('chatia-supuestos', 'Supuse:', data.supuestos), listaTextos('chatia-avisos', 'Ojo:', data.avisos), tiraCargas(data.cargas)].filter(Boolean);
        b.append(...extra);
        if (data.tipo === 'aplicado' && data.loteId && !data.propuestaId) b.append(h('div', { class: 'chatia-acciones' }, botonDeshacer(data.loteId, b)));
        if (data.tipo === 'cancelada' && data.propuestaId === estado.propuestaPendiente) estado.propuestaPendiente = null;
        if (data.tipo === 'aplicado' && data.propuestaId) {
            const tarjeta = log.querySelector(`[data-propuesta="${CSS.escape(data.propuestaId)}"]`);
            if (tarjeta) marcarTarjeta(tarjeta, 'aplicada', data.loteId);
            if (estado.propuestaPendiente === data.propuestaId) estado.propuestaPendiente = null;
        }
        // Un archivo puede devolver «añadí X» y, además, una propuesta con lo dudoso u opcional
        if (data.siguiente) pintar(data.siguiente);
        desplazar();
    }

    function marcarTarjeta(tarjeta, como, loteId = null) {
        const acciones = tarjeta.querySelector('.chatia-acciones');
        tarjeta.classList.add(`estado-${como}`);
        tarjeta.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.disabled = true; });
        const nuevas = h('div', { class: 'chatia-acciones' },
            h('span', { class: 'chatia-hecho', texto: como === 'aplicada' ? '✓ Aplicada' : como === 'cancelada' ? 'Cancelada: no cambié nada' : 'Caducó (10 min): pídemelo de nuevo' }),
            como === 'aplicada' && loteId ? botonDeshacer(loteId, tarjeta) : null);
        acciones?.replaceWith(nuevas);
    }

    function pintarPropuesta({ propuesta: p, mensaje }) {
        estado.propuestaPendiente = p.id;
        const items = h('ul', { class: 'chatia-items' }, p.items.map((it) => {
            const casilla = p.seleccionable ? h('input', { type: 'checkbox', id: `${id}-${p.id}-${it.idx}`, 'data-idx': String(it.idx) }) : null;
            if (casilla) casilla.checked = it.marcado !== false;
            const etiqueta = h(casilla ? 'label' : 'span', casilla ? { for: casilla.id, class: 'cuerpo' } : { class: 'cuerpo' },
                h('span', { class: `op op-${it.op}`, 'aria-hidden': 'true', texto: ICONO_OP[it.op] ?? '•' }),
                h('span', { class: 'solo-lectores', texto: `${NOMBRE_OP[it.op] ?? ''}: ` }),
                h('strong', { texto: it.titulo }),
                it.detalle ? h('span', { class: 'detalle', texto: ` · ${it.detalle}` }) : null,
                it.motivo ? h('small', { class: 'motivo', texto: it.motivo }) : null,
                it.aviso ? h('small', { class: 'aviso-item', texto: `⚠ ${it.aviso}` }) : null);
            return h('li', { class: `item op-${it.op}` }, casilla, etiqueta);
        }));
        const explicaciones = (p.explicaciones ?? []).filter((t) => !p.items.some((it) => it.motivo === t));
        const error = h('p', { class: 'chatia-error-linea', role: 'alert' });
        const btnAplicar = h('button', { type: 'button', class: 'chatia-btn primario', texto: p.seleccionable ? 'Añadir seleccionadas' : 'Aplicar' });
        const btnCancelar = h('button', { type: 'button', class: 'chatia-btn', texto: 'Cancelar' });
        const tarjeta = h('article', { class: 'chatia-tarjeta', 'data-propuesta': p.id, 'aria-label': `Propuesta: ${p.titulo}` },
            h('header', {}, h('strong', { texto: p.titulo }), h('span', { class: 'caduca', texto: 'Caduca en 10 min' })),
            h('p', { class: 'resumen', texto: mensaje }),
            explicaciones.length ? h('ul', { class: 'chatia-explicaciones' }, explicaciones.slice(0, 8).map((t) => h('li', { texto: t }))) : null,
            items,
            tiraCargas(p.cargas),
            listaTextos('chatia-supuestos', 'Supuse:', p.supuestos),
            listaTextos('chatia-avisos', 'Ojo:', p.avisos),
            error,
            h('div', { class: 'chatia-acciones' }, btnAplicar, btnCancelar));
        btnAplicar.addEventListener('click', async () => {
            error.textContent = '';
            const cuerpo = p.seleccionable
                ? { seleccion: [...tarjeta.querySelectorAll('input[type="checkbox"]:checked')].map((c) => Number(c.dataset.idx)) }
                : {};
            if (p.seleccionable && cuerpo.seleccion.length === 0) { error.textContent = 'Marca al menos un elemento.'; return; }
            btnAplicar.disabled = true; btnCancelar.disabled = true;
            const r = await api(`/api/propuestas/${encodeURIComponent(p.id)}/aplicar`, cuerpo).catch(() => null);
            if (r?.ok) {
                marcarTarjeta(tarjeta, 'aplicada', r.data.loteId);
                if (estado.propuestaPendiente === p.id) estado.propuestaPendiente = null;
                alActualizar(r.data.actividades);
                recordar('asistente', r.data.mensaje);
                if (r.data.avisos?.length) tarjeta.append(listaTextos('chatia-avisos', 'Ojo:', r.data.avisos));
            } else {
                error.textContent = r?.data?.error || 'No se pudo aplicar. Inténtalo de nuevo.';
                btnAplicar.disabled = false; btnCancelar.disabled = false;
                if (r?.status === 410) marcarTarjeta(tarjeta, 'caducada');
            }
        });
        btnCancelar.addEventListener('click', async () => {
            btnAplicar.disabled = true; btnCancelar.disabled = true;
            await api(`/api/propuestas/${encodeURIComponent(p.id)}/cancelar`, {}).catch(() => null);
            marcarTarjeta(tarjeta, 'cancelada');
            if (estado.propuestaPendiente === p.id) estado.propuestaPendiente = null;
        });
        const restante = new Date(p.expira).getTime() - Date.now();
        if (restante > 0) setTimeout(() => { if (!tarjeta.classList.contains('estado-aplicada') && !tarjeta.classList.contains('estado-cancelada')) marcarTarjeta(tarjeta, 'caducada'); if (estado.propuestaPendiente === p.id) estado.propuestaPendiente = null; }, restante);
        log.append(tarjeta); desplazar();
    }

    function pintarAclaracion({ aclaracion: a }) {
        estado.aclaracion = { id: a.id, respuestas: {}, preguntas: a.preguntas };
        const caja = h('div', { class: 'msg ia chatia-aclaracion', 'data-aclaracion': a.id });
        const enviarRespuestas = (decideTu = false) => {
            const { respuestas } = estado.aclaracion;
            const etiquetas = a.preguntas.map((q) => q.opciones.find((o) => o.valor === respuestas[q.id])?.etiqueta).filter(Boolean);
            caja.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            enviar({ texto: '', mostrar: decideTu ? (etiquetas.length ? `${etiquetas.join(' · ')} (y decide tú lo demás)` : 'Decide tú') : etiquetas.join(' · '), aclaracion: { id: a.id, respuestas } });
        };
        for (const q of a.preguntas) {
            const grupo = h('div', { class: 'opciones', role: 'group', 'aria-label': q.texto });
            for (const o of q.opciones) {
                grupo.append(h('button', {
                    type: 'button', class: 'chatia-opcion', 'aria-pressed': 'false', texto: o.etiqueta, on: {
                        click: (e) => {
                            estado.aclaracion.respuestas[q.id] = o.valor;
                            grupo.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'));
                            if (a.preguntas.every((x) => estado.aclaracion.respuestas[x.id])) enviarRespuestas(false);
                        }
                    }
                }));
            }
            caja.append(h('p', { class: 'pregunta', texto: q.texto }), grupo);
        }
        caja.append(h('div', { class: 'chatia-acciones' },
            h('button', { type: 'button', class: 'chatia-btn', texto: 'Decide tú', title: 'Usaré valores razonables y te diré cuáles supuse', on: { click: () => enviarRespuestas(true) } }),
            h('small', { class: 'nota', texto: 'También puedes responder escribiendo.' })));
        log.append(caja); desplazar();
    }

    // ---------------------------------------------------------------- respuestas en voz alta
    /** Lo que se dice en voz alta para cada tipo de respuesta del servidor */
    function textoHablado(data) {
        if (data.tipo === 'propuesta') return `${data.mensaje ?? ''} También puedes decir «sí» para aplicar o «no» para cancelar.`;
        if (data.tipo === 'aclaracion') {
            const p = data.aclaracion?.preguntas?.[0];
            return p ? `${p.texto} Opciones: ${(p.opciones ?? []).map((o) => o.etiqueta).join(', ')}.` : (data.mensaje ?? '');
        }
        return [data.mensaje, ...(data.avisos ?? [])].filter(Boolean).join('. ');
    }
    /** Lee la respuesta si está activado y, en modo conversación, vuelve a escuchar al terminar */
    async function responderEnVoz(texto) {
        if (!estado.leer && !estado.conversacion) return;
        await hablar(texto);
        if (estado.conversacion && !estado.enviando && !escuchando) iniciarDictado({ automatico: true });
    }

    // ---------------------------------------------------------------- envío
    async function enviar({ texto, mostrar = texto, aclaracion = null }) {
        if (estado.enviando) return;
        if (mostrar) { burbuja(mostrar, 'usuario'); recordar('usuario', mostrar); }
        ocupado(true);
        const cuerpo = {
            texto, fechaHoy: hoyISO(), tzOffset: tzOffset(), horaLocal: horaLocal(),
            historial: estado.historial.slice(0, -1).slice(-MAX_TURNOS),
            propuestaPendiente: estado.propuestaPendiente || undefined
        };
        const acl = aclaracion ?? (estado.aclaracion ? { id: estado.aclaracion.id, respuestas: {} } : null);
        if (acl) { cuerpo.aclaracionId = acl.id; cuerpo.respuestas = acl.respuestas; }
        estado.aclaracion = null;
        let hablado = '';
        try {
            const r = await api('/api/ia/chat', cuerpo);
            if (!r.ok) { const error = r.data.error || 'No pude procesar eso. Intenta ser más específico.'; burbuja(error, 'error'); hablado = error; }
            else { pintar(r.data); hablado = textoHablado(r.data); }
        } catch {
            burbuja('No pude conectar con el servidor.', 'error');
            hablado = 'No pude conectar con el servidor.';
        } finally {
            ocupado(false);
            entrada.focus();
        }
        responderEnVoz(hablado);
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const texto = entrada.value.trim();
        if (estado.enviando) return;
        if (estado.adjunto) {                       // archivo + mensaje en el mismo envío
            if (escuchando) reconocedor?.stop();
            entrada.value = '';
            enviarArchivo(estado.adjunto, texto);
            return;
        }
        if (!texto) return;
        if (escuchando) reconocedor?.stop();
        entrada.value = '';
        enviar({ texto });
    });
    entrada.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });

    // ---------------------------------------------------------------- voz (Web Speech API)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let reconocedor = null, escuchando = false, idioma = 'es-CO', base = '', huboError = false;
    const ponerEstadoMic = (activo) => {
        escuchando = activo;
        btnMic.setAttribute('aria-pressed', activo ? 'true' : 'false');
        btnMic.setAttribute('aria-label', activo ? 'Detener dictado' : 'Dictar por voz');
        btnMic.classList.toggle('escuchando', activo);
    };
    const ERRORES_VOZ = {
        'not-allowed': 'Sin permiso para usar el micrófono. Actívalo en la configuración del sitio (icono del candado).',
        'service-not-allowed': 'El navegador no permite el dictado en esta página.',
        'no-speech': 'No te escuché. Pulsa 🎤 e inténtalo de nuevo.',
        'audio-capture': 'No encontré ningún micrófono.',
        network: 'El servicio de dictado del navegador no respondió (error de red).'
    };
    if (!SR) {
        btnMic.disabled = true;
        btnMic.setAttribute('aria-label', 'Dictado por voz no disponible en este navegador');
        btnMic.title = 'Tu navegador no admite dictado por voz (prueba Chrome o Edge).';
        estadoVoz.textContent = '🎤 El dictado por voz no está disponible en este navegador.';
    } else if (!window.isSecureContext) {
        btnMic.disabled = true;
        btnMic.title = 'El dictado requiere HTTPS o localhost.';
        estadoVoz.textContent = '🎤 El dictado requiere HTTPS o localhost.';
    }
    function iniciarDictado({ automatico = false } = {}) {
        if (!SR || btnMic.disabled) return;
        callar();                                       // si el asistente está hablando, se calla para escucharte
        reconocedor = new SR();
        reconocedor.lang = idioma;
        reconocedor.interimResults = true;
        reconocedor.continuous = false;
        reconocedor.maxAlternatives = 1;
        base = entrada.value.trim() ? `${entrada.value.trimEnd()} ` : '';
        huboError = false;
        reconocedor.onstart = () => {
            ponerEstadoMic(true); privacidad.hidden = false;
            estadoVoz.textContent = automatico ? '🔴 Te escucho… (modo conversación)' : '🔴 Escuchando… habla ahora (pulsa 🎤 otra vez para parar).';
        };
        // v3.6: el dictado escribe en el cuadro de texto (resultados parciales incluidos) con .value, nunca con
        // innerHTML. La versión 3.4.2 usaba variables inexistentes (btnMicrofono, divRespuesta) y rompía el dictado.
        reconocedor.onresult = (event) => {
            const texto = Array.from(event.results).map((r) => r[0].transcript).join('');
            entrada.value = (base + separarConectores(texto)).slice(0, 500);
        };
        reconocedor.onerror = (e) => {
            if (e.error === 'language-not-supported' && idioma === 'es-CO') { idioma = 'es-ES'; huboError = 'reintentar'; return; }
            if (e.error === 'aborted') return;
            if (e.error === 'no-speech' && estado.conversacion) { huboError = 'silencio'; return; }
            huboError = true;
            if (estado.conversacion) modoConversacion(false);
            estadoVoz.textContent = `⚠ ${ERRORES_VOZ[e.error] ?? 'No se pudo usar el dictado.'}`;
        };
        reconocedor.onend = () => {
            ponerEstadoMic(false);
            if (huboError === 'reintentar') { iniciarDictado({ automatico }); return; }
            if (estado.conversacion) {
                // Modo conversación: lo dictado se envía solo; dos silencios seguidos apagan el modo
                const texto = entrada.value.trim();
                if (texto) { estado.silencios = 0; entrada.value = ''; estadoVoz.textContent = ''; enviar({ texto }); return; }
                if (++estado.silencios >= 2) { modoConversacion(false); estadoVoz.textContent = 'No te escuché: apagué el modo conversación.'; return; }
                iniciarDictado({ automatico: true });
                return;
            }
            if (!huboError) estadoVoz.textContent = entrada.value.trim() ? '✓ Dictado listo: revisa el texto y pulsa Enviar.' : '';
            entrada.focus();
        };
        try { reconocedor.start(); } catch { estadoVoz.textContent = '⚠ No se pudo iniciar el dictado.'; ponerEstadoMic(false); }
    }
    btnMic.addEventListener('click', () => {
        if (!SR || btnMic.disabled) return;
        if (escuchando) { reconocedor?.stop(); return; }
        iniciarDictado();
    });
    entrada.addEventListener('input', () => callar());       // si escribes, el asistente deja de hablar

    // ---- interruptores de voz (se recuerdan en este navegador) ----
    const CLAVE_LEER = 'learntrack_leer_respuestas';
    const pulsado = (boton, si) => { boton.setAttribute('aria-pressed', String(si)); boton.classList.toggle('activo', si); };
    function modoLectura(si) {
        estado.leer = si; pulsado(btnLeer, si);
        try { localStorage.setItem(CLAVE_LEER, si ? '1' : '0'); } catch { /* sin almacenamiento */ }
        if (!si && !estado.conversacion) callar();
    }
    function modoConversacion(si) {
        estado.conversacion = si; estado.silencios = 0; pulsado(btnConversar, si);
        if (si) { iniciarDictado({ automatico: true }); return; }
        callar();
        if (escuchando) reconocedor?.abort();
        estadoVoz.textContent = '';
    }
    if (!sintesisDisponible()) {
        btnLeer.disabled = true; btnLeer.title = 'Tu navegador no puede leer en voz alta.';
    } else {
        try { if (localStorage.getItem(CLAVE_LEER) === '1') modoLectura(true); } catch { /* sin almacenamiento */ }
        cargarVozPreferida();
    }
    if (!SR || btnMic.disabled || !sintesisDisponible()) {
        btnConversar.disabled = true;
        btnConversar.title = 'La conversación por voz necesita dictado y lectura en voz alta (Chrome o Edge, en HTTPS o localhost).';
    }
    btnLeer.addEventListener('click', () => modoLectura(!estado.leer));
    btnConversar.addEventListener('click', () => modoConversacion(!estado.conversacion));

    // ---------------------------------------------------------------- archivos
    const extension = (n) => { const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i).toLowerCase() : ''; };
    function textoAyuda() {
        ayudaArchivos.textContent = `📎 Puedes adjuntar o arrastrar aquí: ${estado.formatos.join(' ')} (máx. 5 MB, 1 archivo).${estado.imagenes ? '' : ' Imágenes: no disponibles (el servidor no tiene modelo de visión).'}`;
        inputArchivo.accept = estado.formatos.join(',');
    }
    textoAyuda();
    api('/api/ia/capacidades').then((r) => {
        if (!r.ok) return;
        if (!r.data.archivos) { btnAdjuntar.disabled = true; ayudaArchivos.textContent = '📎 La carga de archivos no está disponible en este servidor.'; return; }
        estado.formatos = r.data.formatos; estado.imagenes = r.data.imagenes;
        textoAyuda();
    }).catch(() => {});

    /** Prepara el archivo (no lo envía): se manda con el siguiente «Enviar», junto con lo que escribas */
    function prepararAdjunto(archivo) {
        if (!archivo || estado.enviando) return;
        const ext = extension(archivo.name);
        if (!estado.formatos.includes(ext)) { burbuja(`No puedo leer «${archivo.name}». Formatos admitidos: ${estado.formatos.join(' ')}.`, 'error'); return; }
        if (archivo.size > MAX_BYTES) { burbuja(`«${archivo.name}» pesa ${(archivo.size / 1048576).toFixed(1)} MB; el máximo es 5 MB.`, 'error'); return; }
        estado.adjunto = archivo;
        adjuntoNombre.textContent = `${archivo.name} (${Math.max(1, Math.round(archivo.size / 1024))} KB) · escribe un mensaje si quieres y pulsa Enviar`;
        adjunto.hidden = false;
        entrada.placeholder = 'Explica el archivo (opcional): «son de la materia Redes», «solo los exámenes»…';
        entrada.focus();
    }
    function quitarAdjunto() {
        estado.adjunto = null;
        adjunto.hidden = true;
        inputArchivo.value = '';
        entrada.placeholder = placeholderBase;
    }
    btnQuitarAdjunto.addEventListener('click', () => { quitarAdjunto(); entrada.focus(); });

    /** Envía archivo + mensaje (multipart): el servidor une el texto del archivo y tu mensaje para la IA */
    async function enviarArchivo(archivo, mensaje = '') {
        if (!archivo || estado.enviando) return;
        const fd = new FormData();
        fd.append('fechaHoy', hoyISO());
        fd.append('tzOffset', String(tzOffset()));
        fd.append('horaLocal', horaLocal());
        const instruccion = mensaje.slice(0, 500);
        if (instruccion) fd.append('instruccion', instruccion);
        fd.append('archivo', archivo, archivo.name);
        quitarAdjunto();
        const caja = burbuja(instruccion || 'Revisa este archivo y añade lo que encuentres.', 'usuario');
        caja.prepend(h('span', { class: 'chatia-adjunto-burbuja', texto: `📎 ${archivo.name} (${Math.max(1, Math.round(archivo.size / 1024))} KB)` }));
        recordar('usuario', `📎 ${archivo.name}${instruccion ? ` — ${instruccion}` : ''}`);
        ocupado(true);
        escribiendo.querySelector('.texto').textContent = 'Leyendo el archivo…';
        let hablado = '';
        try {
            const r = await api('/api/ia/archivo', fd);
            if (!r.ok) { hablado = r.data.error || 'No pude procesar el archivo.'; burbuja(hablado, 'error'); }
            else { pintar(r.data); hablado = textoHablado(r.data); }
        } catch { hablado = 'No pude subir el archivo.'; burbuja(hablado, 'error'); }
        finally { ocupado(false); escribiendo.querySelector('.texto').textContent = 'El asistente está pensando…'; }
        responderEnVoz(hablado);
    }
    btnAdjuntar.addEventListener('click', () => inputArchivo.click());
    inputArchivo.addEventListener('change', () => prepararAdjunto(inputArchivo.files[0]));
    let profundidad = 0;
    marco.addEventListener('dragenter', (e) => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); profundidad++; marco.classList.add('arrastrando'); });
    marco.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    marco.addEventListener('dragleave', () => { profundidad = Math.max(0, profundidad - 1); if (!profundidad) marco.classList.remove('arrastrando'); });
    marco.addEventListener('drop', (e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault(); profundidad = 0; marco.classList.remove('arrastrando');
        if (e.dataTransfer.files.length > 1) { burbuja('Suelta un solo archivo a la vez.', 'error'); return; }
        prepararAdjunto(e.dataTransfer.files[0]);
    });

    // ---- identidad del asistente (nombreIA) ----
    let placeholderBase = entrada.placeholder;
    let saludo = null;
    if (bienvenida) saludo = burbuja(bienvenida, 'ia');
    usuarioActual().then((u) => {
        const nombre = u?.nombreIA || 'Nexo';
        placeholderBase = `Escribe o dicta a ${nombre}…`;
        if (!estado.adjunto) entrada.placeholder = placeholderBase;
        if (!saludo) return;
        const presentacion = nombre === 'Nexo'
            ? '¡Hola! Soy Nexo, tu asistente (puedes cambiarme el nombre en Configuración › Voz de la IA). '
            : `¡Hola! Soy ${nombre}, tu asistente. `;
        saludo.querySelector('span:last-child').prepend(presentacion);
    });
    return { enviar: (texto) => enviar({ texto }), enfocar: () => entrada.focus() };
}

export { aviso };
