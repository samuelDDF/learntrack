// Apariencia y zona visual (ver contexts/TemaContext.jsx)
import { useContext } from 'react';
import { TemaContext } from '../contexts/TemaContext.jsx';

/** { aplicar(apariencia, guardar?), usarZonaPrivada(clase) → quitar } */
export function useTema() {
    const valor = useContext(TemaContext);
    if (!valor) throw new Error('useTema() debe usarse dentro de <ProveedorTema>.');
    return valor;
}
