// ====== NAVEGACIÓN SINGLE PAGE APPLICATION (SPA) ======
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

// Listeners de Navegación
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

// ====== FORMULARIO DE CONTACTO (LANDING) ======
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

// ====== LÓGICA DEL PLANIFICADOR INTELIGENTE ======
let actividades = JSON.parse(localStorage.getItem('learntrack_actividades')) || [];
let estadoAnimo = localStorage.getItem('learntrack_animo') || 'medio';

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

selectAnimo.value = estadoAnimo;

function calcularCargaMental() {
    let puntosCarga = 0;
    let capacidadBase = 100;

    if (estadoAnimo === 'bajo') capacidadBase = 70;
    if (estadoAnimo === 'alto') capacidadBase = 120;

    actividades.forEach(act => {
        const peso = parseFloat(act.exigencia);
        const horas = parseFloat(act.horas);
        puntosCarga += (peso * horas * 10);
    });

    let porcentaje = Math.round((puntosCarga / capacidadBase) * 100);
    if (porcentaje < 0) porcentaje = 0;

    actualizarUI(porcentaje);
}

function actualizarUI(porcentaje) {
    porcentajeCarga.textContent = `${porcentaje}%`;
    barraCarga.style.width = `${Math.min(porcentaje, 100)}%`;

    if (porcentaje < 50) {
        barraCarga.style.backgroundColor = '#4caf50';
        estadoMensaje.textContent = '🟢 Estado Equilibrado (Carga Baja)';
        consejoIa.textContent = '💡 Tienes buena energía disponible. Es un buen momento para avanzar en tus proyectos más complejos o estudiar temas difíciles.';
    } else if (porcentaje <= 85) {
        barraCarga.style.backgroundColor = '#ff9800';
        estadoMensaje.textContent = '🟡 Carga Moderada';
        consejoIa.textContent = '💡 Tu día está equilibrado. Recuerda programar una pausa o tiempo de ocio antes de la noche.';
    } else {
        barraCarga.style.backgroundColor = '#e53935';
        estadoMensaje.textContent = '🔴 ¡Advertencia de Saturación!';
        consejoIa.textContent = '⚠️ Tu nivel de carga es muy alto. Te recomendamos priorizar lo urgente y agendar actividades de recarga (deporte, juegos o descanso).';
    }
}

function renderizar() {
    listaActividades.innerHTML = '';

    actividades.forEach((act, index) => {
        const li = document.createElement('li');
        li.className = `actividad-item ${act.tipo}`;
        li.innerHTML = `
            <div>
                <strong>${act.titulo}</strong> <br>
                <small>${act.tipo.toUpperCase()} • ${act.horas} hrs</small>
            </div>
            <button class="btn-borrar" onclick="eliminarActividad(${index})">✕</button>
        `;
        listaActividades.appendChild(li);
    });

    calcularCargaMental();
}

formActividad.addEventListener('submit', (e) => {
    e.preventDefault();

    const nuevaActividad = {
        titulo: inputTitulo.value.trim(),
        tipo: selectTipo.value,
        exigencia: selectExigencia.value,
        horas: inputHoras.value,
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

window.eliminarActividad = function(index) {
    actividades.splice(index, 1);
    localStorage.setItem('learntrack_actividades', JSON.stringify(actividades));
    renderizar();
};

// Carga Inicial
document.addEventListener('DOMContentLoaded', renderizar);