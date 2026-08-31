import crypto from 'node:crypto';

/*
 * El servidor escucha en toda la red para que el móvil llegue, y en un centro
 * educativo eso es una wifi con mucha gente. La máquina donde corre la
 * aplicación se considera de confianza; cualquier otra necesita el token.
 */
export const newToken = () => crypto.randomBytes(6).toString('hex');

export function isLocal(req) {
	const a = req.socket?.remoteAddress || '';
	return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** Comparación en tiempo constante, que el token viaja en una URL pública. */
export function tokenOk(given, expected) {
	if (typeof given !== 'string' || given.length !== expected.length) return false;
	return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function allowed(req, url, token) {
	if (isLocal(req)) return true;
	return tokenOk(url.searchParams.get('t') || '', token);
}
