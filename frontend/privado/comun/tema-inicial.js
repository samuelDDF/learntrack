// Aplica el tema elegido ANTES de que se pinte la página (por eso es un script clásico, sin "module", cargado
// en el <head>): así no hay destello del tema por defecto. La CSP no permite scripts en línea, por eso es un archivo.
//
//  1. Lee el último tema usado en este navegador (localStorage, solo como caché de comodidad).
//  2. Después consulta /api/auth/me: la verdad vive en el servidor (cuenta del usuario) y se corrige si difiere.
//  3. Expone window.LearnTrackTema.aplicar(tema) para que Mi perfil cambie el tema al instante.
(function () {
    'use strict';
    var TEMAS = ['tech-focus', 'zen-calm', 'oscuro'];
    var CLAVE = 'learntrack_tema';

    function aplicar(tema, guardar) {
        if (TEMAS.indexOf(tema) === -1) tema = 'tech-focus';
        document.documentElement.setAttribute('data-theme', tema);
        if (guardar !== false) { try { localStorage.setItem(CLAVE, tema); } catch (e) { /* modo privado: no pasa nada */ } }
        return tema;
    }

    var inicial = 'tech-focus';
    try { inicial = localStorage.getItem(CLAVE) || inicial; } catch (e) { /* sin almacenamiento */ }
    aplicar(inicial, false);
    window.LearnTrackTema = { aplicar: aplicar, TEMAS: TEMAS };

    if (window.fetch) {
        fetch('/api/auth/me', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d && d.usuario && d.usuario.temaEstetico) aplicar(d.usuario.temaEstetico); })
            .catch(function () { /* sin red: se queda el tema en caché */ });
    }
})();
