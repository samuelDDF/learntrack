// Configuración, con pestañas laterales (patrón ARIA «tabs», con flechas, Inicio y Fin):
//   Información básica (foto, nombre, correo) · Voz de la IA (nombre y voz) · Estética (temas, paleta con
//   Colormind, fondo) · Cuentas vinculadas · Notificaciones · Privacidad y seguridad (contraseña y baja).
// Migrado de frontend/privado/configuracion. Los colores se aplican con CSSOM (la CSP no permite style="").
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAvisos } from '../../../comun/ui/Avisos.jsx';
import { Cargando } from '../../../comun/ui/Cargando.jsx';
import { actualizarUsuario } from '../../../comun/sesion.js';
import { aplicarApariencia } from '../../../comun/tema.js';
import { perfil as apiPerfil } from '../../api.js';
import { Avatar } from '../../barra/Avatar.jsx';
import { SECCIONES_CONFIGURACION } from '../../barra/MenuConfiguracion.jsx';
import { SeccionInformacion, SeccionVoz, SeccionEstetica, SeccionCuentas, SeccionNotificaciones, SeccionPrivacidad } from './secciones.jsx';
import './configuracion.css';

// Direcciones antiguas de «Mi perfil» (v3.1–v3.2) → pestañas nuevas
const HASH_ANTIGUOS = { perfil: 'informacion', apariencia: 'estetica', general: 'notificaciones' };
const IDS = SECCIONES_CONFIGURACION.map((s) => s.id);

export default function Configuracion() {
    const { hash } = useLocation();
    const navegar = useNavigate();
    const { aviso } = useAvisos();
    const [datos, setDatos] = useState(null);           // { perfil, integraciones }
    const [error, setError] = useState(false);

    const pedida = hash.slice(1);
    const activa = IDS.includes(HASH_ANTIGUOS[pedida] ?? pedida) ? (HASH_ANTIGUOS[pedida] ?? pedida) : IDS[0];
    useEffect(() => { if (HASH_ANTIGUOS[pedida]) navegar({ hash: `#${HASH_ANTIGUOS[pedida]}` }, { replace: true }); }, [pedida, navegar]);

    /** Aplica lo que devuelve el servidor y avisa a la cabecera (nombre, foto, voz, nombre de la IA) */
    const pintarTodo = useCallback((d) => {
        setDatos((prev) => ({ perfil: d.perfil, integraciones: d.integraciones ?? prev?.integraciones ?? { modo: 'simulado' } }));
        const p = d.perfil;
        aplicarApariencia({ temaSeleccionado: p.temaSeleccionado, variablesTema: p.variablesTema, imagenFondoUrl: p.imagenFondoUrl });
        actualizarUsuario({ nombre: p.nombre, email: p.email, avatarUrl: p.avatarUrl, vozAsistente: p.vozAsistente, nombreIA: p.nombreIA });
    }, []);
    const fijarPerfil = useCallback((perfil, integraciones) => setDatos((prev) => ({ perfil, integraciones: integraciones ?? prev?.integraciones })), []);

    useEffect(() => {
        let vivo = true;
        apiPerfil.obtener().then((r) => {
            if (!vivo) return;
            if (!r.ok) throw new Error();
            pintarTodo(r.data);
        }).catch(() => { if (vivo) { setError(true); aviso('No se pudo cargar tu configuración. Recarga la página.'); } });
        return () => { vivo = false; };
    }, [pintarTodo, aviso]);

    const ir = (id, { enfocar = false } = {}) => {
        navegar({ hash: `#${id}` }, { replace: true });
        if (enfocar) requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
    };
    const alTeclear = (ev, i) => {
        const vertical = window.matchMedia?.('(min-width: 861px)').matches ?? true;
        const siguiente = vertical ? 'ArrowDown' : 'ArrowRight', anterior = vertical ? 'ArrowUp' : 'ArrowLeft';
        let destino = null;
        if (ev.key === siguiente) destino = IDS[(i + 1) % IDS.length];
        else if (ev.key === anterior) destino = IDS[(i - 1 + IDS.length) % IDS.length];
        else if (ev.key === 'Home') destino = IDS[0];
        else if (ev.key === 'End') destino = IDS.at(-1);
        if (destino) { ev.preventDefault(); ir(destino, { enfocar: true }); }
    };

    const p = datos?.perfil;
    const props = { perfil: p, integraciones: datos?.integraciones, pintarTodo, fijarPerfil };
    return (
        <main id="contenido" className="perfil-app">
            <h1 className="perfil-titulo">Configuración</h1>
            <div className="perfil-layout">
                <aside className="perfil-lateral">
                    <div className="perfil-resumen">
                        <Avatar usuario={p} />
                        <div className="perfil-resumen-texto">
                            <strong id="resumen-nombre">{error ? 'No se pudo cargar tu configuración' : p?.nombre ?? 'Cargando…'}</strong>
                            <span id="resumen-email">{p?.email ?? ''}</span>
                        </div>
                    </div>
                    <div className="pestanas" role="tablist" aria-orientation="vertical" aria-label="Secciones de configuración">
                        {SECCIONES_CONFIGURACION.map((s, i) => (
                            <button key={s.id} type="button" role="tab" id={`tab-${s.id}`} className="pestana"
                                aria-controls={`panel-${s.id}`} aria-selected={activa === s.id} tabIndex={activa === s.id ? 0 : -1}
                                onClick={() => ir(s.id)} onKeyDown={(e) => alTeclear(e, i)}>
                                <span className="pestana-icono" aria-hidden="true">{s.icono}</span><span>{s.texto}</span>
                            </button>
                        ))}
                    </div>
                </aside>
                <div className="perfil-contenido">
                    {!p ? (error ? null : <Cargando texto="Cargando tu configuración…" />) : (
                        <>
                            <Panel id="informacion" activa={activa}><SeccionInformacion {...props} /></Panel>
                            <Panel id="voz" activa={activa}><SeccionVoz {...props} /></Panel>
                            <Panel id="estetica" activa={activa}><SeccionEstetica {...props} /></Panel>
                            <Panel id="cuentas" activa={activa}><SeccionCuentas {...props} /></Panel>
                            <Panel id="notificaciones" activa={activa}><SeccionNotificaciones {...props} /></Panel>
                            <Panel id="privacidad" activa={activa}><SeccionPrivacidad {...props} /></Panel>
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}

function Panel({ id, activa, children }) {
    return (
        <section id={`panel-${id}`} className="panel card" role="tabpanel" aria-labelledby={`tab-${id}`} tabIndex={0} hidden={activa !== id}>
            {activa === id ? children : null}
        </section>
    );
}

