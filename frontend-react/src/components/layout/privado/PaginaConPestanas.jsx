// Diseño común de Mi perfil y Configuración: resumen de la cuenta y pestañas laterales (patrón ARIA «tabs», con
// flechas, Inicio y Fin). La pestaña activa es el ancla de la dirección (#voz), así se puede enlazar y volver atrás.
//  · secciones: [{ id, icono, texto, ruta }] de seccionesCuenta.js
//  · paneles: { [id]: elemento } (solo se pinta el de la pestaña activa)
//  · Un ancla que pertenece a la OTRA página (p. ej. /configuracion#informacion, de las versiones anteriores) lleva a
//    su página nueva sin recargar.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Esqueleto } from '../../common/Esqueleto.jsx';
import { Avatar } from './Avatar.jsx';
import { ANCLAS_ANTIGUAS, direccionDeSeccion } from './seccionesCuenta.js';

export function PaginaConPestanas({ titulo, etiqueta, secciones, perfil, error, textoError, textoCargando, paneles }) {
    const { pathname, hash } = useLocation();
    const navegar = useNavigate();
    const ids = secciones.map((s) => s.id);
    const pedida = hash.slice(1);
    const nueva = ANCLAS_ANTIGUAS[pedida] ?? pedida;
    const activa = ids.includes(nueva) ? nueva : ids[0];

    // Anclas antiguas o de la otra página → su dirección nueva (sin añadir entradas al historial)
    useEffect(() => {
        if (!pedida || ids.includes(pedida)) return;
        const destino = direccionDeSeccion(pedida);
        if (destino && destino !== `${pathname}#${pedida}`) navegar(destino, { replace: true });
    }, [pedida, pathname, navegar]);   // eslint-disable-line react-hooks/exhaustive-deps

    const ir = (id, { enfocar = false } = {}) => {
        navegar({ hash: `#${id}` }, { replace: true });
        if (enfocar) requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
    };
    const alTeclear = (ev, i) => {
        const vertical = window.matchMedia?.('(min-width: 861px)').matches ?? true;
        const siguiente = vertical ? 'ArrowDown' : 'ArrowRight', anterior = vertical ? 'ArrowUp' : 'ArrowLeft';
        let destino = null;
        if (ev.key === siguiente) destino = ids[(i + 1) % ids.length];
        else if (ev.key === anterior) destino = ids[(i - 1 + ids.length) % ids.length];
        else if (ev.key === 'Home') destino = ids[0];
        else if (ev.key === 'End') destino = ids.at(-1);
        if (destino) { ev.preventDefault(); ir(destino, { enfocar: true }); }
    };

    return (
        <main id="contenido" className="perfil-app">
            <h1 className="perfil-titulo">{titulo}</h1>
            <div className="perfil-layout">
                <aside className="perfil-lateral">
                    <div className="perfil-resumen">
                        <Avatar usuario={perfil} />
                        <div className="perfil-resumen-texto">
                            <strong id="resumen-nombre">{error ? textoError : perfil?.nombre ?? 'Cargando…'}</strong>
                            <span id="resumen-email">{perfil?.email ?? ''}</span>
                        </div>
                    </div>
                    <div className="pestanas" role="tablist" aria-orientation="vertical" aria-label={etiqueta}>
                        {secciones.map((s, i) => (
                            <button key={s.id} type="button" role="tab" id={`tab-${s.id}`} className="pestana"
                                aria-controls={`panel-${s.id}`} aria-selected={activa === s.id} tabIndex={activa === s.id ? 0 : -1}
                                onClick={() => ir(s.id)} onKeyDown={(e) => alTeclear(e, i)}>
                                <span className="pestana-icono" aria-hidden="true">{s.icono}</span><span>{s.texto}</span>
                            </button>
                        ))}
                    </div>
                </aside>
                <div className="perfil-contenido">
                    {!perfil ? (error ? null : <Esqueleto variante="texto" filas={4} texto={textoCargando} className="card" />)
                        : secciones.map((s) => (
                            <section key={s.id} id={`panel-${s.id}`} className="panel card" role="tabpanel" aria-labelledby={`tab-${s.id}`} tabIndex={0} hidden={activa !== s.id}>
                                {activa === s.id ? paneles[s.id] : null}
                            </section>
                        ))}
                </div>
            </div>
        </main>
    );
}
