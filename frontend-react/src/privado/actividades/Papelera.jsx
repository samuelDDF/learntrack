// Papelera (Mi panel y Mi agenda): lista lo eliminado y permite restaurarlo a mano.
import { useEffect, useState } from 'react';
import { textoCuando } from '@compartido/fechas.js';
import { Dialogo } from '../../comun/ui/Dialogo.jsx';
import { useAvisos } from '../../comun/ui/Avisos.jsx';
import { mensajeDeError } from '../../api/cliente.js';
import { papelera } from '../api.js';
import './papelera.css';

const fmtDia = (fecha) => new Date(fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Contenido({ alRestaurar, alCerrar }) {
    const [datos, setDatos] = useState(null);           // null = cargando
    const [error, setError] = useState('');
    const [restaurando, setRestaurando] = useState(null);
    const { aviso } = useAvisos();
    useEffect(() => {
        let vivo = true;
        papelera.listar().then((r) => {
            if (!vivo) return;
            if (r.ok) setDatos(r.data); else { setDatos({ dias: null, actividades: [] }); setError('No pude cargar la papelera.'); }
        }).catch(() => { if (vivo) { setDatos({ dias: null, actividades: [] }); setError('No pude cargar la papelera.'); } });
        return () => { vivo = false; };
    }, []);

    async function restaurar(a) {
        setRestaurando(a.id);
        setError('');
        try {
            const res = await papelera.restaurar(a.id);
            if (!res.ok) { setError(mensajeDeError(res, 'No se pudo restaurar.')); return; }
            setDatos((d) => ({ ...d, actividades: d.actividades.filter((x) => x.id !== a.id) }));
            alRestaurar(res.data.actividades);
            aviso(`♻ «${a.titulo}» restaurada.${res.data.avisos?.length ? ` ${res.data.avisos.join(' ')}` : ''}`);
        } catch (e) { setError(mensajeDeError(e)); } finally { setRestaurando(null); }
    }

    return (
        <div className="papelera-cuerpo">
            <h3 id="papelera-titulo">🗑 Papelera</h3>
            <p className="papelera-nota">{datos?.dias ? `Lo que eliminas se guarda ${datos.dias} días y luego se borra solo.` : ''}</p>
            <ul className="papelera-lista" aria-live="polite">
                {datos === null ? <li className="vacia">Cargando…</li> : null}
                {datos && datos.actividades.length === 0 && !error ? <li className="vacia">La papelera está vacía.</li> : null}
                {datos?.actividades.map((a) => (
                    <li key={a.id} className="papelera-item">
                        <div>
                            <strong>{a.titulo}</strong><small>{` · ${textoCuando(a)}`}</small>
                            <div className="papelera-meta">{`Eliminada ${fmtDia(a.eliminadaEn)}`}</div>
                        </div>
                        <button type="button" className="boton boton-mini" aria-label={`Restaurar ${a.titulo}`} disabled={restaurando === a.id} onClick={() => restaurar(a)}>♻ Restaurar</button>
                    </li>
                ))}
            </ul>
            <p className="error-formulario" role="alert">{error}</p>
            <div className="papelera-pie"><button type="button" className="boton" onClick={alCerrar}>Cerrar</button></div>
        </div>
    );
}

export function Papelera({ abierta, alCerrar, alRestaurar }) {
    return (
        <Dialogo abierto={abierta} alCerrar={alCerrar} id="dlg-papelera" className="dlg-papelera" aria-labelledby="papelera-titulo">
            <Contenido alRestaurar={alRestaurar} alCerrar={alCerrar} />
        </Dialogo>
    );
}
