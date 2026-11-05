// Preparación de Vitest + Testing Library (jsdom). jsdom no implementa <dialog>.showModal/close: se simulan.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal ??= function showModal() { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.show ??= function show() { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function close() {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
    };
}
window.scrollTo = () => {};
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

afterEach(() => { cleanup(); localStorage.clear(); });
