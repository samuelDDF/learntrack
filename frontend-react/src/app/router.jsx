// Enrutador CENTRAL de la SPA (una sola instancia de React y un solo BrowserRouter, en main.jsx).
//
//   /  /planificador  /asistente            LayoutPublico   (código público)
//   /login  /registro  /verificar-correo    ventana de acceso encima de la página de fondo (RutaPublica)
//   /panel /calendario /proyectos /estudio   RutaPrivada → LayoutPrivado (código privado, descargado al pedirlo)
//   /bienestar /papelera /perfil /configuracion
//   *                                       página 404
//
// Las páginas privadas se cargan de forma diferida (lazy) DESDE AQUÍ y solo tras pasar RutaPrivada: sin sesión su
// código ni se pide. Ojo: eso NO las protege por sí solo; la protección real es el servidor (páginas privadas con
// requiereSesionPagina, /r/privado con requiereSesionRecurso y toda la API con requiereAuthApi).
// Navegar entre páginas (también entre la zona pública y la privada) NO recarga el documento.
import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import LayoutPublico from '../components/layout/LayoutPublico.jsx';
import { RutaPrivada } from '../components/navigation/RutaPrivada.jsx';
import { GestorNavegacion } from '../components/navigation/GestorNavegacion.jsx';
import { CapaAcceso } from '../features/auth/components/CapaAcceso.jsx';
import { Inicio } from '../features/landing/pages/Inicio.jsx';
import { NoEncontrada } from '../features/landing/pages/NoEncontrada.jsx';
import { PAGINAS_ACCESO } from './rutas.js';

// Públicas que no son la portada: se descargan al visitarlas
const InfoPlanificador = lazy(() => import('../features/landing/pages/InfoPlanificador.jsx'));
const InfoAsistente = lazy(() => import('../features/landing/pages/InfoAsistente.jsx'));

// Zona privada (solo con sesión)
const LayoutPrivado = lazy(() => import('../components/layout/privado/LayoutPrivado.jsx'));
const Panel = lazy(() => import('../features/dashboard/pages/Panel.jsx'));
const Agenda = lazy(() => import('../features/calendar/pages/Agenda.jsx'));
const Proyectos = lazy(() => import('../features/projects/pages/Proyectos.jsx'));
const Estudio = lazy(() => import('../features/review/pages/Repaso.jsx'));
const Bienestar = lazy(() => import('../features/wellness/pages/Bienestar.jsx'));
const Papelera = lazy(() => import('../features/trash/pages/Papelera.jsx'));
const Perfil = lazy(() => import('../features/profile/pages/Perfil.jsx'));
const Configuracion = lazy(() => import('../features/settings/pages/Configuracion.jsx'));

export function Enrutador() {
    const location = useLocation();
    // Con la ventana de acceso abierta, debajo se sigue viendo la página desde la que se abrió
    const fondo = PAGINAS_ACCESO[location.pathname] ? location.state?.fondo : null;
    return (
        <>
            <GestorNavegacion />
            <Routes location={fondo ?? location}>
                <Route element={<LayoutPublico />}>
                    <Route index element={<Inicio />} />
                    <Route path="planificador" element={<InfoPlanificador />} />
                    <Route path="asistente" element={<InfoAsistente />} />
                    {/* Entrada directa a /login, /registro o /verificar-correo: la portada de fondo */}
                    <Route path="login" element={<Inicio />} />
                    <Route path="registro" element={<Inicio />} />
                    <Route path="verificar-correo" element={<Inicio />} />
                    <Route path="*" element={<NoEncontrada />} />
                </Route>
                <Route element={<RutaPrivada><LayoutPrivado /></RutaPrivada>}>
                    <Route path="panel" element={<Panel />} />
                    <Route path="calendario" element={<Agenda />} />
                    <Route path="proyectos" element={<Proyectos />} />
                    <Route path="estudio" element={<Estudio />} />
                    <Route path="repaso" element={<Navigate to="/estudio" replace />} />
                    <Route path="bienestar" element={<Bienestar />} />
                    <Route path="papelera" element={<Papelera />} />
                    <Route path="perfil" element={<Perfil />} />
                    <Route path="configuracion" element={<Configuracion />} />
                </Route>
            </Routes>
            <CapaAcceso />
        </>
    );
}
