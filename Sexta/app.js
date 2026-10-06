import { consultarIA } from './ai-service.js';

const vistaLanding = document.getElementById('vista-landing');
const vistaApp = document.getElementById('vista-app');

const navInicio = document.getElementById('nav-inicio');
const navPlanificador = document.getElementById('nav-planificador');
const navBrand = document.getElementById('nav-brand');
const btnsAbrirApp = document.querySelectorAll('.btn-abrir-app');
const navLinksLanding = document.querySelectorAll('.nav-link-landing');

function mostrarLanding() {
    vistaLanding.classList.remove('oculto');
    vistaApp.classList.add('oculto');
    navInicio.classList.add('active');
    navPlanificador.classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mostrarPlanificador() {
    vistaLanding.classList.add('oculto');
    vistaApp.classList.remove('oculto');
    navPlanificador.classList.add('active');
    navInicio.classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

navInicio.addEventListener('click', (e) => { e.preventDefault(); mostrarLanding(); });
navBrand.addEventListener('click', (e) => { e.preventDefault(); mostrarLanding(); });
navPlanificador.addEventListener('click', (e) => { e.preventDefault(); mostrarPlanificador(); });

btnsAbrirApp.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        mostrarPlanificador();
    });
});

navLinksLanding.forEach(link => {
    link.addEventListener('click', () => {
        if (!vistaApp.classList.contains('oculto')) {
            mostrarLanding();
        }
    });
});

const formContacto = document.getElementById('form-contacto');
const estadoContacto = document.getElementById('form-estado');

if (formContacto) {
    formContacto.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!formContacto.checkValidity()) {
            estadoContacto.textContent = 'Completa todos los campos con un correo válido.';
            estadoContacto.className = 'error';
            formContacto.reportValidity();
            return;
        }
        estadoContacto.textContent = 'Mensaje enviado. Te responderemos pronto.';
        estadoContacto.className = 'ok';
        formContacto.reset();
    });
}

let actividades = JSON.parse(localStorage.getItem('learntrack_actividades')) || [];
let estadoAnimo = localStorage.getItem('learntrack_animo') || 'medio';

function obtenerFechaHoy() {
    const hoy = new Date();
    return hoy.toISOString().split('T')[0];
}

const fechaHoyStr = obtenerFechaHoy();

const formActividad = document.getElementById('form-actividad');
const inputTitulo = document.getElementById('input-titulo');
const selectTipo = document.getElementById('select-tipo');
const selectExigencia = document.getElementById('select-exigencia');
const inputHoras = document.getElementById('input-horas');
const listaActividades = document.getElementById('lista-actividades');
const selectAnimo = document.getElementById('select-animo');

const barraCarga = document.getElementById('barra-progreso-carga');
const porcentajeCarga = document.getElementById('porcentaje-carga');
const estadoMensaje = document.getElementById('estado-mensaje');
const consejoIa = document.getElementById('consejo-ia');
const resumenSemanalElem = document.getElementById('resumen-semanal');

selectAnimo.value = estadoAnimo;

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
        const peso = parseFloat(act.exigencia);
        const horas = parseFloat(act.horas);
        puntosCarga += (peso * horas * 10);
    });

    let porcentaje = Math.round((puntosCarga / capacidadBase) * 100);
    if (porcentaje < 0) porcentaje = 0;

    guardarEnHistorial(fechaHoyStr, porcentaje);

    await actualizarUI(porcentaje, actividadesHoy);
}

function guardarEnHistorial(fecha, porcentaje) {
    let historial = JSON.parse(localStorage.getItem('learntrack_historial')) || {};
    historial[fecha] = porcentaje;
    localStorage.setItem('learntrack_historial', JSON.stringify(historial));
    actualizarVistaHistorial(historial);
}

function actualizarVistaHistorial(historial) {
    if (!resumenSemanalElem) return;
    
    const fechas = Object.keys(historial).slice(-5);
    if (fechas.length === 0) {
        resumenSemanalElem.innerHTML = "<small>Sin registros previos.</small>";
        return;
    }

    let html = '<div class="historial-grid">';
    fechas.forEach(f => {
        const porcentaje = historial[f];
        let color = '#4caf50';
        if (porcentaje > 85) color = '#e53935';
        else if (porcentaje >= 50) color = '#ff9800';

        html += `
            <div class="historial-item">
                <span>${f.slice(5)}</span>
                <strong style="color: ${color}">${porcentaje}%</strong>
            </div>
        `;
    });
    html += '</div>';
    resumenSemanalElem.innerHTML = html;
}

