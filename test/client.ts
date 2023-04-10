import { promisify } from 'util';

import { simpleParser } from 'mailparser';
import type { ParsedMail, AddressObject } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import type { MessageHeaders } from '../mod.ts';
import {
	DEFAULT_TIMEOUT,
	SMTPClient,
	Message,
	isRFC2822Date,
} from '../mod.ts';

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

async function send(headers: Partial<MessageHeaders>) {
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

test.before(() => {
	server.listen(port, t.pass);
});
test.after(() => {
	server.close(t.pass);
});

Deno.test('client invokes callback exactly once for invalid connection', () => {
	const msg = {
		from: 'foo@bar.baz',
		to: 'foo@bar.baz',
		subject: 'hello world',
		text: 'hello world',
	};
	await t.notThrowsAsync(
		new Promise<void>((resolve, reject) => {
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
		})
	);
});

Deno.test('client has a default connection timeout', () => {
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

Deno.test('client deduplicates recipients', () => {
	const msg = {
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		cc: 'gannon@gmail.com',
		bcc: 'gannon@gmail.com',
	};
	const stack = client.createMessageStack(new Message(msg));
	t.true(stack.to.length === 1);
	assertEquals(stack.to[ 0 ].address, 'gannon@gmail.com');
});

Deno.test('client accepts array recipients', () => {
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

	t.true(isValid);
	assertEquals(stack.to.length, 3);
	t.deepEqual(
		stack.to.map((x) => x.address),
		[ 'gannon1@gmail.com', 'gannon2@gmail.com', 'gannon3@gmail.com' ]
	);
});

Deno.test('client accepts array sender', () => {
	const msg = new Message({
		from: [ 'zelda@gmail.com' ],
		to: [ 'gannon1@gmail.com' ],
	});
	msg.header.from = [ msg.header.from as string ];

	const { isValid } = msg.checkValidity();
	t.true(isValid);
});

Deno.test('client rejects message without `from` header', () => {
	const error = await t.throwsAsync(
		send({
			subject: 'this is a test TEXT message from emailjs',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		})
	);
	assertEquals(error?.message, 'Message must have a `from` header');
});

Deno.test('client rejects message without `to`, `cc`, or `bcc` header', () => {
	const error = await t.throwsAsync(
		send({
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		})
	);
	assertEquals(
		error?.message,
		'Message must have at least one `to`, `cc`, or `bcc` header'
	);
});

Deno.test('client allows message with only `cc` recipient header', () => {
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

Deno.test('client allows message with only `bcc` recipient header', () => {
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

Deno.test('client constructor throws if `password` supplied without `user`', () => {
	t.notThrows(() => new SMTPClient({ user: 'anything', password: 'anything' }));
	t.throws(() => new SMTPClient({ password: 'anything' }));
	t.throws(
		() =>
			new SMTPClient({ username: 'anything', password: 'anything' } as Record<
				string,
				unknown
			>)
	);
});

Deno.test('client supports greylisting', () => {
	t.plan(3);

	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	const greylistServer = new SMTPServer({
		secure: true,
		onRcptTo(_address, _session, callback) {
			t.pass();
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
			t.pass();
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
	await t.notThrowsAsync(
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
});

Deno.test('client only responds once to greylisting', () => {
	t.plan(4);

	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	const greylistServer = new SMTPServer({
		secure: true,
		onRcptTo(_address, _session, callback) {
			t.pass();
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
	const error = await t.throwsAsync(
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
	assertEquals(error?.message, "bad response on command 'RCPT': greylist");
});

Deno.test('client send can have result awaited when promisified', () => {
	// bind necessary to retain internal access to client prototype
	const sendAsync = promisify(client.send.bind(client));

	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	try {
		const message = (await sendAsync(new Message(msg))) as Message;
		t.true(message instanceof Message);
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
		t.deepEqual(message.attachments, []);
		t.true(isRFC2822Date(message.header.date as string));
		t.regex(message.header[ 'message-id' ] as string, /^<.*[@]{1}.*>$/);
	} catch (err) {
		if (err instanceof Error) {
			t.fail(err.message);
		} else if (typeof err === 'string') {
			t.fail(err);
		} else {
			t.fail();
		}
	}
});

Deno.test('client sendAsync can have result awaited', () => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	try {
		const message = await client.sendAsync(new Message(msg));
		t.true(message instanceof Message);
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
		t.deepEqual(message.attachments, []);
		t.true(isRFC2822Date(message.header.date as string));
		t.regex(message.header[ 'message-id' ] as string, /^<.*[@]{1}.*>$/);
	} catch (err) {
		if (err instanceof Error) {
			t.fail(err.message);
		} else if (typeof err === 'string') {
			t.fail(err);
		} else {
			t.fail();
		}
	}
});

Deno.test('client sendAsync can have error caught when awaited', () => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	try {
		const invalidClient = new SMTPClient({ host: 'bar.baz' });
		const message = await invalidClient.sendAsync(new Message(msg));
		t.true(message instanceof Message);
		t.fail();
	} catch (err) {
		t.true(err instanceof Error);
		t.pass();
	}
});
