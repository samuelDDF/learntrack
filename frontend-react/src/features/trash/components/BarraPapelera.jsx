// Barra de la papelera: «Seleccionar todas», contador, «Vaciar papelera» (siempre visible, independiente de la
// selección) y, con algo seleccionado, «Restaurar» / «Eliminar permanentemente» / «Cancelar selección».
import { actividadesTxt } from '../hooks/usePapelera.js';

export function BarraPapelera({ p, alPedirConfirmacion }) {
    const { lista, n, todas, alguna, ocupado, cargando } = p;
    return (
        <>
            <div className="papelera-barra" role="toolbar" aria-label="Acciones de la papelera">
                <label className={`papelera-todas${lista.length ? '' : ' inactiva'}`}>
                    <input type="checkbox" id="papelera-todas" checked={todas} disabled={!lista.length || Boolean(ocupado)} onChange={p.alternarTodas}
                        ref={(el) => { if (el) el.indeterminate = alguna; }} />
                    <span>Seleccionar todas</span>
                </label>
                <span className="papelera-contador" id="papelera-contador" aria-live="polite">
                    {n ? `${n} ${n === 1 ? 'seleccionada' : 'seleccionadas'}` : ''}
                </span>
                <button type="button" className="boton boton-mini boton-peligro" id="btn-vaciar-papelera"
                    disabled={cargando || !lista.length || Boolean(ocupado)} aria-busy={ocupado === 'vaciar'}
                    onClick={() => alPedirConfirmacion('vaciar')}>Vaciar papelera</button>
            </div>

            {n > 0 ? (
                <div className="papelera-seleccion" role="group" aria-label={`Acciones para ${actividadesTxt(n)} seleccionadas`}>
                    <button type="button" className="boton boton-mini boton-primario" id="btn-restaurar-seleccion" disabled={Boolean(ocupado)}
                        aria-busy={ocupado === 'restaurar'} onClick={p.restaurarSeleccion}>{`♻ Restaurar (${n})`}</button>
                    <button type="button" className="boton boton-mini boton-peligro" id="btn-eliminar-seleccion" disabled={Boolean(ocupado)}
                        aria-busy={ocupado === 'eliminar'} onClick={() => alPedirConfirmacion('eliminar')}>{`Eliminar permanentemente (${n})`}</button>
                    <button type="button" className="boton boton-mini" disabled={Boolean(ocupado)} onClick={p.limpiarSeleccion}>Cancelar selección</button>
                </div>
            ) : null}
        </>
    );
}
