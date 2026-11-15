// Ventana de confirmación para las acciones irreversibles de la papelera (Cancelar recibe el foco).
import { Dialogo } from '../../../components/common/Dialogo.jsx';

export function ConfirmacionPapelera({ abierta, titulo, texto, accion, ocupado, alConfirmar, alCancelar }) {
    return (
        <Dialogo abierto={abierta} alCerrar={alCancelar} obligatorio={ocupado} id="dlg-confirmar-papelera" className="dialogo dlg-confirmar" role="alertdialog"
            aria-labelledby="confirmar-papelera-titulo" aria-describedby="confirmar-papelera-texto">
            <div className="confirmar-cuerpo">
                <h4 id="confirmar-papelera-titulo">{titulo}</h4>
                <p id="confirmar-papelera-texto">{texto}</p>
                <div className="confirmar-acciones">
                    {/* autoFocus: el foco empieza en la opción segura */}
                    <button type="button" className="boton" autoFocus disabled={ocupado} onClick={alCancelar}>Cancelar</button>
                    <button type="button" className="boton boton-peligro confirmar" id="btn-confirmar-papelera" disabled={ocupado} aria-busy={ocupado} onClick={alConfirmar}>{accion}</button>
                </div>
            </div>
        </Dialogo>
    );
}
