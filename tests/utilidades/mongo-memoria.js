// Servidor de PRUEBAS que habla el protocolo de cable de MongoDB (OP_MSG / OP_QUERY) y guarda todo en memoria.
// Solo se usa en las pruebas cuando no hay MONGO_URI_TEST ni mongodb-memory-server. NO es MongoDB real:
// implementa el subconjunto de comandos que usan Mongoose 8 y LearnTrack (find, insert, update, delete,
// findAndModify, aggregate, count, distinct, índices únicos, collMod, transacciones con instantánea).
// El filtrado y las agregaciones los resuelve la librería `mingo` (lenguaje de consultas de MongoDB en JS).
import net from 'node:net';
import { BSON, ObjectId, Long, Double } from 'bson';
import { Query, Aggregator } from 'mingo';

const OP_REPLY = 1, OP_QUERY = 2004, OP_MSG = 2013;

// ---------- utilidades de documentos ----------
const esObjetoPlano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    && !(v instanceof Date) && !(v instanceof ObjectId) && !Buffer.isBuffer(v) && !(v?._bsontype);

// ObjectId -> cadena marcada para que mingo compare por valor; Long -> número
function aComparable(v) {
    if (v instanceof ObjectId || v?._bsontype === 'ObjectId') return `\u0000oid:${v.toHexString()}`;
    if (v?._bsontype === 'Long') return Number(v);
    if (v?._bsontype === 'Double' || v?._bsontype === 'Int32') return v.valueOf();
    if (Array.isArray(v)) return v.map(aComparable);
    if (esObjetoPlano(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aComparable(x)]));
    return v;
}
function deComparable(v) {
    if (typeof v === 'string' && v.startsWith('\u0000oid:')) return new ObjectId(v.slice(5));
    if (Array.isArray(v)) return v.map(deComparable);
    if (esObjetoPlano(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deComparable(x)]));
    return v;
}
const clonar = (doc) => BSON.deserialize(BSON.serialize(doc));

function leerRuta(doc, ruta) {
    let actual = doc;
    for (const parte of ruta.split('.')) {
        if (actual == null || typeof actual !== 'object') return undefined;
        actual = actual[parte];
    }
    return actual;
}
function fijarRuta(doc, ruta, valor) {
    const partes = ruta.split('.');
    let actual = doc;
    for (const parte of partes.slice(0, -1)) {
        if (!esObjetoPlano(actual[parte]) && !Array.isArray(actual[parte])) actual[parte] = {};
        actual = actual[parte];
    }
    actual[partes.at(-1)] = valor;
}
function borrarRuta(doc, ruta) {
    const partes = ruta.split('.');
    let actual = doc;
    for (const parte of partes.slice(0, -1)) { actual = actual?.[parte]; if (actual == null) return; }
    delete actual[partes.at(-1)];
}

