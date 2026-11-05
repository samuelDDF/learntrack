// Confirmación en DOS clics sin diálogos del navegador (la CSP y la accesibilidad desaconsejan confirm()): el primer
// clic cambia el texto («¿Seguro?») y el segundo ejecuta la acción. Si no se confirma a tiempo, vuelve a su estado.
import { useEffect, useRef, useState } from 'react';

export function BotonConfirmar({ alConfirmar, children, textoConfirmar = '¿Seguro?', ms = 4000, className = 'boton boton-peligro', disabled, 'aria-label': etiqueta, ...resto }) {
    const [confirmando, setConfirmando] = useState(false);
    const [ocupado, setOcupado] = useState(false);
    const temporizador = useRef(null);
    useEffect(() => () => clearTimeout(temporizador.current), []);
    const pulsar = async () => {
        if (!confirmando) {
            setConfirmando(true);
            temporizador.current = setTimeout(() => setConfirmando(false), ms);
            return;
        }
        clearTimeout(temporizador.current);
        setConfirmando(false);
        setOcupado(true);
        try { await alConfirmar(); } finally { setOcupado(false); }
    };
    return (
        <button type="button" className={`${className}${confirmando ? ' confirmar' : ''}`} data-confirmando={confirmando ? '1' : undefined}
            disabled={disabled || ocupado} onClick={pulsar} {...resto}
            aria-label={etiqueta ? (confirmando ? `${textoConfirmar} Pulsa otra vez para confirmar: ${etiqueta}` : etiqueta) : undefined}>
            {confirmando ? textoConfirmar : children}
        </button>
    );
}
