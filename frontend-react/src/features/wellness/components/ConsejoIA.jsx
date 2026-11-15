// Burbuja «✨ Asistente LearnTrack» con el consejo del día (lo genera la IA en el servidor; aquí solo se muestra).
import { useAnimarCambio } from '../../../hooks/useAnimaciones.js';
import '../bienestar.css';

export function ConsejoIA({ consejo }) {
    const ref = useAnimarCambio(consejo.texto, 'aparecer', { duracion: 360 });
    return (
        <div className={`asistente-ia-box${consejo.pensando ? ' pensando' : ''}`}>
            <h3>✨ Asistente LearnTrack</h3>
            <p id="consejo-ia" ref={ref} aria-live="polite">{consejo.texto}</p>
        </div>
    );
}
