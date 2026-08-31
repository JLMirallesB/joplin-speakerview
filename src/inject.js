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
/*
 * El plugin lee las opciones de reveal de un <rjs-config> que viva en la nota, y
 * lo aplica por encima de todo lo demás. Inyectarlo aquí permite cambiar el
 * lienzo sin tocar la nota; para que Joplin lo vea igual, hay que ponerlo en la
 * nota. Los hijos los borra el plugin al leerlos.
 */
function configBlock(size) {
	if (!size) return '';
	const parts = [];
	if (size.width) parts.push(`<rjs-width>${size.width}</rjs-width>`);
	if (size.height) parts.push(`<rjs-height>${size.height}</rjs-height>`);
	if (size.margin !== undefined) parts.push(`<rjs-margin>${size.margin}</rjs-margin>`);
	return parts.length ? `<rjs-config style="display:none">${parts.join('')}</rjs-config>\n` : '';
}

export async function renderDeck(deck, { role = 'deck', fit = true, size = null, token = '' } = {}) {
	const html = await fs.readFile(deck.absPath, 'utf8');

	const base = `<base href="/lib/${encodePath(deck.relDir)}">`;
	const bootstrap =
		`<link rel="stylesheet" href="/_sv/joplin-vars.css">\n` +
		`<script>window.__SV__=${JSON.stringify({ deckId: deck.id, role, fit, token })};</script>\n` +
		`<script src="/_sv/client.js" defer></script>\n`;

	let out = html;

	const headOpen = out.match(/<head[^>]*>/i);
	if (headOpen) {
		const at = headOpen.index + headOpen[0].length;
		out = out.slice(0, at) + '\n' + base + out.slice(at);
	} else {
		out = base + out;
	}

	// Tiene que ir dentro de #rendered-md: es lo único que el plugin lee como
	// contenido de la presentación.
	//
	// Si la nota ya trae su propio <rjs-config>, manda ella y no inyectamos
	// nada: el plugin resuelve cada opción con querySelector, o sea el primero
	// del documento, y como inyectamos al principio le ganaríamos siempre.
	const cfg = out.search(/<rjs-config[\s>]/i) === -1 ? configBlock(size) : '';
	if (cfg) {
		const anchor = out.search(/<div id="rendered-md">/i);
		if (anchor !== -1) {
			const at = out.indexOf('>', anchor) + 1;
			out = out.slice(0, at) + cfg + out.slice(at);
		}
	}

	const headClose = out.search(/<\/head>/i);
	if (headClose !== -1) {
		out = out.slice(0, headClose) + bootstrap + out.slice(headClose);
	} else {
		out += bootstrap;
	}

	return out;
}
