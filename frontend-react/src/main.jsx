// Punto de entrada del frontend React de LearnTrack.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './app/App.jsx';
import { ActualizacionPWA } from './app/ActualizacionPWA.jsx';
import { registrarPWA } from './app/pwa.js';
import { iniciarAnimaciones } from './utils/animaciones.js';
import './styles/base.css';
import './styles/app.css';
import './styles/animaciones.css';

// URLs de imágenes públicas: BASE_URL incluye /LearnTrack/ en GitHub Pages y / en desarrollo/dominio propio.
const baseRecursos = import.meta.env.BASE_URL;
document.documentElement.style.setProperty('--lt-fondo-hero', `url(\"${baseRecursos}recursos/imagenes/fondo-hero.avif\")`);
document.documentElement.style.setProperty('--lt-fondo-app', `url(\"${baseRecursos}recursos/imagenes/fondo.png\")`);

// Antes de pintar: activa las animaciones de entrada solo si se pueden completar (si no, todo se ve sin animar)
iniciarAnimaciones();

createRoot(document.getElementById('raiz')).render(
    <StrictMode>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
            <App />
        </BrowserRouter>
        <ActualizacionPWA registrar={registrarPWA} />
    </StrictMode>
);
