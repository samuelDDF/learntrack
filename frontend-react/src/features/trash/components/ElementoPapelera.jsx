// Una actividad de la papelera: casilla de selección, título, cuándo era y cuándo se eliminó, y «♻ Restaurar».
import { textoCuando } from '@compartido/fechas.js';

const fmtDia = (fecha) => new Date(fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function ElementoPapelera({ a, marcada, ocupado, alAlternar, alRestaurar }) {
    const idCasilla = `papelera-sel-${a.id}`;
    return (
        <li className={`papelera-item${marcada ? ' seleccionada' : ''}`}>
            <input type="checkbox" id={idCasilla} className="papelera-casilla" checked={marcada} disabled={Boolean(ocupado)}
                onChange={() => alAlternar(a.id)} />
            <label htmlFor={idCasilla} className="papelera-texto">
                <strong>{a.titulo}</strong><small>{` · ${textoCuando(a)}`}</small>
                <span className="papelera-meta">{`Eliminada ${fmtDia(a.eliminadaEn)}`}</span>
            </label>
            <button type="button" className="boton boton-mini" aria-label={`Restaurar ${a.titulo}`} disabled={Boolean(ocupado)}
                aria-busy={ocupado === a.id} onClick={() => alRestaurar(a)}>♻ Restaurar</button>
        </li>
    );
}
