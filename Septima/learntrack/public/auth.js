// Acceso a LearnTrack: modal de inicio de sesión / registro y estado de la sesión en la cabecera.
// Se carga en todas las páginas públicas. No guarda nada en el navegador: la sesión vive en una
// cookie HttpOnly que JavaScript no puede leer.
(() => {
    'use strict';

    const RUTA_PANEL = '/app-dashboard.html';
    let usuarioActual = null;
    let dialogo = null;

    // ---------- Utilidades DOM (nunca innerHTML: todo texto entra con textContent) ----------
    function el(tag, attrs = {}, ...hijos) {
        const nodo = document.createElement(tag);
        for (const [clave, valor] of Object.entries(attrs)) {
            if (valor === false || valor == null) continue;
            if (clave === 'class') nodo.className = valor;
            else if (clave === 'text') nodo.textContent = valor;
            else nodo.setAttribute(clave, valor === true ? '' : valor);
        }
        nodo.append(...hijos);
        return nodo;
    }

    function campo(id, etiqueta, tipo, autocompletar, extra = {}) {
        return el('div', {},
            el('label', { for: id, text: etiqueta }),
            el('input', { id, name: id, type: tipo, autocomplete: autocompletar, required: true, ...extra })
        );
    }

    // ---------- Modal ----------
    function construirDialogo() {
        const error = el('p', { class: 'auth-error', id: 'auth-error', role: 'alert' });

        const formLogin = el('form', { class: 'auth-form', id: 'form-login', novalidate: true },
            campo('login-email', 'Correo electrónico', 'email', 'email', { maxlength: '254' }),
            campo('login-password', 'Contraseña', 'password', 'current-password', { maxlength: '128' }),
            el('button', { type: 'submit', class: 'btn', text: 'Iniciar sesión' })
        );

        const formRegistro = el('form', { class: 'auth-form', id: 'form-registro', novalidate: true, hidden: true },
            campo('registro-nombre', 'Nombre', 'text', 'name', { maxlength: '60' }),
            campo('registro-email', 'Correo electrónico', 'email', 'email', { maxlength: '254' }),
            campo('registro-password', 'Contraseña', 'password', 'new-password', { maxlength: '128', minlength: '8' }),
            el('p', { class: 'auth-ayuda', text: 'Mínimo 8 caracteres, con al menos una letra y un número.' }),
            el('button', { type: 'submit', class: 'btn', text: 'Crear cuenta' })
        );

        const tabLogin = el('button', { type: 'button', class: 'auth-tab', role: 'tab', id: 'tab-login', 'aria-selected': 'true', 'aria-controls': 'form-login', text: 'Iniciar sesión' });
        const tabRegistro = el('button', { type: 'button', class: 'auth-tab', role: 'tab', id: 'tab-registro', 'aria-selected': 'false', 'aria-controls': 'form-registro', text: 'Crear cuenta' });
        const cerrar = el('button', { type: 'button', class: 'auth-cerrar', 'aria-label': 'Cerrar', text: '×' });

        const dlg = el('dialog', { class: 'auth-dialog', 'aria-labelledby': 'auth-titulo' },
            el('div', { class: 'auth-cuerpo' },
                cerrar,
                el('h2', { id: 'auth-titulo', text: 'Accede a LearnTrack' }),
                el('div', { class: 'auth-tabs', role: 'tablist' }, tabLogin, tabRegistro),
                formLogin,
                formRegistro,
                error
            )
        );

        const mostrarTab = (cual) => {
            const esLogin = cual === 'login';
            formLogin.hidden = !esLogin;
            formRegistro.hidden = esLogin;
            tabLogin.setAttribute('aria-selected', String(esLogin));
            tabRegistro.setAttribute('aria-selected', String(!esLogin));
            error.textContent = '';
            (esLogin ? formLogin : formRegistro).querySelector('input').focus();
        };

        tabLogin.addEventListener('click', () => mostrarTab('login'));
        tabRegistro.addEventListener('click', () => mostrarTab('registro'));
        cerrar.addEventListener('click', () => dlg.close());
        dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clic en el fondo
        dlg.addEventListener('close', () => {
            formLogin.reset();
            formRegistro.reset();
            error.textContent = '';
        });

        async function enviar(url, datos, formulario) {
            const boton = formulario.querySelector('button[type="submit"]');
            boton.disabled = true;
            error.textContent = '';
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    error.textContent = data.error || 'No se pudo completar la solicitud.';
                    return;
                }
                // Siempre al panel propio: no se confía en una ruta enviada por la respuesta
                location.assign(RUTA_PANEL);
            } catch {
                error.textContent = 'No se pudo conectar con el servidor.';
            } finally {
                boton.disabled = false;
            }
        }

        formLogin.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!formLogin.checkValidity()) { error.textContent = 'Escribe tu correo y tu contraseña.'; return; }
            enviar('/api/auth/login', {
                email: formLogin.elements['login-email'].value,
                password: formLogin.elements['login-password'].value
            }, formLogin);
        });

        formRegistro.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!formRegistro.checkValidity()) { error.textContent = 'Completa todos los campos con datos válidos.'; return; }
            enviar('/api/auth/registro', {
                nombre: formRegistro.elements['registro-nombre'].value,
                email: formRegistro.elements['registro-email'].value,
                password: formRegistro.elements['registro-password'].value
            }, formRegistro);
        });

        dlg.mostrarTab = mostrarTab;
        document.body.appendChild(dlg);
        return dlg;
    }

    function abrirModal(cual = 'login') {
        dialogo ??= construirDialogo();
        if (!dialogo.open) dialogo.showModal();
        dialogo.mostrarTab(cual === 'registro' ? 'registro' : 'login');
    }

    // ---------- Estado de la sesión ----------
    async function obtenerUsuario() {
        try {
            const res = await fetch('/api/auth/me');
            if (!res.ok) return null;
            return (await res.json()).usuario ?? null;
        } catch {
            return null;
        }
    }

    function pintarCabecera() {
        const zona = document.getElementById('nav-acceso');
        if (!zona || !usuarioActual) return;

        const salir = el('button', { type: 'button', class: 'btn btn-header btn-header-sec', text: 'Cerrar sesión' });
        salir.addEventListener('click', async () => {
            salir.disabled = true;
            try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* se recarga igualmente */ }
            location.assign('/');
        });

        zona.replaceChildren(
            el('a', { class: 'btn btn-header', href: RUTA_PANEL, text: 'Mi panel' }),
            salir
        );

        // Los botones de llamada a la acción pasan a llevar directo al panel
        document.querySelectorAll('[data-auth]').forEach((b) => { b.textContent = 'Ir a mi panel'; });
    }

    // Botones con data-auth="login" | "registro": abren el modal (o llevan al panel si ya hay sesión)
    document.addEventListener('click', (e) => {
        const boton = e.target.closest('[data-auth]');
        if (!boton) return;
        e.preventDefault();
        if (usuarioActual) location.assign(RUTA_PANEL);
        else abrirModal(boton.dataset.auth);
    });

    document.addEventListener('DOMContentLoaded', async () => {
        usuarioActual = await obtenerUsuario();
        pintarCabecera();

        // /?acceso=login lo usa el servidor al redirigir desde el panel sin sesión
        const parametros = new URLSearchParams(location.search);
        const pedido = parametros.get('acceso');
        if (pedido === 'login' || pedido === 'registro') {
            history.replaceState(null, '', location.pathname + location.hash);
            if (usuarioActual) location.assign(RUTA_PANEL);
            else abrirModal(pedido);
        }
    });
})();
