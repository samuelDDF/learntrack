// Check-in diario: tres preguntas (ánimo, sueño y enfoque) que ajustan el «tanque de energía» del día.
// Se guarda en el servidor (POST /api/bienestar/checkin); la validación de React es solo una ayuda: el servidor
// vuelve a validar los valores.
import { useState } from 'react';
import { Dialogo } from '../../../components/common/Dialogo.jsx';
import { mensajeDeError } from '../../../services/errores.js';
import { bienestar } from '../services/bienestar.service.js';
import '../bienestar.css';

/** Texto de cada respuesta (el mismo de las opciones del formulario) */
export const TEXTO_CHECKIN = {
    animo: { alto: 'Con mucha motivación y energía', medio: 'Normal / Tranquilo', bajo: 'Cansado / Saturado / Estresado' },
    sueno: { bien: 'Bien, descansé lo suficiente', regular: 'Regular, me costó dormir o me desperté', mal: 'Mal, dormí muy pocas horas' },
    enfoque: { avanzar: 'Avanzar fuerte en tareas pesadas', mantener: 'Cumplir la rutina sin forzarme de más', descansar: 'Tomarlo con calma y priorizar el descanso' }
};

function FormularioCheckin({ inicial, fecha, alGuardado }) {
    const [v, setV] = useState({ animo: inicial?.animo ?? '', sueno: inicial?.sueno ?? '', enfoque: inicial?.enfoque ?? '' });
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
    async function guardar(e) {
        e.preventDefault();
        if (!e.currentTarget.checkValidity()) { setError('Responde las tres preguntas.'); return; }
        setGuardando(true); setError('');
        try {
            const r = await bienestar.guardarCheckin({ fecha, ...v });
            if (!r.ok) { setError(mensajeDeError(r, 'No se pudo guardar el check-in.')); return; }
            alGuardado(r.data.checkin);
        } catch (err) { setError(mensajeDeError(err, 'Error de conexión con el servidor.')); } finally { setGuardando(false); }
    }
    return (
        <form id="form-encuesta" className="modal-content" onSubmit={guardar}>
            <div className="encuesta-cab">
                <h3 id="titulo-checkin">Check-in Diario</h3>
                <p>Antes de planificar, cuéntanos cómo empiezas tu día.</p>
            </div>
            <div className="form-group">
                <label htmlFor="encuesta-animo">1. ¿Cómo te sientes emocionalmente hoy?</label>
                <select id="encuesta-animo" required value={v.animo} onChange={cambiar('animo')}>
                    <option value="" disabled>Selecciona tu estado...</option>
                    {Object.entries(TEXTO_CHECKIN.animo).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
            </div>
            <div className="form-group">
                <label htmlFor="encuesta-sueno">2. ¿Cómo dormiste anoche?</label>
                <select id="encuesta-sueno" required value={v.sueno} onChange={cambiar('sueno')}>
                    <option value="" disabled>Selecciona una opción...</option>
                    {Object.entries(TEXTO_CHECKIN.sueno).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
            </div>
            <div className="form-group">
                <label htmlFor="encuesta-enfoque">3. ¿Cuál es tu objetivo mental para hoy?</label>
                <select id="encuesta-enfoque" required value={v.enfoque} onChange={cambiar('enfoque')}>
                    <option value="" disabled>Selecciona tu enfoque...</option>
                    {Object.entries(TEXTO_CHECKIN.enfoque).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
            </div>
            <p id="encuesta-error" className="error-formulario" role="alert">{error}</p>
            <div className="modal-acciones">
                <button type="submit" className="btn btn-ancho" disabled={guardando} aria-busy={guardando}>Guardar y Continuar</button>
            </div>
        </form>
    );
}

/** Ventana del check-in. Obligatoria (sin Escape ni fondo) mientras hoy no haya ninguno guardado. */
export function DialogoCheckin({ estado, fecha }) {
    return (
        <Dialogo abierto={estado.abierto} obligatorio={!estado.checkin} alCerrar={estado.cerrar} id="modal-encuesta" className="modal-dialog" aria-labelledby="titulo-checkin">
            <FormularioCheckin inicial={estado.checkin} fecha={fecha} alGuardado={estado.guardado} />
        </Dialogo>
    );
}
