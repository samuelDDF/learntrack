// Bienestar (/bienestar): el check-in de hoy, la carga mental, el consejo de la IA y el historial reciente, en una
// página propia. Son las MISMAS piezas (y la misma regla de cálculo) que el lateral de Mi panel.
import { useEffect } from 'react';
import { useRevelar } from '../../../hooks/useAnimaciones.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { useAvisos } from '../../../hooks/useAvisos.js';
import { hoyISO } from '../../../utils/fechas.js';
import { mensajeDeError } from '../../../services/errores.js';
import { useActividades } from '../../activities/hooks/useActividades.js';
import { useCheckin } from '../hooks/useCheckin.js';
import { useBienestarDelDia } from '../hooks/useBienestarDelDia.js';
import { DialogoCheckin, TEXTO_CHECKIN } from '../components/Checkin.jsx';
import { CargaMental } from '../components/CargaMental.jsx';
import { ConsejoIA } from '../components/ConsejoIA.jsx';
import { Historial } from '../components/Historial.jsx';
import '../bienestar.css';

const ERROR_CARGA = 'No se pudo cargar tu bienestar. Recarga la página.';

function ResumenCheckin({ checkin, listo, alEditar }) {
    return (
        <div className="card widget-panel lt-tarjeta-sutil">
            <h3>Tu check-in de hoy</h3>
            {!listo ? <p>Cargando…</p> : checkin ? (
                <dl className="checkin-resumen" id="checkin-resumen">
                    <div><dt>Ánimo</dt><dd>{TEXTO_CHECKIN.animo[checkin.animo] ?? checkin.animo}</dd></div>
                    <div><dt>Sueño</dt><dd>{TEXTO_CHECKIN.sueno[checkin.sueno] ?? checkin.sueno}</dd></div>
                    <div><dt>Enfoque</dt><dd>{TEXTO_CHECKIN.enfoque[checkin.enfoque] ?? checkin.enfoque}</dd></div>
                </dl>
            ) : <p>Todavía no has hecho el check-in de hoy.</p>}
            <p><button type="button" className="boton boton-mini" onClick={alEditar}>{checkin ? '✏️ Cambiar mis respuestas' : 'Hacer el check-in'}</button></p>
        </div>
    );
}

export default function Bienestar() {
    const fechaHoy = hoyISO();
    const { usuario } = useAuth();
    const { aviso } = useAvisos();
    const revelar = useRevelar();
    const { actividades, recargar } = useActividades();
    const checkin = useCheckin(usuario?.id, fechaHoy, { alFallar: (e) => aviso(mensajeDeError(e, ERROR_CARGA)) });
    const { carga, historial, consejo } = useBienestarDelDia({ actividades, fecha: fechaHoy, checkin: checkin.checkin, checkinListo: checkin.listo });

    useEffect(() => {
        let vivo = true;
        recargar().catch((e) => { if (vivo) aviso(mensajeDeError(e, ERROR_CARGA)); });
        return () => { vivo = false; };
    }, [recargar, aviso]);

    return (
        <main id="contenido" className="bienestar-app">
            <h1>Bienestar</h1>
            <p className="bienestar-intro">Cómo empiezas el día, cuánta carga llevas hoy y cómo has ido los últimos días.</p>
            <div className="bienestar-grid" ref={revelar} data-revelar-grupo="">
                <ResumenCheckin checkin={checkin.checkin} listo={checkin.listo} alEditar={checkin.abrir} />
                <CargaMental carga={carga} listo={checkin.listo} alEditarEstado={checkin.abrir} />
                <ConsejoIA consejo={consejo} />
                <div className="card widget-panel lt-tarjeta-sutil">
                    <h3>Historial Reciente</h3>
                    <Historial historial={historial} fechaHoy={fechaHoy} />
                </div>
            </div>
            <DialogoCheckin estado={checkin} fecha={fechaHoy} />
        </main>
    );
}
