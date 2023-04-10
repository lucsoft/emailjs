// @deno-types="npm:@types/mailparser"
import { simpleParser, AddressObject } from 'npm:mailparser';
// @deno-types="npm:@types/smtp-server"
import { SMTPServer } from 'npm:smtp-server';

import { AUTH_METHODS, SMTPClient, Message } from '../mod.ts';
import { assertEquals } from "https://deno.land/std@0.182.0/testing/asserts.ts";

let port = 2000;

function send(
	{
		authMethods = [],
		authOptional = false,
		secure = false,
	}: {
		authMethods?: (keyof typeof AUTH_METHODS)[];
		authOptional?: boolean;
		secure?: boolean;
	} = {}
) {
	return new Promise<void>((resolve, reject) => {

		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			to: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};
		const server = new SMTPServer({
			authMethods,
			secure: secure,
			hideSTARTTLS: !secure,
			authOptional,
			onAuth(auth, _session, callback) {
				const { accessToken, method, username, password } = auth;
				if (
					(method === AUTH_METHODS.XOAUTH2 && password != null
						? accessToken === 'pooh'
						: username === 'pooh') &&
					(method === AUTH_METHODS.XOAUTH2 && password == null
						? accessToken === 'honey'
						: password === 'honey')
				) {
					callback(null, { user: 'pooh' });
				} else {
					return callback(new Error('invalid user / pass'));
				}
			},
			async onData(stream, _session, callback: () => void) {
				const mail = await simpleParser(stream, {
					skipHtmlToText: true,
					skipTextToHtml: true,
					skipImageLinks: true,
				} as Record<string, unknown>);

				assertEquals(mail.text, msg.text + '\n\n\n');
				assertEquals(mail.subject, msg.subject);
				assertEquals(mail.from?.text, msg.from);
				assertEquals((mail.to as AddressObject).text, msg.to);

				callback();
			},
		});
		const p = port++;
		server.listen(p, () => {
			const options = Object.assign(
				{ port: p, ssl: secure, authentication: authMethods },
				authOptional ? {} : { user: 'pooh', password: 'honey' }
			);
			new SMTPClient(options).send(new Message(msg), (err) => {
				server.close(() => {
					if (err) {
						reject(err.message);
					} else {
						resolve();
					}
				});
			});
		});
	});
}

Deno.test('no authentication (unencrypted) should succeed', async () => {
	await send({ authOptional: true });
});

Deno.test('no authentication (encrypted) should succeed', async () => {
	await send({ authOptional: true, secure: true });
});

Deno.test('PLAIN authentication (unencrypted) should succeed', async () => {
	await send({ authMethods: [ AUTH_METHODS.PLAIN ] });
});

Deno.test('PLAIN authentication (encrypted) should succeed', async () => {
	await send({ authMethods: [ AUTH_METHODS.PLAIN ], secure: true });
});

Deno.test('LOGIN authentication (unencrypted) should succeed', async () => {
	await send({ authMethods: [ AUTH_METHODS.LOGIN ] });
});

Deno.test('LOGIN authentication (encrypted) should succeed', async () => {
	await send({ authMethods: [ AUTH_METHODS.LOGIN ], secure: true });
});

Deno.test('XOAUTH2 authentication (unencrypted) should succeed', async () => {
	await send({ authMethods: [ AUTH_METHODS.XOAUTH2 ] });
});

Deno.test('XOAUTH2 authentication (encrypted) should succeed', async () => {
	await send({ authMethods: [ AUTH_METHODS.XOAUTH2 ], secure: true });
});