async function actualizarUI(porcentaje, actividadesHoy) {
    porcentajeCarga.textContent = `${porcentaje}%`;
    barraCarga.style.width = `${Math.min(porcentaje, 100)}%`;

    if (porcentaje < 50) {
        barraCarga.style.backgroundColor = '#4caf50';
        estadoMensaje.textContent = '🟢 Estado Equilibrado (Carga Baja)';
    } else if (porcentaje <= 85) {
        barraCarga.style.backgroundColor = '#ff9800';
        estadoMensaje.textContent = '🟡 Carga Moderada';
    } else {
        barraCarga.style.backgroundColor = '#e53935';
        estadoMensaje.textContent = '🔴 ¡Advertencia de Saturación!';
    }

    if (actividadesHoy.length === 0) {
        consejoIa.textContent = "💡 Tu jornada está vacía. Agrega tus compromisos para calcular tu nivel de carga.";
        return;
    }

    consejoIa.textContent = "🤖 Consultando con el asistente...";

    const datosParaIA = {
        estadoAnimo: estadoAnimo,
        porcentajeCarga: porcentaje,
        actividades: actividadesHoy.map(a => `${a.titulo} (${a.horas} hrs)`)
    };

    const respuestaIA = await consultarIA(datosParaIA);

    if (respuestaIA) {
        consejoIa.textContent = respuestaIA;
    } else {
        if (porcentaje < 50) {
            consejoIa.textContent = '💡 Tienes buena energía disponible. Es un gran momento para avanzar en proyectos exigentes.';
        } else if (porcentaje <= 85) {
            consejoIa.textContent = '💡 Tu jornada está en equilibrio. Recuerda programar un tiempo de desconexión antes de terminar el día.';
        } else {
            consejoIa.textContent = '⚠️ Tu nivel de carga es muy alto. Prioriza lo más urgente y dale espacio al descanso o al ocio.';
        }
    }
}

function renderizar() {
    listaActividades.innerHTML = '';
    const actividadesHoy = obtenerActividadesDeHoy();

    if (actividadesHoy.length === 0) {
        listaActividades.innerHTML = '<li class="sin-actividades">No has registrado actividades para el día de hoy.</li>';
    } else {
        actividadesHoy.forEach((act) => {
            const indexReal = actividades.findIndex(a => a.id === act.id);
            const li = document.createElement('li');
            li.className = `actividad-item ${act.tipo}`;
            li.innerHTML = `
                <div>
                    <strong>${act.titulo}</strong> <br>
                    <small>${act.tipo.toUpperCase()} • ${act.horas} hrs</small>
                </div>
                <button class="btn-borrar" onclick="eliminarActividad(${indexReal})">✕</button>
            `;
            listaActividades.appendChild(li);
        });
    }

    calcularCargaMental();
}

formActividad.addEventListener('submit', (e) => {
    e.preventDefault();

    const nuevaActividad = {
        titulo: inputTitulo.value.trim(),
        tipo: selectTipo.value,
        exigencia: selectExigencia.value,
        horas: inputHoras.value,
        fecha: fechaHoyStr,
        id: Date.now()
    };

    actividades.push(nuevaActividad);
    localStorage.setItem('learntrack_actividades', JSON.stringify(actividades));
    
    formActividad.reset();
    renderizar();
});

selectAnimo.addEventListener('change', (e) => {
    estadoAnimo = e.target.value;
    localStorage.setItem('learntrack_animo', estadoAnimo);
    calcularCargaMental();
});

window.eliminarActividad = function(indexReal) {
    actividades.splice(indexReal, 1);
    localStorage.setItem('learntrack_actividades', JSON.stringify(actividades));
    renderizar();
};

document.addEventListener('DOMContentLoaded', () => {
    renderizar();
    const historialGuardado = JSON.parse(localStorage.getItem('learntrack_historial')) || {};
    actualizarVistaHistorial(historialGuardado);
});