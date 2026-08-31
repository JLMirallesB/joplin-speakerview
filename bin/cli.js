#!/usr/bin/env node
import { spawn } from 'node:child_process';
import os from 'node:os';
import { openLibrary } from '../src/library.js';
import { createServer } from '../src/server.js';
import { attachSockets } from '../src/sockets.js';
import { findFontDir, countFonts, findJoplinTheme } from '../src/fonts.js';
import { watchLibrary } from '../src/watch.js';
import { newToken } from '../src/auth.js';

/* "16:9" mantiene el alto de reveal y ensancha; "1600x900" fija ambos. */
function parseSize(v) {
	if (!v) return null;
	let m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(v.trim());
	if (m) return { width: +m[1], height: +m[2] };
	m = /^(\d+)\s*[:/]\s*(\d+)$/.exec(v.trim());
	if (m) {
		const height = 700;                       // el alto por defecto de reveal
		return { width: Math.round(height * (+m[1] / +m[2])), height };
	}
	throw new Error(`No entiendo --size ${v}. Usa 16:9 o 1600x900.`);
}

function parseArgs(argv) {
	const opts = { target: null, port: 7777, host: '0.0.0.0', open: true, fit: true, watch: true };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--port' || a === '-p') opts.port = parseInt(argv[++i], 10);
		else if (a === '--host') opts.host = argv[++i];
		else if (a === '--no-open') opts.open = false;
		else if (a === '--fonts') opts.fonts = argv[++i];
		else if (a === '--no-fit') opts.fit = false;
		else if (a === '--size') opts.size = parseSize(argv[++i]);
		else if (a === '--margin') opts.margin = parseFloat(argv[++i]);
		else if (a === '--no-watch') opts.watch = false;
		else if (a === '-h' || a === '--help') opts.help = true;
		else if (!a.startsWith('-')) opts.target = a;
	}
	return opts;
}

const HELP = `
joplin-speakerview — speaker view para presentaciones reveal.js exportadas de Joplin

  joplin-speakerview <ruta> [opciones]

  <ruta>        Un .html exportado, o una carpeta que contenga varios.
                Por defecto, la carpeta actual.

  -p, --port    Puerto (7777 por defecto; si está ocupado, prueba el siguiente)
      --host    Interfaz de escucha (0.0.0.0 por defecto)
      --no-open No abrir el navegador
      --fonts   Carpeta con las fuentes del plugin (por defecto, la caché de
                Joplin; el HTML exportado no las incluye)
      --no-fit  No encoger los títulos que no caben (reveal los partirá por
                la mitad de una palabra, como hace por defecto)
      --size    Lienzo de la presentación: 16:9, 16:10 o 1600x900.
                Por defecto reveal usa 960x700 (4:2,9), que en una pantalla
                16:9 deja un 26 % del ancho sin usar.
      --margin  Margen alrededor del lienzo (reveal usa 0.04)
      --no-watch  No recargar las ventanas al reexportar desde Joplin
  -h, --help    Esta ayuda
`;

function openBrowser(url) {
	const cmd = process.platform === 'darwin' ? 'open'
		: process.platform === 'win32' ? 'start' : 'xdg-open';
	spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

function lanAddress() {
	for (const list of Object.values(os.networkInterfaces())) {
		for (const ni of list || []) {
			if (ni.family === 'IPv4' && !ni.internal) return ni.address;
		}
	}
	return null;
}

function listen(server, port, host, attempts = 12) {
	return new Promise((resolve, reject) => {
		const tryPort = (p, left) => {
			const onError = (err) => {
				server.removeListener('error', onError);
				if (err.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
				else reject(err);
			};
			server.once('error', onError);
			server.listen(p, host, () => {
				server.removeListener('error', onError);
				resolve(p);
			});
		};
		tryPort(port, attempts);
	});
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(HELP); process.exit(0); }

try {
	const { root, decks, initialId } = await openLibrary(opts.target || process.cwd());
	const fontDir = await findFontDir(opts.fonts);
	const themeCss = opts.fonts ? null : await findJoplinTheme();
	const size = opts.size || (opts.margin !== undefined ? {} : null);
	if (size && opts.margin !== undefined) size.margin = opts.margin;
	const token = newToken();
	const lan = lanAddress();
	const server0 = createServer({ root, decks, fontDir, themeCss, fit: opts.fit, size, token,
		lanUrl: null });   // la URL de red necesita el puerto, que aún no sabemos
	const { server } = server0;
	const sockets = attachSockets(server, { decks, token });

	const port = await listen(server, opts.port, opts.host);
	const local = `http://localhost:${port}`;
	if (lan) server0.setLanUrl(`http://${lan}:${port}`);

	console.log(`\n  joplin-speakerview`);
	console.log(`  biblioteca   ${root}`);
	console.log(`  encontradas  ${decks.length} ${decks.length === 1 ? 'presentación' : 'presentaciones'}`);
	const nFonts = await countFonts(fontDir);
	console.log(`  fuentes      ${nFonts ? `${nFonts} de la caché de Joplin` : 'NO ENCONTRADAS — los títulos saldrán en Helvetica'}`);
	console.log(`  local        ${local}`);
	if (lan) console.log(`  en la red    http://${lan}:${port}  (el mando del móvil, con su token, sale del botón «Móvil»)`);

	if (initialId) {
		const deck = decks.find((d) => d.id === initialId);
		console.log(`\n  → ${deck.label}`);
		console.log(`     presentación  ${local}/present/${deck.id}`);
		console.log(`     speaker view  ${local}/speaker/${deck.id}\n`);
		if (opts.open) {
			openBrowser(`${local}/present/${deck.id}`);
			setTimeout(() => openBrowser(`${local}/speaker/${deck.id}`), 700);
		}
	} else {
		console.log(`\n  Varias presentaciones: elige en ${local}\n`);
		if (opts.open) openBrowser(local);
	}

	if (opts.watch) {
		const w = watchLibrary(root, () => {
			console.log(`  · reexportación detectada, recargando`);
			sockets.reloadAll();
		});
		if (w.error) console.log(`  aviso        no puedo vigilar la carpeta (${w.error.code})`);
	}

	console.log(`  Ctrl-C para parar.\n`);
} catch (err) {
	console.error(`\n  ${err.message}\n`);
	process.exit(1);
}
