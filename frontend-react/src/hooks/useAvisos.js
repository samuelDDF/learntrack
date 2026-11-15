// Notificaciones flotantes (ver contexts/NotificacionesContext.jsx)
import { useContext } from 'react';
import { NotificacionesContext } from '../contexts/NotificacionesContext.jsx';

/** { aviso(texto, { accion, alPulsar, ms }) } */
export const useAvisos = () => useContext(NotificacionesContext);
