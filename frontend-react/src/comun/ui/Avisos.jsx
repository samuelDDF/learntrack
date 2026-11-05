// Avisos flotantes («🗑 Se movió a la papelera · Deshacer»). Proveedor + hook: useAvisos().aviso(texto, opciones)
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const Contexto = createContext({ aviso: () => {} });

export function ProveedorAvisos({ children }) {
    const [lista, setLista] = useState([]);
    const siguiente = useRef(0);
    const quitar = useCallback((id) => setLista((l) => l.filter((a) => a.id !== id)), []);
    const aviso = useCallback((texto, { accion = null, alPulsar = null, ms = 7000 } = {}) => {
        const id = ++siguiente.current;
        setLista((l) => [...l.slice(-3), { id, texto, accion, alPulsar }]);
        setTimeout(() => quitar(id), ms);
    }, [quitar]);
    const valor = useMemo(() => ({ aviso }), [aviso]);
    return (
        <Contexto.Provider value={valor}>
            {children}
            <div id="zona-avisos" className="zona-avisos" role="status" aria-live="polite">
                {lista.map((a) => (
                    <div key={a.id} className="aviso-flotante">
                        <span>{a.texto}</span>
                        {a.accion && a.alPulsar ? (
                            <button type="button" className="aviso-accion" onClick={() => { quitar(a.id); a.alPulsar(); }}>{a.accion}</button>
                        ) : null}
                    </div>
                ))}
            </div>
        </Contexto.Provider>
    );
}

export const useAvisos = () => useContext(Contexto);
