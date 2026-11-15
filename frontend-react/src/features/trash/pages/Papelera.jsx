// Papelera (/papelera): lo eliminado desde Mi panel, Mi agenda o Proyectos, para restaurarlo o eliminarlo para
// siempre. Hasta la v3.10 era una ventana; ahora es una página con su dirección (se puede enlazar y volver atrás).
// Las reglas de la v3.9 se mantienen: selección con casillas, acciones sobre lo seleccionado, «Vaciar papelera»
// independiente, confirmación de lo irreversible y botones bloqueados mientras hay una operación en curso.
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Esqueleto } from '../../../components/common/Esqueleto.jsx';
import { usePapelera, actividadesTxt } from '../hooks/usePapelera.js';
import { BarraPapelera } from '../components/BarraPapelera.jsx';
import { ElementoPapelera } from '../components/ElementoPapelera.jsx';
import { ConfirmacionPapelera } from '../components/ConfirmacionPapelera.jsx';
import { RUTA_PANEL, RUTAS_PRIVADAS, PAGINAS_PRIVADAS } from '../../../app/rutas.js';
import '../papelera.css';

export default function Papelera() {
    const p = usePapelera();
    const [confirmar, setConfirmar] = useState(null);   // null | 'eliminar' | 'vaciar'
    const { state } = useLocation();
    // «Volver»: a la pantalla desde la que se abrió (solo una ruta privada conocida) o al panel
    const volver = RUTAS_PRIVADAS.includes(state?.volver) && state.volver !== '/papelera' ? state.volver : RUTA_PANEL;
    const { lista, n, ocupado, cargando, error } = p;

    const confirmarAccion = async () => {
        await (confirmar === 'vaciar' ? p.vaciar() : p.eliminarSeleccion());
        setConfirmar(null);
    };

    return (
        <main id="contenido" className="papelera-pagina">
            <div className="papelera-cuerpo">
                <div className="papelera-cab">
                    <h1 id="papelera-titulo">🗑 Papelera</h1>
                    <Link className="boton" id="btn-volver-papelera" to={volver}>{`← Volver a ${PAGINAS_PRIVADAS[volver].titulo.toLowerCase()}`}</Link>
                </div>
                <p className="papelera-nota">{p.dias ? `Lo que eliminas se guarda ${p.dias} días y luego se borra solo.` : ''}</p>

                <BarraPapelera p={p} alPedirConfirmacion={setConfirmar} />

                <ul className="papelera-lista" aria-live="polite" aria-labelledby="papelera-titulo">
                    {cargando ? <li className="vacia"><Esqueleto filas={2} texto="Cargando…" /></li> : null}
                    {!cargando && lista.length === 0 && !error ? <li className="vacia">La papelera está vacía.</li> : null}
                    {lista.map((a) => (
                        <ElementoPapelera key={a.id} a={a} marcada={p.seleccion.has(a.id)} ocupado={ocupado}
                            alAlternar={p.alternar} alRestaurar={p.restaurarUna} />
                    ))}
                </ul>
                <p className="papelera-estado" id="papelera-estado" role="status">{p.estado}</p>
                <p className="error-formulario" role="alert">{error}</p>
            </div>

            {/* Una sola ventana de confirmación (ids únicos); su texto depende de la acción */}
            <ConfirmacionPapelera
                abierta={confirmar !== null}
                titulo={confirmar === 'vaciar' ? '¿Vaciar la papelera?' : '¿Eliminar permanentemente?'}
                texto={confirmar === 'vaciar'
                    ? `Se eliminarán para siempre TODAS las actividades de la papelera (${actividadesTxt(lista.length)}${lista.length >= 200 ? ' o más' : ''}), estén seleccionadas o no. Esta acción no se puede deshacer.`
                    : `Se eliminarán para siempre ${actividadesTxt(n)} de la papelera. Esta acción no se puede deshacer.`}
                accion={confirmar === 'vaciar' ? 'Vaciar papelera' : `Eliminar ${actividadesTxt(n)}`}
                ocupado={ocupado === 'eliminar' || ocupado === 'vaciar'}
                alConfirmar={confirmarAccion}
                alCancelar={() => { if (!ocupado) setConfirmar(null); }} />
        </main>
    );
}
