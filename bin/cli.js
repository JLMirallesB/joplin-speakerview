#!/usr/bin/env node
import { spawn } from 'node:child_process';
import os from 'node:os';
import { openLibrary } from '../src/library.js';
import { createServer } from '../src/server.js';
import { attachSockets } from '../src/sockets.js';

function parseArgs(argv) {
	const opts = { target: null, port: 7777, host: '0.0.0.0', open: true };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--port' || a === '-p') opts.port = parseInt(argv[++i], 10);
		else if (a === '--host') opts.host = argv[++i];
		else if (a === '--no-open') opts.open = false;
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
	const { server } = createServer({ root, decks });
	attachSockets(server, { decks });

	const port = await listen(server, opts.port, opts.host);
	const local = `http://localhost:${port}`;
	const lan = lanAddress();

	console.log(`\n  joplin-speakerview`);
	console.log(`  biblioteca   ${root}`);
	console.log(`  encontradas  ${decks.length} presentación${decks.length === 1 ? '' : 'es'}`);
	console.log(`  local        ${local}`);
	if (lan) console.log(`  en la red    http://${lan}:${port}`);

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

	console.log(`  Ctrl-C para parar.\n`);
} catch (err) {
	console.error(`\n  ${err.message}\n`);
	process.exit(1);
}
