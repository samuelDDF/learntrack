// Punto de entrada del frontend React de LearnTrack.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import { ActualizacionPWA } from './comun/ActualizacionPWA.jsx';
import { registrarPWA } from './comun/pwa.js';
import { iniciarAnimaciones } from './comun/animaciones/revelar.js';
import './estilos/base.css';
import './estilos/app.css';
import './estilos/animaciones.css';

// Antes de pintar: activa las animaciones de entrada solo si se pueden completar (si no, todo se ve sin animar)
iniciarAnimaciones();

createRoot(document.getElementById('raiz')).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
        <ActualizacionPWA registrar={registrarPWA} />
    </StrictMode>
);
