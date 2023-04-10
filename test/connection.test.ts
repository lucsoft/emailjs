
import { assertEquals } from "https://deno.land/std@0.182.0/testing/asserts.ts";
import { SMTPConnection } from '../mod.ts';

Deno.test('accepts a custom logger', () => {
	const logger = () => {
		/** ø */
	};
	const connection = new SMTPConnection({ logger });
	assertEquals(Reflect.get(connection, 'log'), logger);
});
