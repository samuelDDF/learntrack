import { describe, it, expect } from 'vitest';
import { separarConectores, componerEntrada, textoDeResultados } from './dictado.js';

const resultados = (...frases) => frases.map((t) => [{ transcript: t }]);

describe('dictado por voz (regresión 3.4.2: variables inexistentes e innerHTML)', () => {
    it('separa actividades encadenadas con conectores', () => {
        expect(separarConectores('mañana estudio y luego entreno')).toBe('mañana estudio, luego entreno');
        expect(separarConectores('hoy leo también corro')).toBe('hoy leo, también corro');
        expect(separarConectores('estudio cálculo y mañana física')).toBe('estudio cálculo, mañana física');
        expect(separarConectores('pan y queso')).toBe('pan y queso');
    });
    it('compone el texto con lo ya escrito, con parciales y como máximo 500 caracteres', () => {
        expect(textoDeResultados(resultados('hola ', 'mundo'))).toBe('hola mundo');
        expect(componerEntrada('Ya escrito ', resultados('mañana estudio y luego entreno'))).toBe('Ya escrito mañana estudio, luego entreno');
        expect(componerEntrada('', resultados('a'.repeat(900)))).toHaveLength(500);
    });
    it('el dictado es TEXTO: las etiquetas se conservan literalmente (las escapa React al pintar)', () => {
        expect(componerEntrada('', resultados('<img src=x onerror=alert(1)>'))).toBe('<img src=x onerror=alert(1)>');
    });
});
