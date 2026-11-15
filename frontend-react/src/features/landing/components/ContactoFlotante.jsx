// Botón flotante «Contáctanos» con su formulario (POST /api/contacto; nunca GET: los datos no deben ir en la URL).
// En la 3.4.2 solo funcionaba en la página de inicio; aquí está en todas las páginas públicas.
import { useEffect, useRef, useState } from 'react';
import { contacto } from '../services/contacto.service.js';
import { mensajeDeError } from '../../../services/errores.js';

export function ContactoFlotante() {
    const [abierto, setAbierto] = useState(false);
    const [estado, setEstado] = useState({ texto: '', clase: '' });
    const [enviando, setEnviando] = useState(false);
    const form = useRef(null);
    const boton = useRef(null);

    useEffect(() => {
        if (abierto) form.current?.elements.nombre.focus();
        if (!abierto) return undefined;
        const alTeclear = (e) => { if (e.key === 'Escape') { setAbierto(false); boton.current?.focus(); } };
        document.addEventListener('keydown', alTeclear);
        return () => document.removeEventListener('keydown', alTeclear);
    }, [abierto]);

    async function enviar(e) {
        e.preventDefault();
        const f = form.current;
        if (!f.checkValidity()) { setEstado({ texto: 'Completa todos los campos con un correo válido.', clase: 'error' }); f.reportValidity?.(); return; }
        setEnviando(true);
        setEstado({ texto: 'Enviando...', clase: '' });
        try {
            const r = await contacto.enviar({ nombre: f.elements.nombre.value, correo: f.elements.correo.value, mensaje: f.elements.mensaje.value });
            if (!r.ok) { setEstado({ texto: mensajeDeError(r, 'No se pudo enviar el mensaje.'), clase: 'error' }); return; }
            setEstado({ texto: 'Mensaje enviado. Te responderemos pronto.', clase: 'ok' });
            f.reset();
        } catch (err) {
            setEstado({ texto: mensajeDeError(err), clase: 'error' });
        } finally { setEnviando(false); }
    }

    return (
        <div className="contacto-flotante-container">
            <div className={`contacto-popup${abierto ? ' activo' : ''}`} id="contacto-popup" role="dialog" aria-labelledby="contacto-popup-titulo" aria-hidden={!abierto}>
                <div className="contacto-popup-header">
                    <h3 id="contacto-popup-titulo">Contáctanos</h3>
                    <button type="button" className="cerrar-popup" aria-label="Cerrar" onClick={() => { setAbierto(false); boton.current?.focus(); }}>&times;</button>
                </div>
                <form ref={form} className="contacto-form-mini" id="contacto-form-mini" noValidate onSubmit={enviar}>
                    <label htmlFor="nombre-mini">Nombre</label>
                    <input type="text" id="nombre-mini" name="nombre" placeholder="Tu nombre" maxLength={80} autoComplete="name" required tabIndex={abierto ? 0 : -1} />
                    <label htmlFor="correo-mini">Correo electrónico</label>
                    <input type="email" id="correo-mini" name="correo" placeholder="tu@correo.com" maxLength={254} autoComplete="email" required tabIndex={abierto ? 0 : -1} />
                    <label htmlFor="mensaje-mini">Mensaje</label>
                    <textarea id="mensaje-mini" name="mensaje" rows={3} placeholder="¿En qué te podemos ayudar?" minLength={5} maxLength={1000} required tabIndex={abierto ? 0 : -1} />
                    <button type="submit" className="btn" disabled={enviando} aria-busy={enviando} tabIndex={abierto ? 0 : -1}>Enviar mensaje</button>
                    <p className={`form-estado${estado.clase ? ` ${estado.clase}` : ''}`} id="form-estado" role="status" aria-live="polite">{estado.texto}</p>
                </form>
            </div>
            <button ref={boton} type="button" className="btn-flotante" id="btn-flotante" aria-label={abierto ? 'Cerrar contacto' : 'Abrir contacto'}
                aria-expanded={abierto} aria-controls="contacto-popup" onClick={() => setAbierto((v) => !v)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <circle cx="12" cy="5" r="2" />
                    <path d="M12 7v4" />
                    <line x1="8" y1="16" x2="8.01" y2="16" />
                    <line x1="16" y1="16" x2="16.01" y2="16" />
                </svg>
            </button>
        </div>
    );
}
