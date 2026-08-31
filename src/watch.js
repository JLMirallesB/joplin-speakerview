import fs from 'node:fs';
import path from 'node:path';

/*
 * Vigila la biblioteca y avisa cuando cambia una presentación. El bucle de
 * trabajo pasa a ser: editas la nota, reexportas desde Joplin, y las ventanas
 * se recargan solas sin perder la diapositiva.
 *
 * fs.watch en macOS dispara varias veces por una sola escritura, y Joplin
 * reescribe el HTML y sus recursos por separado, de ahí el retardo.
 */
export function watchLibrary(root, onChange, { delay = 400 } = {}) {
	let timer = null;
	let watcher;

	const fire = () => {
		clearTimeout(timer);
		timer = setTimeout(onChange, delay);
	};

	try {
		watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
			if (!filename) return fire();
			const name = path.basename(filename.toString());
			if (name.startsWith('.')) return;              // ficheros temporales
			fire();
		});
	} catch (err) {
		return { close() {}, error: err };
	}

	watcher.on('error', () => { /* la carpeta desapareció; no es fatal */ });
	return { close: () => { clearTimeout(timer); watcher.close(); } };
}
