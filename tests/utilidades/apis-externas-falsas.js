// Servidor de pruebas que imita las APIs públicas que usa LearnTrack: Nager.Date (festivos) y Colormind
// (paletas). Permite simular caídas y respuestas maliciosas sin salir a internet.
import http from 'node:http';

const NACIONALES_CO = [
    { date: '2026-01-01', localName: 'Año Nuevo', name: "New Year's Day", global: true, counties: null },
    { date: '2026-07-20', localName: 'Día de la Independencia', name: 'Independence Day', global: true, counties: null },
    { date: '2026-12-25', localName: 'Navidad', name: 'Christmas Day', global: true, counties: null },
    // dato externo malicioso: debe llegar limpio (sin < >) al usuario
    { date: '2026-11-02', localName: '<script>alert(1)</script>Todos los Santos', name: "All Saints' Day", global: true, counties: null },
    { date: 'no-es-fecha', localName: 'Roto', name: 'Broken', global: true, counties: null }
];
const ESPANA = [
    { date: '2026-01-01', localName: 'Año Nuevo', name: "New Year's Day", global: true, counties: null },
    { date: '2026-05-02', localName: 'Fiesta de la Comunidad de Madrid', name: 'Madrid Day', global: false, counties: ['ES-MD'] },
    { date: '2026-09-11', localName: 'Diada Nacional de Cataluña', name: 'National Day of Catalonia', global: false, counties: ['ES-CT'] }
];

export async function iniciarApisExternasFalsas() {
    const estado = { caido: false, colormindCaido: false, peticiones: [] };
    const servidor = http.createServer((req, res) => {
        let cuerpo = '';
        req.on('data', (d) => { cuerpo += d; });
        req.on('end', () => {
            estado.peticiones.push({ metodo: req.method, url: req.url, cuerpo });
            const json = (codigo, datos) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)); };
            if (req.url.startsWith('/colormind')) {
                if (estado.colormindCaido) return json(500, { error: 'caído' });
                // Colormind real: { model, input: [[r,g,b], "N", ...] } → { result: [[r,g,b] × 5] }
                const { input } = JSON.parse(cuerpo || '{}');
                const [r, g, b] = Array.isArray(input?.[0]) ? input[0] : [0, 0, 0];
                return json(200, { result: [[r, g, b], [240, 240, 235], [60, 120, 200], [250, 180, 60], [30, 30, 40]] });
            }
            if (estado.caido) return json(500, { error: 'caído' });
            if (req.url === '/api/v3/AvailableCountries') return json(200, [{ countryCode: 'CO', name: 'Colombia' }, { countryCode: 'ES', name: 'Spain' }]);
            const m = /^\/api\/v3\/PublicHolidays\/(\d{4})\/([A-Z]{2})$/.exec(req.url);
            if (m) {
                const año = m[1];
                const lista = m[2] === 'CO' ? NACIONALES_CO : m[2] === 'ES' ? ESPANA : null;
                if (!lista) { res.writeHead(204); return res.end(); }
                return json(200, lista.map((f) => ({ ...f, date: f.date.replace('2026', año), countryCode: m[2] })));
            }
            json(404, { error: 'no encontrado' });
        });
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    return {
        base, estado,
        variablesEntorno: { NAGER_API_URL: base, COLORMIND_API_URL: `${base}/colormind/api/` },
        cerrar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); })
    };
}
