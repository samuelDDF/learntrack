// Mi panel: chat con el asistente, «Tu día de hoy», consejo de la IA, medidor de carga mental, historial y el
// check-in diario. La carga usa la MISMA regla que la Agenda y el servidor (compartido/carga.js).
// Las tarjetas de bienestar (check-in, carga, consejo e historial) son las de features/wellness, que también forman
// la página /bienestar. La papelera es su propia página (/papelera).
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useRevelar } from '../../../hooks/useAnimaciones.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { useAvisos } from '../../../hooks/useAvisos.js';
import { Esqueleto } from '../../../components/common/Esqueleto.jsx';
import { hoyISO } from '../../../utils/fechas.js';
import { mensajeDeError } from '../../../services/errores.js';
import { festivos as apiFestivos } from '../../calendar/services/festivos.service.js';
import { useActividades, proyectosDe } from '../../activities/hooks/useActividades.js';
import { useFormularioActividad } from '../../activities/components/FormularioActividad.jsx';
import { useEliminarActividad } from '../../activities/hooks/useEliminarActividad.js';
import { useCheckin } from '../../wellness/hooks/useCheckin.js';
import { useBienestarDelDia } from '../../wellness/hooks/useBienestarDelDia.js';
import { DialogoCheckin } from '../../wellness/components/Checkin.jsx';
import { CargaMental } from '../../wellness/components/CargaMental.jsx';
import { ConsejoIA } from '../../wellness/components/ConsejoIA.jsx';
import { Historial } from '../../wellness/components/Historial.jsx';
import { ChatIA } from '../../ai-assistant/components/ChatIA.jsx';
import { FilaActividad } from '../components/FilaActividad.jsx';
import { escuchar, FESTIVOS_ACTUALIZADOS } from '../../../utils/eventos.js';
import { RUTA_PAPELERA } from '../../../app/rutas.js';
import '../panel.css';

const BIENVENIDA = 'Escribe algo como «Mañana tengo parcial de redes de 2 a 4 pm con exigencia alta» o «Hoy jugué fútbol 1 hora». También puedo liberar un día, reorganizar tu semana, planificar un proyecto o leer un archivo (📎 + tu mensaje).';
const ERROR_CARGA = 'No se pudo cargar tu panel. Recarga la página.';

export default function Panel() {
    const fechaHoy = hoyISO();
    const { usuario } = useAuth();
    const { aviso } = useAvisos();
    const revelar = useRevelar();
    const { actividades, fijar, recargar, cargada } = useActividades();
    const checkin = useCheckin(usuario?.id, fechaHoy, { alFallar: (e) => aviso(mensajeDeError(e, ERROR_CARGA)) });
    const { hoy, carga, historial, consejo } = useBienestarDelDia({ actividades, fecha: fechaHoy, checkin: checkin.checkin, checkinListo: checkin.listo });
    const [festivosHoy, setFestivosHoy] = useState([]);
    const formulario = useFormularioActividad({ alCambiar: fijar, proyectos: proyectosDe(actividades) });
    const eliminar = useEliminarActividad(fijar);

    // ---- arranque: actividades y festivos de hoy (el check-in y el historial los cargan sus hooks) ----
    useEffect(() => {
        let vivo = true;
        recargar().catch((e) => { if (vivo) aviso(mensajeDeError(e, ERROR_CARGA)); });
        apiFestivos.listar({ desde: fechaHoy, hasta: fechaHoy }).then((r) => { if (vivo && r.ok) setFestivosHoy(r.data.festivos); }).catch(() => {});
        const quitar = escuchar(FESTIVOS_ACTUALIZADOS, (lista) => setFestivosHoy((lista ?? []).filter((f) => f.fecha === fechaHoy)));
        return () => { vivo = false; quitar(); };
    }, [fechaHoy, recargar, aviso]);

    return (
        <>
            <div className="dashboard-bienvenida">
                <p className="aviso-festivo" id="aviso-festivo" role="note" hidden={festivosHoy.length === 0}>
                    {festivosHoy.length ? `🎉 Hoy es festivo: ${festivosHoy.map((f) => f.nombre).join(' · ')}. Tómatelo con calma.` : ''}
                </p>
            </div>

            <main id="contenido" className="chat-layout-container">
                <section className="card chat-main-section" ref={revelar} data-revelar="arriba">
                    <header className="chat-header">
                        <h1 id="titulo-bienvenida">{`Hola ${usuario?.nombre ?? ''}, ¿qué tenemos hoy?`}</h1>
                        <p className="ayuda-chat">Dile a la IA qué harás en lenguaje natural, o pídele que libere un día, reorganice tu semana o planifique un proyecto.</p>
                    </header>
                    <div id="chat-ia" className="chat-panel-gigante">
                        <ChatIA alActualizar={fijar} bienvenida={BIENVENIDA} />
                    </div>
                </section>

                <aside className="sidebar-derecha" ref={revelar} data-revelar-grupo="">
                    <div className="card widget-panel lt-tarjeta-sutil">
                        <div className="lista-dia-cab">
                            <h3>Tu día de hoy</h3>
                            <div className="lista-dia-acciones">
                                <span id="fecha-actual-label" className="fecha-actual-label">{new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                                <Link className="boton boton-mini" id="btn-papelera" to={RUTA_PAPELERA} state={{ volver: '/panel' }}>🗑 Papelera</Link>
                                <button type="button" className="boton boton-mini" id="btn-nueva" onClick={() => formulario.abrir(null, { fecha: fechaHoy })}>+ Nueva</button>
                            </div>
                        </div>
                        <div id="grid-calendario" className="lista-dia-panel" aria-live="polite">
                            {!cargada ? <Esqueleto filas={2} texto="Cargando tu día…" /> : hoy.length
                                ? hoy.map((a) => (
                                    <FilaActividad key={a.id} a={a} alEditar={(x) => formulario.abrir(x)}
                                        alEliminar={async (x) => { const fallo = await eliminar(x); if (fallo) aviso(fallo); return !fallo; }} />
                                ))
                                : <div className="lista-vacia">No hay actividades en el calendario para hoy.</div>}
                        </div>
                    </div>

                    <ConsejoIA consejo={consejo} />
                    <CargaMental carga={carga} listo={checkin.listo} alEditarEstado={checkin.abrir} />

                    <div className="card widget-panel lt-tarjeta-sutil">
                        <h3>Historial Reciente</h3>
                        <Historial historial={historial} fechaHoy={fechaHoy} />
                    </div>
                </aside>
            </main>

            <DialogoCheckin estado={checkin} fecha={fechaHoy} />
            {formulario.formulario}
        </>
    );
}
