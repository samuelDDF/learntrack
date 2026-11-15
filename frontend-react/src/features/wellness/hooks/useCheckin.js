// Check-in diario (ánimo, sueño y enfoque) de la persona para un día: manda el SERVIDOR; la copia local solo sirve
// para pintar rápido y para subir un check-in que se hizo sin conexión. La copia es por cuenta y por día.
// Si hoy no hay check-in, la ventana se abre sola y es obligatoria (como en Mi panel desde la v3.0).
import { useCallback, useEffect, useState } from 'react';
import { bienestar } from '../services/bienestar.service.js';

const claveCache = (usuarioId, fecha) => `learntrack_checkin_${usuarioId ?? 'anon'}_${fecha}`;
function leerCheckinLocal(usuarioId, fecha) {
    try { return JSON.parse(localStorage.getItem(claveCache(usuarioId, fecha)) || 'null'); } catch { return null; }
}
function escribirCheckinLocal(usuarioId, fecha, datos) {
    try {
        localStorage.setItem(claveCache(usuarioId, fecha), JSON.stringify(datos));
        localStorage.removeItem(`learntrack_encuesta_${fecha}`);       // clave antigua compartida entre cuentas
    } catch { /* sin almacenamiento */ }
}

/**
 * Carga el check-in de `fecha` (servidor primero). `alFallar(error)` se llama si no se pudo consultar.
 * Devuelve { checkin, listo, abierto, abrir, cerrar, guardado(checkin) }.
 */
export function useCheckin(usuarioId, fecha, { alFallar } = {}) {
    const [checkin, setCheckin] = useState(() => leerCheckinLocal(usuarioId, fecha));
    const [listo, setListo] = useState(false);
    const [abierto, setAbierto] = useState(false);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const res = await bienestar.checkin(fecha);
                if (!vivo) return;
                let chk = leerCheckinLocal(usuarioId, fecha);
                if (res.ok) {
                    if (res.data.checkin) { chk = res.data.checkin; escribirCheckinLocal(usuarioId, fecha, chk); }
                    else if (chk?.animo && chk?.sueno && chk?.enfoque) {
                        // Copia local de esta cuenta que no llegó al servidor: se sube
                        const r = await bienestar.guardarCheckin({ fecha, animo: chk.animo, sueno: chk.sueno, enfoque: chk.enfoque }).catch(() => null);
                        chk = r?.ok ? r.data.checkin : null;
                    } else chk = null;
                }
                if (!vivo) return;
                setCheckin(chk);
                setListo(true);
                if (!chk) setAbierto(true);
            } catch (e) {
                if (vivo) { setListo(true); alFallar?.(e); }
            }
        })();
        return () => { vivo = false; };
    }, [usuarioId, fecha]);   // eslint-disable-line react-hooks/exhaustive-deps

    const guardado = useCallback((c) => {
        setCheckin(c);
        escribirCheckinLocal(usuarioId, fecha, c);
        setAbierto(false);
    }, [usuarioId, fecha]);

    return { checkin, listo, abierto, abrir: () => setAbierto(true), cerrar: () => setAbierto(false), guardado };
}
