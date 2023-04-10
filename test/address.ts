import { addressparser } from '../mod.ts';

Deno.test('addressparser should handle single address correctly', () => {
	t.deepEqual(addressparser('andris@tr.ee'), [
		{ address: 'andris@tr.ee', name: '' },
	]);
});

Deno.test('addressparser should handle multiple addresses correctly', () => {
	t.deepEqual(addressparser('andris@tr.ee, andris@example.com'), [
		{ address: 'andris@tr.ee', name: '' },
		{ address: 'andris@example.com', name: '' },
	]);
});

Deno.test('addressparser should handle unquoted name correctly', () => {
	t.deepEqual(addressparser('andris <andris@tr.ee>'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

Deno.test('addressparser should handle quoted name correctly', () => {
	t.deepEqual(addressparser('"reinman, andris" <andris@tr.ee>'), [
		{ name: 'reinman, andris', address: 'andris@tr.ee' },
	]);
});

Deno.test('addressparser should handle quoted semicolons correctly', () => {
	t.deepEqual(addressparser('"reinman; andris" <andris@tr.ee>'), [
		{ name: 'reinman; andris', address: 'andris@tr.ee' },
	]);
});

Deno.test('addressparser should handle unquoted name, unquoted address correctly', () => {
	t.deepEqual(addressparser('andris andris@tr.ee'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

Deno.test('addressparser should handle empty group correctly', () => {
	t.deepEqual(addressparser('Undisclosed:;'), [
		{ name: 'Undisclosed', group: [] },
	]);
});

Deno.test('addressparser should handle address group correctly', () => {
	t.deepEqual(addressparser('Disclosed:andris@tr.ee, andris@example.com;'), [
		{
			name: 'Disclosed',
			group: [
				{ address: 'andris@tr.ee', name: '' },
				{ address: 'andris@example.com', name: '' },
			],
		},
	]);
});

Deno.test('addressparser should handle semicolon as a delimiter', () => {
	t.deepEqual(addressparser('andris@tr.ee; andris@example.com;'), [
		{ address: 'andris@tr.ee', name: '' },
		{ address: 'andris@example.com', name: '' },
	]);
});

Deno.test('addressparser should handle mixed group correctly', () => {
	t.deepEqual(
		addressparser(
			'Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:;'
		),
		[
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{ address: 'andris@tr.ee', name: '' },
					{ address: 'andris@example.com', name: '' },
				],
			},
			{ name: 'Undisclosed', group: [] },
		]
	);
});

Deno.test('addressparser semicolon as delimiter should not break group parsing ', () => {
	t.deepEqual(
		addressparser(
			'Test User <test.user@mail.ee>; Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com;'
		),
		[
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{
						address: 'andris@tr.ee',
						name: '',
					},
					{
						address: 'andris@example.com',
						name: '',
					},
				],
			},
			{ name: 'Undisclosed', group: [] },
			{ address: 'bob@example.com', name: '' },
		]
	);
});

Deno.test('addressparser should handle name from comment correctly', () => {
	t.deepEqual(addressparser('andris@tr.ee (andris)'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

Deno.test('addressparser should handle skip comment correctly', () => {
	t.deepEqual(addressparser('andris@tr.ee (reinman) andris'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

Deno.test('addressparser should handle missing address correctly', () => {
	t.deepEqual(addressparser('andris'), [ { name: 'andris', address: '' } ]);
});

Deno.test('addressparser should handle apostrophe in name correctly', () => {
	t.deepEqual(addressparser("O'Neill"), [ { name: "O'Neill", address: '' } ]);
});

Deno.test('addressparser should handle particularly bad input, unescaped colon correctly', () => {
	t.deepEqual(
		addressparser(
			'FirstName Surname-WithADash :: Company <firstname@company.com>'
		),
		[
			{
				name: 'FirstName Surname-WithADash',
				group: [
					{
						name: undefined,
						group: [ { address: 'firstname@company.com', name: 'Company' } ],
					},
				],
			},
		]
	);
});
