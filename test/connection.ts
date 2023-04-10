
import { SMTPConnection } from '../mod.ts';

Deno.test('accepts a custom logger', () => {
	const logger = () => {
		/** ø */
	};
	const connection = new SMTPConnection({ logger });
	assertEquals(Reflect.get(connection, 'log'), logger);
});