// Orden BSON simplificado: null < números < cadenas < objetos < arrays < ObjectId < booleanos < fechas
function rango(v) {
    if (v === undefined || v === null) return 1;
    if (typeof v === 'number' || v?._bsontype === 'Long') return 2;
    if (typeof v === 'string') return 3;
    if (v instanceof ObjectId || v?._bsontype === 'ObjectId') return 7;
    if (typeof v === 'boolean') return 8;
    if (v instanceof Date) return 9;
    if (Array.isArray(v)) return 5;
    return 4;
}
function comparar(a, b) {
    const ra = rango(a), rb = rango(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return 0;
    if (ra === 2) return Number(a) - Number(b);
    if (ra === 3) return a < b ? -1 : a > b ? 1 : 0;
    if (ra === 7) return a.toHexString().localeCompare(b.toHexString());
    if (ra === 8) return Number(a) - Number(b);
    if (ra === 9) return a.getTime() - b.getTime();
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
}
function ordenar(docs, sort) {
    if (!sort || Object.keys(sort).length === 0) return docs;
    const claves = Object.entries(sort);
    return [...docs].sort((x, y) => {
        for (const [k, dir] of claves) {
            const c = comparar(leerRuta(x, k), leerRuta(y, k));
            if (c !== 0) return Number(dir) < 0 ? -c : c;
        }
        return 0;
    });
}
function proyectar(doc, proyeccion) {
    if (!proyeccion || Object.keys(proyeccion).length === 0) return doc;
    const entradas = Object.entries(proyeccion);
    const inclusiones = entradas.filter(([k, v]) => k !== '_id' && Number(v) === 1);
    if (inclusiones.length > 0) {
        const r = {};
        if (proyeccion._id === undefined || Number(proyeccion._id) === 1) { if (doc._id !== undefined) r._id = doc._id; }
        for (const [k] of inclusiones) { const v = leerRuta(doc, k); if (v !== undefined) fijarRuta(r, k, v); }
        return r;
    }
    const r = clonar(doc);
    for (const [k, v] of entradas) if (Number(v) === 0) borrarRuta(r, k);
    return r;
}

class ErrorMongo extends Error {
    constructor(code, codeName, errmsg, extra = {}) { super(errmsg); this.code = code; this.codeName = codeName; this.extra = extra; }
}

// ---------- almacén ----------
class Almacen {
    constructor() { this.dbs = new Map(); }
    db(nombre) { if (!this.dbs.has(nombre)) this.dbs.set(nombre, new Map()); return this.dbs.get(nombre); }
    coleccion(db, nombre, crear = true) {
        const d = this.db(db);
        if (!d.has(nombre) && crear) d.set(nombre, { docs: [], indices: [{ v: 2, key: { _id: 1 }, name: '_id_' }] });
        return d.get(nombre);
    }
    instantanea() {
        const copia = new Map();
        for (const [nombreDb, cols] of this.dbs) {
            const c2 = new Map();
            for (const [n, col] of cols) c2.set(n, { docs: col.docs.map(clonar), indices: col.indices.map((i) => ({ ...i, key: { ...i.key } })) });
            copia.set(nombreDb, c2);
        }
        return copia;
    }
}

function filtrar(col, filtro) {
    const q = new Query(aComparable(filtro ?? {}));
    return col.docs.filter((d) => q.test(aComparable(d)));
}

/**
 * ¿El documento entra en el índice? Como MongoDB real: un índice PARCIAL solo incluye los documentos que cumplen su
 * partialFilterExpression (p. ej. el índice único del administrador: solo los de rol «admin»), y uno DISPERSO (sparse)
 * solo los que tienen el campo.
 */
function entraEnIndice(idx, doc) {
    if (idx.partialFilterExpression && !new Query(aComparable(idx.partialFilterExpression)).test(aComparable(doc))) return false;
    if (idx.sparse && Object.keys(idx.key).every((k) => leerRuta(doc, k) === undefined)) return false;
    return true;
}

function comprobarUnicos(ns, col, doc, excluir = null) {
    for (const idx of col.indices) {
        if (!idx.unique && idx.name !== '_id_') continue;
        if (!entraEnIndice(idx, doc)) continue;
        const claves = Object.keys(idx.key);
        const valor = claves.map((k) => aComparable(leerRuta(doc, k) ?? null));
        const choca = col.docs.find((otro) => otro !== excluir && entraEnIndice(idx, otro)
            && JSON.stringify(claves.map((k) => aComparable(leerRuta(otro, k) ?? null))) === JSON.stringify(valor));
        if (choca) {
            const keyValue = Object.fromEntries(claves.map((k) => [k, leerRuta(doc, k) ?? null]));
            throw new ErrorMongo(11000, 'DuplicateKey',
                `E11000 duplicate key error collection: ${ns} index: ${idx.name} dup key: ${JSON.stringify(keyValue)}`,
                { keyPattern: idx.key, keyValue });
        }
    }
}

function aplicarActualizacion(doc, update, { insertando = false } = {}) {
    const claves = Object.keys(update ?? {});
    if (claves.length > 0 && !claves[0].startsWith('$')) {           // documento de reemplazo
        const id = doc._id;
        for (const k of Object.keys(doc)) delete doc[k];
        Object.assign(doc, clonar(update));
        if (id !== undefined) doc._id = id;
        return;
    }
    for (const [op, campos] of Object.entries(update)) {
        for (const [ruta, valor] of Object.entries(campos ?? {})) {
            switch (op) {
                case '$set': fijarRuta(doc, ruta, valor); break;
                case '$setOnInsert': if (insertando) fijarRuta(doc, ruta, valor); break;
                case '$unset': borrarRuta(doc, ruta); break;
                case '$inc': fijarRuta(doc, ruta, (Number(leerRuta(doc, ruta)) || 0) + Number(valor)); break;
                case '$push': { const a = leerRuta(doc, ruta) ?? []; a.push(...(valor?.$each ?? [valor])); fijarRuta(doc, ruta, a); break; }
                case '$addToSet': {
                    const a = leerRuta(doc, ruta) ?? [];
                    for (const v of valor?.$each ?? [valor]) if (!a.some((x) => comparar(x, v) === 0)) a.push(v);
                    fijarRuta(doc, ruta, a); break;
                }
                case '$currentDate': fijarRuta(doc, ruta, new Date()); break;
                case '$pull': {                // quita los elementos que cumplen la condición (o igualan el valor)
                    const lista = leerRuta(doc, ruta);
                    if (!Array.isArray(lista)) break;
                    const esCondicion = valor && typeof valor === 'object' && !Array.isArray(valor) && !(valor instanceof Date);
                    const cumple = esCondicion ? ((x) => new Query(valor).test(x)) : ((x) => JSON.stringify(x) === JSON.stringify(valor));
                    fijarRuta(doc, ruta, lista.filter((x) => !cumple(x)));
                    break;
                }
                default: throw new ErrorMongo(9, 'FailedToParse', `Operador de actualización no soportado por el servidor de pruebas: ${op}`);
            }
        }
    }
}

function semillaUpsert(filtro) {
    const doc = {};
    for (const [k, v] of Object.entries(filtro ?? {})) {
        if (k.startsWith('$')) continue;
        if (esObjetoPlano(v) && Object.keys(v).some((x) => x.startsWith('$'))) {
            if (v.$eq !== undefined) fijarRuta(doc, k, v.$eq);
            continue;
        }
        fijarRuta(doc, k, v);
    }
    return doc;
}

const respuestaCursor = (ns, docs, clave = 'firstBatch') => ({ cursor: { [clave]: docs, id: Long.ZERO, ns }, ok: new Double(1) });

// ---------- servidor ----------
export async function iniciarMongoMemoria({ replicaSet = false } = {}) {
    const almacen = new Almacen();
    const transacciones = new Map();       // lsid+txn -> instantánea
    let conexiones = 0;
    const sockets = new Set();

    function hello(puerto) {
        const r = {
            helloOk: true, ismaster: true, isWritablePrimary: true, maxBsonObjectSize: 16 * 1024 * 1024,
            maxMessageSizeBytes: 48000000, maxWriteBatchSize: 100000, localTime: new Date(),
            logicalSessionTimeoutMinutes: 30, connectionId: ++conexiones, minWireVersion: 0, maxWireVersion: 21,
            readOnly: false, ok: new Double(1)
        };
        if (replicaSet) Object.assign(r, { setName: 'rs-pruebas', setVersion: 1, hosts: [`127.0.0.1:${puerto}`], primary: `127.0.0.1:${puerto}`, me: `127.0.0.1:${puerto}` });
        return r;
    }

    function ejecutar(cuerpo, puerto) {
        const nombre = Object.keys(cuerpo)[0];
        const db = cuerpo.$db ?? 'admin';
        const comando = nombre.toLowerCase();

        // ---- transacciones ----
        if (cuerpo.txnNumber !== undefined && cuerpo.autocommit === false) {
            if (!replicaSet) throw new ErrorMongo(20, 'IllegalOperation', 'Transaction numbers are only allowed on a replica set member or mongos');
            const clave = `${cuerpo.lsid?.id?.toString('hex')}:${cuerpo.txnNumber}`;
            if (comando === 'committransaction') { transacciones.delete(clave); return { ok: new Double(1) }; }
            if (comando === 'aborttransaction') {
                const foto = transacciones.get(clave);
                if (foto) { almacen.dbs = foto; transacciones.delete(clave); }
                return { ok: new Double(1) };
            }
            if (cuerpo.startTransaction) transacciones.set(clave, almacen.instantanea());
        } else if (comando === 'committransaction' || comando === 'aborttransaction') {
            return { ok: new Double(1) };
        }

        const ns = (c) => `${db}.${c}`;
        switch (comando) {
            case 'hello': case 'ismaster': return hello(puerto);
            case 'ping': case 'endsessions': case 'killcursors': return { ok: new Double(1) };
            case 'buildinfo': return { version: '7.0.0-pruebas', versionArray: [7, 0, 0, 0], ok: new Double(1) };
            case 'getparameter': return { ok: new Double(1) };
            case 'listcollections': {
                const cols = [...almacen.db(db).keys()].map((n) => ({ name: n, type: 'collection', options: {}, info: { readOnly: false } }));
                const filtro = cuerpo.filter ? new Query(cuerpo.filter) : null;
                return respuestaCursor(`${db}.$cmd.listCollections`, filtro ? cols.filter((c) => filtro.test(c)) : cols);
            }
            case 'create': {
                if (almacen.db(db).has(cuerpo.create)) throw new ErrorMongo(48, 'NamespaceExists', `Collection ${ns(cuerpo.create)} already exists.`);
                almacen.coleccion(db, cuerpo.create); return { ok: new Double(1) };
            }
            case 'drop': {
                if (!almacen.db(db).delete(cuerpo.drop)) throw new ErrorMongo(26, 'NamespaceNotFound', 'ns not found');
                return { ok: new Double(1) };
            }
            case 'dropdatabase': almacen.dbs.delete(db); return { ok: new Double(1) };
            case 'createindexes': {
                const col = almacen.coleccion(db, cuerpo.createIndexes);
                const antes = col.indices.length;
                for (const spec of cuerpo.indexes) {
                    const existente = col.indices.find((i) => i.name === spec.name);
                    if (existente) {
                        const mismo = JSON.stringify(existente.key) === JSON.stringify(spec.key)
                            && Boolean(existente.unique) === Boolean(spec.unique)
                            && existente.expireAfterSeconds === spec.expireAfterSeconds;
                        if (!mismo) throw new ErrorMongo(85, 'IndexOptionsConflict', `An existing index has the same name as the requested index: ${spec.name}`);
                        continue;
                    }
                    if (spec.unique) {
                        const vistos = new Set();
                        for (const d of col.docs) {
                            if (!entraEnIndice(spec, d)) continue;
                            const v = JSON.stringify(Object.keys(spec.key).map((k) => aComparable(leerRuta(d, k) ?? null)));
                            if (vistos.has(v)) throw new ErrorMongo(11000, 'DuplicateKey', `E11000 duplicate key error collection: ${ns(cuerpo.createIndexes)} index: ${spec.name}`);
                            vistos.add(v);
                        }
                    }
                    col.indices.push({ v: 2, ...spec });
                }
                return { numIndexesBefore: antes, numIndexesAfter: col.indices.length, createdCollectionAutomatically: false, ok: new Double(1) };
            }
            case 'listindexes': {
                const col = almacen.coleccion(db, cuerpo.listIndexes, false);
                if (!col) throw new ErrorMongo(26, 'NamespaceNotFound', `ns does not exist: ${ns(cuerpo.listIndexes)}`);
                return respuestaCursor(ns(cuerpo.listIndexes), col.indices);
            }
            case 'dropindexes': {
                const col = almacen.coleccion(db, cuerpo.dropIndexes);
                col.indices = cuerpo.index === '*' ? col.indices.filter((i) => i.name === '_id_') : col.indices.filter((i) => i.name !== cuerpo.index);
                return { ok: new Double(1) };
            }
            case 'collmod': {
                const col = almacen.coleccion(db, cuerpo.collMod, false);
                if (!col) throw new ErrorMongo(26, 'NamespaceNotFound', 'ns does not exist');
                const { keyPattern, name, expireAfterSeconds } = cuerpo.index ?? {};
                const idx = col.indices.find((i) => (name && i.name === name) || (keyPattern && JSON.stringify(i.key) === JSON.stringify(keyPattern)));
                if (!idx) throw new ErrorMongo(27, 'IndexNotFound', 'cannot find index');
                const viejo = idx.expireAfterSeconds;
                idx.expireAfterSeconds = expireAfterSeconds;
                return { expireAfterSeconds_old: viejo, expireAfterSeconds_new: expireAfterSeconds, ok: new Double(1) };
            }
            case 'find': {
                const col = almacen.coleccion(db, cuerpo.find, false);
                let docs = col ? filtrar(col, cuerpo.filter) : [];
                docs = ordenar(docs, cuerpo.sort);
                if (cuerpo.skip) docs = docs.slice(Number(cuerpo.skip));
                if (cuerpo.limit) docs = docs.slice(0, Math.abs(Number(cuerpo.limit)));
                if (cuerpo.singleBatch && cuerpo.batchSize) docs = docs.slice(0, Number(cuerpo.batchSize));
                return respuestaCursor(ns(cuerpo.find), docs.map((d) => proyectar(d, cuerpo.projection)));
            }
            case 'getmore': return respuestaCursor(ns(cuerpo.collection), [], 'nextBatch');
            case 'count': {
                const col = almacen.coleccion(db, cuerpo.count, false);
                return { n: col ? filtrar(col, cuerpo.query).length : 0, ok: new Double(1) };
            }
            case 'distinct': {
                const col = almacen.coleccion(db, cuerpo.distinct, false);
                const valores = [];
                for (const d of col ? filtrar(col, cuerpo.query) : []) {
                    const v = leerRuta(d, cuerpo.key);
                    for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && !valores.some((y) => comparar(x, y) === 0)) valores.push(x);
                }
                return { values: valores, ok: new Double(1) };
            }
            case 'aggregate': {
                const col = almacen.coleccion(db, cuerpo.aggregate, false);
                const docs = (col?.docs ?? []).map(aComparable);
                const salida = new Aggregator(aComparable(cuerpo.pipeline)).run(docs).map(deComparable);
                return respuestaCursor(ns(cuerpo.aggregate), salida);
            }
            case 'insert': {
                const col = almacen.coleccion(db, cuerpo.insert);
                let n = 0; const writeErrors = [];
                cuerpo.documents.forEach((doc, index) => {
                    if (writeErrors.length && cuerpo.ordered !== false) return;
                    const nuevo = clonar(doc);
                    if (nuevo._id === undefined) nuevo._id = new ObjectId();
                    try { comprobarUnicos(ns(cuerpo.insert), col, nuevo); col.docs.push(nuevo); n++; }
                    catch (e) { if (!(e instanceof ErrorMongo)) throw e; writeErrors.push({ index, code: e.code, errmsg: e.message, ...e.extra }); }
                });
                return writeErrors.length ? { n, writeErrors, ok: new Double(1) } : { n, ok: new Double(1) };
            }
            case 'update': {
                const col = almacen.coleccion(db, cuerpo.update);
                let n = 0, nModified = 0; const upserted = []; const writeErrors = [];
                cuerpo.updates.forEach((u, index) => {
                    if (writeErrors.length && cuerpo.ordered !== false) return;
                    try {
                        if (Array.isArray(u.u)) throw new ErrorMongo(9, 'FailedToParse', 'El servidor de pruebas no admite actualizaciones con pipeline');
                        const objetivos = filtrar(col, u.q);
                        const lista = u.multi ? objetivos : objetivos.slice(0, 1);
                        if (lista.length === 0 && u.upsert) {
                            const nuevo = semillaUpsert(u.q);
                            aplicarActualizacion(nuevo, u.u, { insertando: true });
                            if (nuevo._id === undefined) nuevo._id = new ObjectId();
                            comprobarUnicos(ns(cuerpo.update), col, nuevo);
                            col.docs.push(nuevo); n++; upserted.push({ index, _id: nuevo._id });
                            return;
                        }
                        for (const doc of lista) {
                            const copia = clonar(doc);
                            aplicarActualizacion(copia, u.u);
                            comprobarUnicos(ns(cuerpo.update), col, copia, doc);
                            const cambio = JSON.stringify(aComparable(copia)) !== JSON.stringify(aComparable(doc));
                            col.docs[col.docs.indexOf(doc)] = copia;
                            n++; if (cambio) nModified++;
                        }
                    } catch (e) { if (!(e instanceof ErrorMongo)) throw e; writeErrors.push({ index, code: e.code, errmsg: e.message, ...e.extra }); }
                });
                const r = { n, nModified, ok: new Double(1) };
                if (upserted.length) r.upserted = upserted;
                if (writeErrors.length) r.writeErrors = writeErrors;
                return r;
            }
            case 'delete': {
                const col = almacen.coleccion(db, cuerpo.delete);
                let n = 0;
                for (const d of cuerpo.deletes) {
                    const objetivos = filtrar(col, d.q);
                    const lista = Number(d.limit) === 1 ? objetivos.slice(0, 1) : objetivos;
                    col.docs = col.docs.filter((x) => !lista.includes(x));
                    n += lista.length;
                }
                return { n, ok: new Double(1) };
            }
            case 'findandmodify': {
                const col = almacen.coleccion(db, cuerpo.findAndModify);
                const doc = ordenar(filtrar(col, cuerpo.query), cuerpo.sort)[0];
                const salida = (d) => (d ? proyectar(d, cuerpo.fields) : null);
                if (cuerpo.remove) {
                    if (doc) col.docs = col.docs.filter((x) => x !== doc);
                    return { lastErrorObject: { n: doc ? 1 : 0 }, value: salida(doc), ok: new Double(1) };
                }
                if (!doc) {
                    if (!cuerpo.upsert) return { lastErrorObject: { n: 0, updatedExisting: false }, value: null, ok: new Double(1) };
                    const nuevo = semillaUpsert(cuerpo.query);
                    aplicarActualizacion(nuevo, cuerpo.update, { insertando: true });
                    if (nuevo._id === undefined) nuevo._id = new ObjectId();
                    comprobarUnicos(ns(cuerpo.findAndModify), col, nuevo);
                    col.docs.push(nuevo);
                    return { lastErrorObject: { n: 1, updatedExisting: false, upserted: nuevo._id }, value: cuerpo.new ? salida(nuevo) : null, ok: new Double(1) };
                }
                const copia = clonar(doc);
                aplicarActualizacion(copia, cuerpo.update);
                comprobarUnicos(ns(cuerpo.findAndModify), col, copia, doc);
                col.docs[col.docs.indexOf(doc)] = copia;
                return { lastErrorObject: { n: 1, updatedExisting: true }, value: salida(cuerpo.new ? copia : doc), ok: new Double(1) };
            }
            default:
                throw new ErrorMongo(59, 'CommandNotFound', `no such command: '${nombre}' (servidor de pruebas)`);
        }
    }

    function responder(socket, requestId, opCode, doc) {
        const cuerpo = BSON.serialize(doc);
        if (opCode === OP_QUERY) {
            const cab = Buffer.alloc(16 + 20);
            cab.writeInt32LE(36 + cuerpo.length, 0); cab.writeInt32LE(0, 4); cab.writeInt32LE(requestId, 8); cab.writeInt32LE(OP_REPLY, 12);
            cab.writeInt32LE(0, 16); cab.writeBigInt64LE(0n, 20); cab.writeInt32LE(0, 28); cab.writeInt32LE(1, 32);
            socket.write(Buffer.concat([cab, cuerpo]));
        } else {
            const cab = Buffer.alloc(16 + 5);
            cab.writeInt32LE(21 + cuerpo.length, 0); cab.writeInt32LE(0, 4); cab.writeInt32LE(requestId, 8); cab.writeInt32LE(OP_MSG, 12);
            cab.writeUInt32LE(0, 16); cab.writeUInt8(0, 20);
            socket.write(Buffer.concat([cab, cuerpo]));
        }
    }

    function procesar(socket, mensaje, puerto) {
        const requestId = mensaje.readInt32LE(4);
        const opCode = mensaje.readInt32LE(12);
        let cuerpo;
        if (opCode === OP_MSG) {
            const flags = mensaje.readUInt32LE(16);
            const fin = mensaje.length - ((flags & 1) ? 4 : 0);
            let pos = 20;
            const secuencias = {};
            while (pos < fin) {
                const tipo = mensaje.readUInt8(pos); pos += 1;
                if (tipo === 0) {
                    const tam = mensaje.readInt32LE(pos);
                    cuerpo = BSON.deserialize(mensaje.subarray(pos, pos + tam), { promoteBuffers: true });
                    pos += tam;
                } else {
                    const tam = mensaje.readInt32LE(pos);
                    const finSec = pos + tam;
                    let p = pos + 4;
                    const finId = mensaje.indexOf(0, p);
                    const id = mensaje.toString('utf8', p, finId);
                    p = finId + 1;
                    const docs = [];
                    while (p < finSec) { const t = mensaje.readInt32LE(p); docs.push(BSON.deserialize(mensaje.subarray(p, p + t), { promoteBuffers: true })); p += t; }
                    secuencias[id] = docs; pos = finSec;
                }
            }
            Object.assign(cuerpo, secuencias);
        } else if (opCode === OP_QUERY) {
            let pos = 20;
            const finNs = mensaje.indexOf(0, pos);
            const nsCompleto = mensaje.toString('utf8', pos, finNs);
            pos = finNs + 1 + 8;
            const tam = mensaje.readInt32LE(pos);
            cuerpo = BSON.deserialize(mensaje.subarray(pos, pos + tam), { promoteBuffers: true });
            if (cuerpo.$query) cuerpo = cuerpo.$query;
            cuerpo.$db = nsCompleto.split('.')[0];
        } else {
            return responder(socket, requestId, OP_MSG, { ok: new Double(0), errmsg: `opCode no soportado ${opCode}`, code: 2 });
        }
        let resultado;
        try { resultado = ejecutar(cuerpo, puerto); }
        catch (e) {
            if (!(e instanceof ErrorMongo)) { console.error('[mongo-memoria]', e); resultado = { ok: new Double(0), errmsg: e.message, code: 1, codeName: 'InternalError' }; }
            else resultado = { ok: new Double(0), errmsg: e.message, code: e.code, codeName: e.codeName, ...e.extra };
        }
        responder(socket, requestId, opCode, resultado);
    }

    const servidor = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        let pendiente = Buffer.alloc(0);
        socket.on('data', (trozo) => {
            pendiente = Buffer.concat([pendiente, trozo]);
            while (pendiente.length >= 4) {
                const largo = pendiente.readInt32LE(0);
                if (pendiente.length < largo) break;
                const mensaje = pendiente.subarray(0, largo);
                pendiente = pendiente.subarray(largo);
                procesar(socket, mensaje, servidor.address().port);
            }
        });
        socket.on('error', () => {});
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    const puerto = servidor.address().port;
    return {
        uri: `mongodb://127.0.0.1:${puerto}/learntrack_pruebas?directConnection=true`,
        tipo: replicaSet ? 'memoria-replicaset' : 'memoria-standalone',
        almacen,
        reiniciar: () => { almacen.dbs.clear(); transacciones.clear(); },
        cerrar: () => new Promise((ok) => { for (const s of sockets) s.destroy(); servidor.close(() => ok()); })
    };
}
