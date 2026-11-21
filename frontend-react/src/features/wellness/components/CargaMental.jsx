// Tarjeta «🔋 Carga Mental»: porcentaje del día, barra con semáforo, estado y explicación del cálculo.
// El porcentaje lo calcula useBienestarDelDia con la regla común (compartido/carga.js).
import { Contador } from '../../../components/common/Contador.jsx';
import '../bienestar.css';

const ESTADO_TXT = { verde: '🟢 Estado Equilibrado', amarillo: '🟡 Carga Moderada', rojo: '🔴 Advertencia de Saturación' };

export function CargaMental({ carga, listo, alEditarEstado }) {
    const nivel = carga.nivel;
    const ancho = Math.min(carga.porcentaje, 100);
    return (
        <div className="card widget-panel lt-tarjeta-sutil">
            <div className="bateria-header">
                <span className="bateria-titulo">
                    🔋 Carga Mental
                    <button type="button" id="btn-rehacer-encuesta" className="btn-icono btn-estado" title="Modificar cómo te sientes" onClick={alEditarEstado}>Estado</button>
                </span>
                <strong id="porcentaje-carga"><Contador valor={carga.porcentaje} sufijo="%" /></strong>
            </div>
            <div className="barra-base" role="progressbar" aria-labelledby="porcentaje-carga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ancho} id="barra-carga-rol">
                <div id="barra-progreso-carga" className={`barra-nivel nivel-barra-${nivel}`} style={{ width: `${ancho}%` }} />
            </div>
            <p id="estado-mensaje" className="estado-tag" aria-live="polite">{listo ? ESTADO_TXT[nivel] : 'Cargando estado...'}</p>
            <details className="explicacion-carga">
                <summary>¿Cómo funciona el cálculo de mi carga?</summary>
                <div className="explicacion-cuerpo">
                    <p>Tu carga mental funciona como una balanza: por un lado está <strong>tu tanque de energía</strong> y por otro, <strong>el peso de tus tareas</strong>.</p>
                    <h4>1. Tu Tanque de Energía (Check-in)</h4>
                    <ul>
                        <li><strong>Motivado/Alto:</strong> Tanque de 120 pts (tienes más margen).</li>
                        <li><strong>Normal/Medio:</strong> Tanque de 100 pts.</li>
                        <li><strong>Cansado/Bajo:</strong> Tanque de 70 pts (te saturarás más rápido).</li>
                    </ul>
                    <h4>2. El Peso de tus Actividades</h4>
                    <ul>
                        <li>Alta exigencia (3): <strong>+30 pts</strong> por hora</li>
                        <li>Exigencia media (2): <strong>+20 pts</strong> por hora</li>
                        <li>Baja exigencia (1): <strong>+10 pts</strong> por hora</li>
                        <li className="recarga">Ocio / Deporte (-2): <strong>-20 pts</strong> por hora</li>
                    </ul>
                    <p className="explicacion-nota">Una actividad de varios días suma sus horas en <strong>cada</strong> día de su rango, y las completadas siguen contando (la energía ya se gastó). Es la misma regla que usa la Agenda.</p>
                </div>
            </details>
        </div>
    );
}
