/* Levanta el servidor contra una presentación de prueba, pasa las dos suites y
 * lo apaga. Ruta por defecto: la carpeta que exporta el plugin en el Escritorio.
 *
 *   node test/run.js [carpeta-o-html]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || process.env.SV_FIXTURE || path.join(process.env.HOME, 'Desktop', 'presentation');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Si ya hay algo escuchando, las pruebas hablarían con ese servidor y no con
// el nuestro, que se iría al puerto siguiente. Pasó, y costó de ver: un
// servidor viejo con estado sucio hacía fallar comprobaciones al azar.
const ocupado = await fetch('http://localhost:7777/api/library').then(() => true).catch(() => false);
if (ocupado) {
	console.error('El puerto 7777 ya está ocupado. Párala antes:\n' +
		'  pkill -f joplin-speakerview\n');
	process.exit(1);
}

const server = spawn('node', [path.join(ROOT, 'bin', 'cli.js'), target, '--no-open', '--port', '7777'],
	{ cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
let banner = '';
server.stdout.on('data', (b) => { banner += b.toString(); });

let up = false;
for (let i = 0; i < 40 && !up; i++) {
	await sleep(250);
	up = await fetch('http://localhost:7777/api/library').then((r) => r.ok).catch(() => false);
}
if (!up) { console.error('el servidor no arrancó\n' + banner); server.kill(); process.exit(1); }

let failed = 0;
for (const suite of ['e2e.js', 'speaker.js', 'features.js']) {
	console.log(`\n── ${suite}`);
	await sleep(1500);   // que la suite anterior suelte sus WebSocket
	const code = await new Promise((res) => {
		spawn('node', [path.join(ROOT, 'test', suite)], { cwd: ROOT, stdio: 'inherit' }).on('exit', res);
	});
	if (code !== 0) failed++;
}

server.kill();
process.exit(failed ? 1 : 0);
