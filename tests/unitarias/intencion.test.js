// v3.6.1 · Detección determinista de creación, alcance anual y delegación («Decide tú»).
// «agenda», «tengo» o «tareas» por sí solos NO son señal de creación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esPeticionDeCreacion, alcanceAnual, delegaDecision } from '../../backend/servicios/asistente/interprete-lenguaje.js';

const HOY = '2026-10-07';
const crea = (t) => esPeticionDeCreacion(t, HOY);

test('creación: verbo explícito o evento propio con fecha u hora', () => {
    assert.equal(crea('El 2 de enero del 2028 tengo un partido de futbol importante de 10 a 12'), true);
    assert.equal(crea('Mañana tengo parcial de redes de 2 a 4 pm'), true);
    assert.equal(crea('Crea 2 actividades para el 3 de enero del año 2028'), true);
    assert.equal(crea('agenda una reunión el viernes'), true);
    assert.equal(crea('Agrega estudiar cálculo mañana'), true);
});

test('no es creación: «agenda», «tengo» o «tareas» sin evento concreto, o con otra intención', () => {
    assert.equal(crea('Libera mi agenda de 2027'), false);
    assert.equal(crea('libera mi agenda de mañana'), false);
    assert.equal(crea('Elimina todas las tareas que tengo para el año 2027'), false);
    assert.equal(crea('Aplaza todas las tareas de 2027'), false);
    assert.equal(crea('¿Qué tengo mañana?'), false);
    assert.equal(crea('tengo tareas en 2027'), false);
    assert.equal(crea('Muéstrame todas las actividades de 2027'), false);
    assert.equal(crea('mi agenda está llena'), false);
    assert.equal(crea('nada'), false);
    assert.equal(crea(''), false);
});

test('alcance anual: un año suelto sí; un año dentro de una fecha concreta no', () => {
    assert.deepEqual(alcanceAnual('Elimina todas las tareas de 2027'), { anio: 2027, inicio: '2027-01-01', fin: '2027-12-31' });
    assert.equal(alcanceAnual('Libera mi agenda del año 2027')?.anio, 2027);
    assert.equal(alcanceAnual('El 2 de enero del 2028 tengo un partido'), null);
    assert.equal(alcanceAnual('¿Qué tengo el 3 de enero de 2028?'), null);
    assert.equal(alcanceAnual('mueve lo del 15/03/2027'), null);
    assert.equal(alcanceAnual('borra lo del 2027-03-15'), null);
    assert.equal(alcanceAnual('libera mi agenda de mañana'), null);
    assert.equal(alcanceAnual('estudio 120 minutos'), null);
});

test('delegación explícita: solo frases que ceden la decisión', () => {
    for (const t of ['Decide tú', 'decídelo tú', 'como quieras', 'me da igual', 'Tú decides.']) assert.equal(delegaDecision(t), true, t);
    for (const t of ['nada', 'no sé', 'mañana', 'eliminar', 'decide tú si mañana o pasado']) assert.equal(delegaDecision(t), false, t);
});
