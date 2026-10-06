// ====== ESTADO INICIAL (LOCALSTORAGE) ======
let actividades = JSON.parse(localStorage.getItem('learntrack_actividades')) || [];
let estadoAnimo = localStorage.getItem('learntrack_animo') || 'medio';

// ====== REFERENCIAS DOM ======
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

// Seleccionar ánimo guardado
selectAnimo.value = estadoAnimo;

// ====== ALGORITMO DE SATURACIÓN ======
function calcularCargaMental() {
    let puntosCarga = 0;
    
    // Factor por estado de ánimo
    let capacidadBase = 100;
    if (estadoAnimo === 'bajo') capacidadBase = 70;
    if (estadoAnimo === 'alto') capacidadBase = 120;

    actividades.forEach(act => {
        const peso = parseFloat(act.exigencia);
        const horas = parseFloat(act.horas);
        puntosCarga += (peso * horas * 10);
    });

    // Calcular porcentaje de uso
    let porcentaje = Math.round((puntosCarga / capacidadBase) * 100);
    if (porcentaje < 0) porcentaje = 0;

    actualizarUI(porcentaje);
}

function actualizarUI(porcentaje) {
    porcentajeCarga.textContent = `${porcentaje}%`;
    barraCarga.style.width = `${Math.min(porcentaje, 100)}%`;

    if (porcentaje < 50) {
        barraCarga.style.backgroundColor = '#4caf50'; // Verde
        estadoMensaje.textContent = '🟢 Estado Equilibrado (Carga Baja)';
        consejoIa.textContent = '💡 Tienes buena energía disponible. Es un buen momento para avanzar en tus proyectos más complejos o estudiar temas difíciles.';
    } else if (porcentaje <= 85) {
        barraCarga.style.backgroundColor = '#ff9800'; // Naranja
        estadoMensaje.textContent = '🟡 Carga Moderada';
        consejoIa.textContent = '💡 Tu día está equilibrado, pero evita saturarte. Recuerda programar una pausa o tiempo de ocio antes de la noche.';
    } else {
        barraCarga.style.backgroundColor = '#e53935'; // Rojo
        estadoMensaje.textContent = '🔴 ¡Advertencia de Saturación!';
        consejoIa.textContent = '⚠️ Tu nivel de carga es muy alto. Te recomendamos priorizar solo lo urgente y agendar actividades de recarga (deporte, juegos o descanso).';
    }
}

// ====== RENDERIZAR LISTA ======
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

// ====== EVENTOS ======
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

// Carga inicial
document.addEventListener('DOMContentLoaded', renderizar);