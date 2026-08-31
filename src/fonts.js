import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ID = 'io.github.personalizedrefrigerator.revealjs-integration';

/*
 * El exportador del plugin no copia las fuentes. El bundle las pide por un
 * nombre de hash contra un publicPath que calcula como "directorio del script
 * + ../..", así que en el export apuntan a un sitio donde no hay nada: reveal
 * cae de Source Sans Pro a Helvetica, más ancha, y los títulos que en Joplin
 * caben aquí desbordan y parten palabras.
 *
 * Las fuentes sí están en la caché de plugins de Joplin, que es de donde las
 * servimos.
 */
export const FONT_NAME = /^[0-9a-f]{16,40}\.(woff2?|ttf|eot|otf|svg)$/i;

function candidateDirs() {
	const home = os.homedir();
	const dirs = [
		path.join(home, '.config', 'joplin-desktop'),
		path.join(home, 'Library', 'Application Support', 'joplin-desktop'),
		path.join(home, '.joplin-desktop'),
	];
	if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'joplin-desktop'));
	return dirs.map((d) => path.join(d, 'cache', PLUGIN_ID));
}

/** Devuelve el directorio con las fuentes del plugin, o null si no aparece. */
export async function findFontDir(override) {
	const tries = override ? [path.resolve(override)] : candidateDirs();
	for (const dir of tries) {
		try {
			const files = await fs.readdir(dir);
			if (files.some((f) => FONT_NAME.test(f))) return dir;
		} catch { /* siguiente */ }
	}
	return null;
}

export async function countFonts(dir) {
	if (!dir) return 0;
	const files = await fs.readdir(dir).catch(() => []);
	return files.filter((f) => FONT_NAME.test(f)).length;
}

/** Las variables --joplin-*, que el exportador tampoco incluye. */
export async function findJoplinTheme() {
	const home = os.homedir();
	const bases = [
		path.join(home, '.config', 'joplin-desktop', 'tmp'),
		path.join(home, 'Library', 'Application Support', 'joplin-desktop', 'tmp'),
	];
	if (process.env.APPDATA) bases.push(path.join(process.env.APPDATA, 'joplin-desktop', 'tmp'));
	for (const dir of bases) {
		const files = await fs.readdir(dir).catch(() => []);
		const hit = files.find((f) => f.startsWith(`plugin_${PLUGIN_ID}_theme_`) && f.endsWith('.css'));
		if (hit) return path.join(dir, hit);
	}
	return null;
}
