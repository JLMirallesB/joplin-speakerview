import fs from 'node:fs/promises';

/** Percent-encode por segmentos: las rutas de Joplin traen espacios y emoji. */
export function encodePath(relDir) {
	if (!relDir) return '';
	return relDir.split('/').map(encodeURIComponent).join('/') + '/';
}

/**
 * Inyecta en el HTML exportado, en memoria y sin tocar el fichero de disco:
 *
 *  1. <base> justo tras <head>, para que las rutas relativas del export
 *     (pluginAssets/…, ../../../_resources/…) resuelvan contra /lib/ y no
 *     contra /present/<id>.
 *  2. Las variables --joplin-* que el exportador se deja, y sin las cuales
 *     el tema match-joplin cae al fallback blanco.
 *  3. El puente de sincronía.
 *
 * El <base> tiene que ir antes que cualquier elemento con URL relativa, y en
 * este export el primero es el <link> de highlight.js, que va pegado al <head>.
 */
export async function renderDeck(deck, { role = 'deck' } = {}) {
	const html = await fs.readFile(deck.absPath, 'utf8');

	const base = `<base href="/lib/${encodePath(deck.relDir)}">`;
	const bootstrap =
		`<link rel="stylesheet" href="/_sv/joplin-vars.css">\n` +
		`<script>window.__SV__=${JSON.stringify({ deckId: deck.id, role })};</script>\n` +
		`<script src="/_sv/client.js" defer></script>\n`;

	let out = html;

	const headOpen = out.match(/<head[^>]*>/i);
	if (headOpen) {
		const at = headOpen.index + headOpen[0].length;
		out = out.slice(0, at) + '\n' + base + out.slice(at);
	} else {
		out = base + out;
	}

	const headClose = out.search(/<\/head>/i);
	if (headClose !== -1) {
		out = out.slice(0, headClose) + bootstrap + out.slice(headClose);
	} else {
		out += bootstrap;
	}

	return out;
}
