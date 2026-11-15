// Historial reciente de la carga mental (un porcentaje por día, de los días ya vividos).
import { nivelCarga } from '@compartido/carga.js';
import { useRevelar } from '../../../hooks/useAnimaciones.js';
import { Contador } from '../../../components/common/Contador.jsx';
import { Esqueleto } from '../../../components/common/Esqueleto.jsx';
import '../bienestar.css';

export function Historial({ historial, fechaHoy }) {
    const revelar = useRevelar();
    if (historial === null) return <div id="resumen-semanal"><Esqueleto variante="mini" filas={5} texto="Cargando historial..." /></div>;
    const fechas = Object.keys(historial).filter((f) => f <= fechaHoy).slice(-5);
    if (fechas.length === 0) return <div id="resumen-semanal">Sin registros previos.</div>;
    return (
        <div id="resumen-semanal">
            <div className="historial-grid" ref={revelar} data-revelar-grupo="">
                {fechas.map((f) => (
                    <div key={f} className="historial-item lt-tarjeta-sutil"><span>{f.slice(5)}</span><strong className={`nivel-${nivelCarga(historial[f])}`}><Contador valor={historial[f]} sufijo="%" /></strong></div>
                ))}
            </div>
        </div>
    );
}
