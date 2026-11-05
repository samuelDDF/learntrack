// Aplica la apariencia guardada ANTES de que se pinte la página (por eso es un script clásico, sin "module",
// cargado en el <head>): así no hay destello del tema por defecto. La CSP no permite scripts en línea.
//
//  1. Lee la última apariencia usada en este navegador (localStorage, solo como caché de comodidad).
//  2. Consulta /api/auth/me: la verdad vive en la cuenta y se corrige si difiere. La promesa queda en
//     window.LearnTrackTema.usuario para que sesion.js no repita la petición.
//  3. Expone window.LearnTrackTema.aplicar(apariencia) para que Configuración cambie el tema al instante.
//
// Apariencia = { temaSeleccionado, variablesTema (solo tema "personalizado"), imagenFondoUrl }.
// Las variables de la paleta se ponen con style.setProperty (CSSOM): la CSP sí lo permite.
(function () {
    'use strict';
    var TEMAS = ['tech-focus', 'moderno', 'oscuro-profundo', 'futurista', 'zen-calm', 'oscuro', 'personalizado'];
    var CLAVE = 'learntrack_apariencia';
    var RE_VARIABLE = /^--[a-z0-9-]{1,40}$/;
    var RE_VALOR = /^[#(),.%\sa-z0-9-]{1,160}$/i;          // colores, rgba() y linear-gradient()
    var RE_FONDO = /^(\/api\/perfil\/fondo(\?v=\d{1,15})?|blob:[\w:/.-]{1,200})$/;
    var raiz = document.documentElement;
    var puestas = [];

    function leerCache() {
        try {
            var guardada = JSON.parse(localStorage.getItem(CLAVE) || 'null');
            if (guardada) return guardada;
            var antigua = localStorage.getItem('learntrack_tema');        // v3.2 guardaba solo el nombre
            return antigua ? { temaSeleccionado: antigua } : null;
        } catch (e) { return null; }
    }

    function ponerFondo(url) {
        if (url && RE_FONDO.test(url)) {
            raiz.style.setProperty('--fondo-imagen', 'url("' + url + '")');
            raiz.classList.add('con-fondo');
        } else {
            raiz.style.removeProperty('--fondo-imagen');
            raiz.classList.remove('con-fondo');
        }
    }

    /** Aplica { temaSeleccionado, variablesTema, imagenFondoUrl } (o solo el nombre del tema) */
    function aplicar(apariencia, guardar) {
        var a = typeof apariencia === 'string' ? { temaSeleccionado: apariencia } : (apariencia || {});
        var tema = TEMAS.indexOf(a.temaSeleccionado) === -1 ? 'tech-focus' : a.temaSeleccionado;
        var variables = a.variablesTema && typeof a.variablesTema === 'object' ? a.variablesTema : null;
        if (tema === 'personalizado' && !variables) tema = 'tech-focus';

        for (var i = 0; i < puestas.length; i++) raiz.style.removeProperty(puestas[i]);
        puestas = [];
        if (tema === 'personalizado') {
            for (var k in variables) {
                if (Object.prototype.hasOwnProperty.call(variables, k) && RE_VARIABLE.test(k) && RE_VALOR.test(String(variables[k])) && !/url/i.test(String(variables[k]))) {
                    raiz.style.setProperty(k, String(variables[k]));
                    puestas.push(k);
                }
            }
        }
        raiz.setAttribute('data-theme', tema);
        if (a.imagenFondoUrl !== undefined) ponerFondo(a.imagenFondoUrl);

        if (guardar !== false) {
            try {
                var actual = leerCache() || {};
                localStorage.setItem(CLAVE, JSON.stringify({
                    temaSeleccionado: tema,
                    variablesTema: tema === 'personalizado' ? variables : null,
                    imagenFondoUrl: a.imagenFondoUrl !== undefined ? a.imagenFondoUrl : (actual.imagenFondoUrl || null)
                }));
                localStorage.removeItem('learntrack_tema');
            } catch (e) { /* modo privado: no pasa nada */ }
        }
        return tema;
    }

    /** Al cerrar sesión o cambiar de cuenta: la siguiente persona no hereda el tema de este navegador */
    function olvidar() {
        try { localStorage.removeItem(CLAVE); localStorage.removeItem('learntrack_tema'); } catch (e) { /* nada */ }
    }

    var cache = leerCache();
    if (cache) aplicar(cache, false);

    var usuario = window.fetch
        ? fetch('/api/auth/me', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                var u = d && d.usuario ? d.usuario : null;
                if (u) aplicar({ temaSeleccionado: u.temaSeleccionado, variablesTema: u.variablesTema, imagenFondoUrl: u.imagenFondoUrl || null });
                return u;
            })
            .catch(function () { return null; })        // sin red: se queda la apariencia en caché
        : Promise.resolve(null);

    window.LearnTrackTema = { aplicar: aplicar, ponerFondo: ponerFondo, olvidar: olvidar, TEMAS: TEMAS, usuario: usuario };
})();
