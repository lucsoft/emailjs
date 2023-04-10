import { promisify } from 'node:util';

import { simpleParser } from 'npm:mailparser';
import type { ParsedMail, AddressObject } from 'npm:mailparser';
import { SMTPServer } from 'npm:smtp-server';

import type { MessageHeaders } from '../mod.ts';
import {
	DEFAULT_TIMEOUT,
	SMTPClient,
	Message,
	isRFC2822Date,
} from '../mod.ts';
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.182.0/testing/asserts.ts";
import { afterAll, beforeAll, describe, it } from 'https://deno.land/std@0.182.0/testing/bdd.ts';

const parseMap = new Map<string, ParsedMail>();
const port = 3333;
let greylistPort = 4444;

const client = new SMTPClient({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
const server = new SMTPServer({
	secure: true,
	onAuth(auth, _session, callback) {
		if (auth.username === 'pooh' && auth.password === 'honey') {
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

		parseMap.set(mail.subject as string, mail);
		callback();
	},
});

function send(headers: Partial<MessageHeaders>) {
	return new Promise<ParsedMail>((resolve, reject) => {
		client.send(new Message(headers), (err) => {
			if (err) {
				reject(err);
			} else {
				resolve(parseMap.get(headers.subject as string) as ParsedMail);
			}
		});
	});
}
describe("Client", () => {

	beforeAll(() => {
		server.listen(port);
	});
	afterAll(() => {
		server.close();
	});


	it('client invokes callback exactly once for invalid connection', async () => {
		const msg = {
			from: 'foo@bar.baz',
			to: 'foo@bar.baz',
			subject: 'hello world',
			text: 'hello world',
		};
		await new Promise<void>((resolve, reject) => {
			let counter = 0;
			const invalidClient = new SMTPClient({ host: 'bar.baz' });
			const incrementCounter = () => {
				if (counter > 0) {
					reject();
				} else {
					counter++;
				}
			};
			invalidClient.send(new Message(msg), (err) => {
				if (err == null) {
					reject();
				} else {
					incrementCounter();
				}
			});
			// @ts-expect-error the error event is only accessible from the protected socket property
			invalidClient.smtp.sock.once('error', () => {
				if (counter === 1) {
					resolve();
				} else {
					reject();
				}
			});
		});
	});

	it('client has a default connection timeout', () => {
		const connectionOptions = {
			user: 'username',
			password: 'password',
			host: '127.0.0.1',
			port: 1234,
			timeout: undefined as number | null | undefined,
		};
		assertEquals(new SMTPClient(connectionOptions).smtp.timeout, DEFAULT_TIMEOUT);

		connectionOptions.timeout = null;
		assertEquals(new SMTPClient(connectionOptions).smtp.timeout, DEFAULT_TIMEOUT);

		connectionOptions.timeout = undefined;
		assertEquals(new SMTPClient(connectionOptions).smtp.timeout, DEFAULT_TIMEOUT);
	});

	it('client deduplicates recipients', () => {
		const msg = {
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			cc: 'gannon@gmail.com',
			bcc: 'gannon@gmail.com',
		};
		const stack = client.createMessageStack(new Message(msg));
		assert(stack.to.length === 1);
		assertEquals(stack.to[ 0 ].address, 'gannon@gmail.com');
	});

	it('client accepts array recipients', () => {
		const msg = new Message({
			from: 'zelda@gmail.com',
			to: [ 'gannon1@gmail.com' ],
			cc: [ 'gannon2@gmail.com' ],
			bcc: [ 'gannon3@gmail.com' ],
		});

		msg.header.to = [ msg.header.to as string ];
		msg.header.cc = [ msg.header.cc as string ];
		msg.header.bcc = [ msg.header.bcc as string ];

		const { isValid } = msg.checkValidity();
		const stack = client.createMessageStack(msg);

		assert(isValid);
		assertEquals(stack.to.length, 3);
		assertEquals(
			stack.to.map((x) => x.address),
			[ 'gannon1@gmail.com', 'gannon2@gmail.com', 'gannon3@gmail.com' ]
		);
	});

	it('client accepts array sender', () => {
		const msg = new Message({
			from: [ 'zelda@gmail.com' ],
			to: [ 'gannon1@gmail.com' ],
		});
		msg.header.from = [ msg.header.from as string ];

		const { isValid } = msg.checkValidity();
		assert(isValid);
	});

	it('client rejects message without `from` header', async () => {
		await assertRejects(() =>
			send({
				subject: 'this is a test TEXT message from emailjs',
				text: "It is hard to be brave when you're only a Very Small Animal.",
			})
		);
		// assertEquals(error?.message, 'Message must have a `from` header');
	});

	it('client rejects message without `to`, `cc`, or `bcc` header', async () => {
		await assertRejects(() =>
			send({
				subject: 'this is a test TEXT message from emailjs',
				from: 'piglet@gmail.com',
				text: "It is hard to be brave when you're only a Very Small Animal.",
			})
		);
		// assertEquals(
		// 	error?.message,
		// 	'Message must have at least one `to`, `cc`, or `bcc` header'
		// );
	});

	it('client allows message with only `cc` recipient header', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			cc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const mail = await send(msg);
		assertEquals(mail.text, msg.text + '\n\n\n');
		assertEquals(mail.subject, msg.subject);
		assertEquals(mail.from?.text, msg.from);
		assertEquals((mail.cc as AddressObject).text, msg.cc);
	});

	it('client allows message with only `bcc` recipient header', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const mail = await send(msg);
		assertEquals(mail.text, msg.text + '\n\n\n');
		assertEquals(mail.subject, msg.subject);
		assertEquals(mail.from?.text, msg.from);
		assertEquals(mail.bcc, undefined);
	});

	it('client constructor throws if `password` supplied without `user`', () => {
		new SMTPClient({ user: 'anything', password: 'anything' });

		assertThrows(() => new SMTPClient({ password: 'anything' }));
		assertThrows(
			() =>
				new SMTPClient({ username: 'anything', password: 'anything' } as Record<
					string,
					unknown
				>)
		);
	});

	it('client supports greylisting', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const greylistServer = new SMTPServer({
			secure: true,
			onRcptTo(_address, _session, callback) {
				callback();
			},
			onAuth(auth, _session, callback) {
				if (auth.username === 'pooh' && auth.password === 'honey') {
					callback(null, { user: 'pooh' });
				} else {
					return callback(new Error('invalid user / pass'));
				}
			},
		});

		const { onRcptTo } = greylistServer;
		greylistServer.onRcptTo = (_address, _session, callback) => {
			greylistServer.onRcptTo = (a, s, cb) => {
				const err = new Error('greylist');
				(err as never as { responseCode: number; }).responseCode = 450;
				greylistServer.onRcptTo = onRcptTo;
				onRcptTo(a, s, cb);
			};

			const err = new Error('greylist');
			(err as never as { responseCode: number; }).responseCode = 450;
			callback(err);
		};

		const p = greylistPort++;
		await new Promise<void>((resolve, reject) => {
			greylistServer.listen(p, () => {
				new SMTPClient({
					port: p,
					user: 'pooh',
					password: 'honey',
					ssl: true,
				}).send(new Message(msg), (err) => {
					greylistServer.close();
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		});
	});

	it('client only responds once to greylisting', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const greylistServer = new SMTPServer({
			secure: true,
			onRcptTo(_address, _session, callback) {
				const err = new Error('greylist');
				(err as never as { responseCode: number; }).responseCode = 450;
				callback(err);
			},
			onAuth(auth, _session, callback) {
				if (auth.username === 'pooh' && auth.password === 'honey') {
					callback(null, { user: 'pooh' });
				} else {
					return callback(new Error('invalid user / pass'));
				}
			},
		});

		const p = greylistPort++;
		const error = await assertRejects(() =>
			new Promise<void>((resolve, reject) => {
				greylistServer.listen(p, () => {
					new SMTPClient({
						port: p,
						user: 'pooh',
						password: 'honey',
						ssl: true,
					}).send(new Message(msg), (err) => {
						greylistServer.close();
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				});
			})
		);
		// assertEquals(error?.message, "bad response on command 'RCPT': greylist");
	});

	it('client send can have result awaited when promisified', async () => {
		// bind necessary to retain internal access to client prototype
		const sendAsync = promisify(client.send.bind(client));

		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const message = (await sendAsync(new Message(msg))) as Message;
		assert(message instanceof Message);
		t.like(message, {
			alternative: null,
			content: 'text/plain; charset=utf-8',
			text: "It is hard to be brave when you're only a Very Small Animal.",
			header: {
				bcc: 'pooh@gmail.com',
				from: 'piglet@gmail.com',
				subject: '=?UTF-8?Q?this_is_a_test_TEXT_message_from_emailjs?=',
			},
		});
		assertEquals(message.attachments, []);
		assert(isRFC2822Date(message.header.date as string));
		t.regex(message.header[ 'message-id' ] as string, /^<.*[@]{1}.*>$/);

	});

	it('client sendAsync can have result awaited', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const message = await client.sendAsync(new Message(msg));
		assert(message instanceof Message);
		// t.like(message, {
		// 	alternative: null,
		// 	content: 'text/plain; charset=utf-8',
		// 	text: "It is hard to be brave when you're only a Very Small Animal.",
		// 	header: {
		// 		bcc: 'pooh@gmail.com',
		// 		from: 'piglet@gmail.com',
		// 		subject: '=?UTF-8?Q?this_is_a_test_TEXT_message_from_emailjs?=',
		// 	},
		// });
		assertEquals(message.attachments, []);
		assert(isRFC2822Date(message.header.date as string));
		// t.regex(message.header[ 'message-id' ] as string, /^<.*[@]{1}.*>$/);

	});

	it('client sendAsync can have error caught when awaited', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		await assertRejects(async () => {
			const invalidClient = new SMTPClient({ host: 'bar.baz' });
			const message = await invalidClient.sendAsync(new Message(msg));
			assert(message instanceof Message);
		});
	});

});
