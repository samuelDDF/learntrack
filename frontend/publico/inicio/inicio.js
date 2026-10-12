// Página de inicio (módulo ES): botón flotante «Contáctanos» y su formulario.

const form = document.getElementById('contacto-form-mini');
const estado = document.getElementById('form-estado');
const popup = document.getElementById('contacto-popup');
const btnFlotante = document.getElementById('btn-flotante');

// ---------- Abrir y cerrar el formulario flotante ----------
function mostrarPopup(abrir) {
    popup.classList.toggle('activo', abrir);
    btnFlotante.setAttribute('aria-expanded', String(abrir));
    if (abrir) form.elements.nombre.focus();
}
btnFlotante?.addEventListener('click', () => mostrarPopup(!popup.classList.contains('activo')));
document.getElementById('cerrar-popup')?.addEventListener('click', () => { mostrarPopup(false); btnFlotante.focus(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup?.classList.contains('activo')) { mostrarPopup(false); btnFlotante.focus(); }
});

// ---------- Enviar el mensaje (nunca como GET: los datos no deben acabar en la URL) ----------
const decir = (texto, clase = '') => { estado.textContent = texto; estado.className = `form-estado ${clase}`.trim(); };

form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
        decir('Completa todos los campos con un correo válido.', 'error');
        form.reportValidity();
        return;
    }
    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    decir('Enviando...');
    try {
        const res = await fetch('/api/contacto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: form.elements.nombre.value, correo: form.elements.correo.value, mensaje: form.elements.mensaje.value })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { decir(data.error || 'No se pudo enviar el mensaje.', 'error'); return; }
        decir('Mensaje enviado. Te responderemos pronto.', 'ok');
        form.reset();
    } catch {
        decir('No se pudo conectar con el servidor.', 'error');
    } finally {
        boton.disabled = false;
    }
});
