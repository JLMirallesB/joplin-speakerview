import fs from 'node:fs/promises';
import path from 'node:path';

// Marca que el exportador del plugin revealjs deja siempre en el <head>.
// Es una comprobación de contenido, no de nombre: hay exports HTML normales
// de Joplin que también acaban en .html y no son presentaciones.
const MARKER = 'window.presentationSettings';
const SNIFF_BYTES = 65536;
const SKIP_DIRS = new Set(['_resources', 'pluginAssets', 'node_modules']);

async function isPresentation(absPath) {
	let fh;
	try {
		fh = await fs.open(absPath, 'r');
		const { buffer, bytesRead } = await fh.read({ buffer: Buffer.alloc(SNIFF_BYTES) });
		return buffer.subarray(0, bytesRead).toString('utf8').includes(MARKER);
	} catch {
		return false;
	} finally {
		await fh?.close();
	}
}

// Los recursos se referencian con rutas relativas que salen de la carpeta de la
// nota (../../../_resources/…), así que la raíz que hay que servir no es la
// carpeta del HTML sino la que contiene _resources.
async function findLibraryRoot(startDir) {
	let dir = startDir;
	for (let i = 0; i < 8; i++) {
		try {
			const st = await fs.stat(path.join(dir, '_resources'));
			if (st.isDirectory()) return dir;
		} catch { /* seguimos subiendo */ }
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return startDir;
}

async function* walk(dir, depth = 0) {
	if (depth > 12) return;
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.name.startsWith('.')) continue;
		const abs = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue;
			yield* walk(abs, depth + 1);
		} else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
			yield abs;
		}
	}
}

function describe(root, absPath, index) {
	const relPath = path.relative(root, absPath);
	const title = path.basename(absPath).replace(/\.presentation\.html$/i, '').replace(/\.html$/i, '');
	const relDir = path.dirname(relPath);
	const notebook = relDir === '.' ? '' : relDir.split(path.sep).join(' › ');
	return {
		id: `d${index}`,
		absPath,
		relPath,
		relDir: relDir === '.' ? '' : relDir,
		title,
		notebook,
		label: notebook ? `${notebook} › ${title}` : title,
	};
}

/**
 * Resuelve el objetivo que llega por CLI (un .html suelto o una carpeta) a
 * { root, decks, initialId }. `root` es lo que servirá el servidor estático.
 */
export async function openLibrary(target) {
	const abs = path.resolve(target);
	const st = await fs.stat(abs).catch(() => null);
	if (!st) throw new Error(`No existe la ruta: ${abs}`);

	let root;
	let pinned = null;
	if (st.isFile()) {
		if (!(await isPresentation(abs))) {
			throw new Error(`Ese HTML no parece una presentación exportada del plugin revealjs:\n  ${abs}`);
		}
		root = await findLibraryRoot(path.dirname(abs));
		pinned = abs;
	} else {
		root = abs;
	}

	const found = [];
	for await (const file of walk(root)) {
		if (await isPresentation(file)) found.push(file);
	}
	if (pinned && !found.includes(pinned)) found.push(pinned);
	found.sort((a, b) => a.localeCompare(b, 'es'));

	const decks = found.map((f, i) => describe(root, f, i));
	if (!decks.length) {
		throw new Error(`No he encontrado ninguna presentación exportada bajo:\n  ${root}`);
	}

	const initialId = pinned
		? decks.find((d) => d.absPath === pinned).id
		: (decks.length === 1 ? decks[0].id : null);

	return { root, decks, initialId };
}
