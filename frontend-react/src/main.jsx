// Punto de entrada del frontend React de LearnTrack.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import { ActualizacionPWA } from './comun/ActualizacionPWA.jsx';
import { registrarPWA } from './comun/pwa.js';
import './estilos/base.css';
import './estilos/app.css';

createRoot(document.getElementById('raiz')).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
        <ActualizacionPWA registrar={registrarPWA} />
    </StrictMode>
);
