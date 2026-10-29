// Importer: the schema helpers, the parsers and the Dictionary rules, run on small CSV fixtures. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTable, table, slugList, slug, text, number } from '../importer/utils.js';
import categories from '../importer/parsers/categories.js';
import products from '../importer/parsers/products.js';
import areas from '../importer/parsers/areas.js';
import dayparts from '../importer/parsers/dayparts.js';
import { buildDictionary, collectSlugs } from '../importer/parsers/dictionary.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'importer-test-'));
let n = 0;
const csv = (text) => { const f = path.join(dir, `t${n++}.csv`); fs.writeFileSync(f, text); return f; };
const quiet = (fn) => { const w = console.warn, l = console.log; console.warn = console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };

test('schema: required, unique and number rules skip bad rows', () => {
  const f = csv('Slug,ID,Note\ncups,1,a\ndup-id,1,b\n,2,c\ncups,3,d\nbag,x,e\nok,4,\n,,\n');
  const out = quiet(() => parseTable(f, { slug: slug(), id: number({ required: true, unique: true }), note: text() }, '[t]'));
  assert.deepEqual(out, [{ slug: 'cups', id: 1, note: 'a' }, { slug: 'ok', id: 4, note: '' }]);
});

test('schema: a missing required column is an error, an optional one is empty', () => {
  assert.throws(() => parseTable(csv('Name\nx\n'), { slug: slug() }, '[t]'), /no "slug" column/);
  assert.deepEqual(parseTable(csv('Slug\na\n'), { slug: slug(), extra: text(), n: number({ fallback: 5 }) }, '[t]'), [{ slug: 'a', extra: '', n: 5 }]);
});

test('categories are slug + id', () => {
  const out = quiet(() => categories.parse(csv('Slug,ID\npaper-cups,1\nbags,2\n')));
  assert.deepEqual(out, [{ slug: 'paper-cups', id: 1 }, { slug: 'bags', id: 2 }]);
});

test('products have all their fields (ids stay text) and the unit defaults to 1', () => {
  const out = quiet(() => products.parse(csv('Slug,ID,Extension,Category,Yield,Unit\nsauce-a,04552,116,fridge-rack,"37,5",0.5\nfill-a,00055,070,fridge-rack,,-1\nplain,1,2,x,3,\nsauce-a,9,9,x,9,9\n')));
  assert.deepEqual(out, [
    { slug: 'sauce-a', category: 'fridge-rack', id: '04552', extension: '116', yield: 37.5, unit: 0.5 },
    { slug: 'fill-a', category: 'fridge-rack', id: '00055', extension: '070', yield: 0, unit: -1 },
    { slug: 'plain', category: 'x', id: '1', extension: '2', yield: 3, unit: 1 },
  ]);
});

test('slug-only tabs are plain lists of slugs', () => {
  assert.deepEqual(quiet(() => areas.parse(csv('Slug\nmccafe\nbdap\nmccafe\n'))), ['mccafe', 'bdap']);
});

test('references to other tabs are checked, empty ones are fine', () => {
  const p = table('P', 'products', { slug: slug(), category: text({ ref: 'categories' }) });
  const db = { categories: [{ slug: 'a', id: 1 }], products: [{ slug: 'x', category: 'a' }, { slug: 'y', category: 'nope' }, { slug: 'z', category: '' }] };
  assert.deepEqual(p.check(db), ['products.category uses unknown categories slug(s): nope']);
  assert.deepEqual(slugList('L', 'l').check, undefined);
});

test('dayparts is a placeholder that imports nothing', () => {
  assert.equal(dayparts.required, false);
  assert.equal(dayparts.parse(path.join(dir, 'does-not-exist.csv')), undefined);
});

test('dictionary: every slug of the imported data is collected, with the key of its tab as type', () => {
  const parsers = [{ key: 'categories' }, { key: 'areas' }, dayparts, { key: 'dictionary' }];
  const db = { categories: [{ slug: 'c1', id: 1 }], areas: ['a1', 'c1'], dictionary: [{ slug: 'ignored' }] };
  assert.deepEqual([...collectSlugs(db, parsers)], [['c1', { type: 'categories' }], ['a1', { type: 'areas' }]]);
});

test('dictionary: new slugs are appended as missing', () => {
  const found = new Map([['cups', { type: 'categories' }], ['box', { type: 'products' }]]);
  const r = buildDictionary('Slug,Type,Subtype,Italian,Order,Note\n', found);
  assert.deepEqual(r.values[0], ['Slug', 'Status', 'Type', 'Subtype', 'Italian', 'Order', 'Note']);
  assert.deepEqual(r.entries.map((e) => [e.slug, e.status, e.type]), [['cups', 'missing', 'categories'], ['box', 'missing', 'products']]);
  assert.equal(r.changed, true);
});

test('dictionary: active / missing / outdated, existing rows are never changed or removed', () => {
  const found = new Map([['a', { type: 'products' }], ['b', { type: 'products' }]]);
  const r = buildDictionary('Slug,Type,Subtype,Italian,Order,Note\na,products,,Ciao,3,keep me\nb,products,,,,\nold,tasks,,Vecchio,,\n', found);
  assert.deepEqual(r.entries.map((e) => [e.slug, e.status]), [['a', 'active'], ['b', 'missing'], ['old', 'outdated']]);
  assert.deepEqual(r.entries[0], { slug: 'a', status: 'active', type: 'products', subtype: '', order: 3, note: 'keep me', translations: { Italian: 'Ciao' } });
});

test('dictionary: only the columns the tab has are stored, and a second run changes nothing', () => {
  const found = new Map([['a', { type: 'products' }]]);
  const first = buildDictionary('Slug,Type,Status,Italian\n', found);
  assert.deepEqual(first.entries[0], { slug: 'a', status: 'missing', type: 'products', translations: { Italian: '' } });
  const text = first.values.map((row) => row.join(',')).join('\n') + '\n';
  assert.equal(buildDictionary(text, found).changed, false);
});
