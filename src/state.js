/**
 * Estado autoritativo de cada presentación. El servidor manda: las ventanas
 * piden ("cmd"), el servidor ordena a las ventanas de presentación ("exec"),
 * y sólo cuando reveal confirma el movimiento ("report") se difunde el estado.
 *
 * Ese rodeo es lo que evita el eco: quien reporta no recibe órdenes de su
 * propio movimiento, y las ventanas de presentación ignoran "state" por
 * completo — sólo obedecen "exec".
 */
export function createState(deckId) {
	return {
		deckId,
		h: 0,
		v: 0,
		f: -1,
		fragCount: 0,
		paused: false,
		overview: false,
		outline: null,
		timer: { running: false, startedAt: null, accumulated: 0, targetMin: null },
		rev: 0,
	};
}

export function snapshot(s) {
	return {
		deckId: s.deckId,
		h: s.h, v: s.v, f: s.f,
		fragCount: s.fragCount,
		paused: s.paused,
		overview: s.overview,
		timer: s.timer,
		rev: s.rev,
		// Reloj del servidor: el mando del móvil puede ir desfasado y el
		// cronómetro tiene que contar lo mismo en las dos pantallas.
		now: Date.now(),
	};
}

export function applyReport(s, msg) {
	s.h = msg.h ?? s.h;
	s.v = msg.v ?? s.v;
	s.f = typeof msg.f === 'number' ? msg.f : s.f;
	s.fragCount = msg.fragCount ?? s.fragCount;
	if (typeof msg.paused === 'boolean') s.paused = msg.paused;
	if (typeof msg.overview === 'boolean') s.overview = msg.overview;
	s.rev++;
}

const now = () => Date.now();

export function elapsedMs(t) {
	return t.accumulated + (t.running && t.startedAt ? now() - t.startedAt : 0);
}

export function applyTimer(s, action, value) {
	const t = s.timer;
	switch (action) {
		case 'start':
			if (!t.running) { t.running = true; t.startedAt = now(); }
			break;
		case 'pause':
			if (t.running) { t.accumulated = elapsedMs(t); t.running = false; t.startedAt = null; }
			break;
		case 'toggle':
			return applyTimer(s, t.running ? 'pause' : 'start');
		case 'reset':
			t.running = false; t.startedAt = null; t.accumulated = 0;
			break;
		case 'target':
			t.targetMin = Number.isFinite(value) && value > 0 ? value : null;
			break;
	}
	s.rev++;
}

/**
 * Siguiente paso real de la presentación: el próximo fragment si queda alguno,
 * y si no la diapositiva siguiente (bajando por las verticales cuando las hay).
 * Se calcula sobre el outline que reporta el propio reveal, no sobre una
 * relectura del HTML, para no discrepar nunca de sus índices.
 */
export function nextStep(outline, h, v, f, fragCount) {
	if (fragCount > 0 && f + 1 < fragCount) return { h, v, f: f + 1 };
	if (!outline || !outline.length) return { h: h + 1, v: 0, f: -1 };
	const i = outline.findIndex((s) => s.h === h && s.v === v);
	if (i === -1 || i + 1 >= outline.length) return null;
	const n = outline[i + 1];
	return { h: n.h, v: n.v, f: -1 };
}
