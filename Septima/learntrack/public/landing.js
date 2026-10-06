// Formulario de contacto de la página de inicio
(() => {
    'use strict';

    const form = document.getElementById('form-contacto');
    const estado = document.getElementById('form-estado');
    if (!form || !estado) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!form.checkValidity()) {
            estado.textContent = 'Completa todos los campos con un correo válido.';
            estado.className = 'error';
            form.reportValidity();
            return;
        }

        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        estado.textContent = 'Enviando...';
        estado.className = '';

        try {
            const res = await fetch('/api/contacto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre: form.elements.nombre.value,
                    correo: form.elements.correo.value,
                    mensaje: form.elements.mensaje.value
                })
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                estado.textContent = data.error || 'No se pudo enviar el mensaje.';
                estado.className = 'error';
                return;
            }
            estado.textContent = 'Mensaje enviado. Te responderemos pronto.';
            estado.className = 'ok';
            form.reset();
        } catch {
            estado.textContent = 'No se pudo conectar con el servidor.';
            estado.className = 'error';
        } finally {
            boton.disabled = false;
        }
    });
})();
