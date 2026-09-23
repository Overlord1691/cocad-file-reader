// SPDX-License-Identifier: MIT
//
// Every case here is one sentence of COCAD_FILE_FORMAT.md, cited by section, so a failure names
// the rule it broke. Run with `npm test` (node's own test runner; no dependencies).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CocadFormatError,
  FORMAT_VERSION,
  OLDEST_READABLE_VERSION,
  readCocad,
  summarize,
} from '../src/reader.js';

// Section 1's minimal, complete, valid document, character for character.
const MINIMAL = `{
  "cocad": 1,
  "generator": "cocad-core 0.1.0",
  "operations": [
    {
      "args": { "size": { "x": 40, "y": 20, "z": 10 } },
      "clientId": "file:1",
      "command": "body.box"
    }
  ],
  "savedAt": "2026-09-22T18:00:00Z"
}
`;

const doc = (fields) => JSON.stringify({ cocad: 1, operations: [], ...fields });

function refuses(input, pathExpected, pattern) {
  assert.throws(
    () => readCocad(input),
    (error) => {
      assert.ok(error instanceof CocadFormatError, `expected CocadFormatError, got ${error}`);
      if (pathExpected !== undefined) assert.equal(error.path, pathExpected);
      if (pattern !== undefined) assert.match(error.message, pattern);
      return true;
    },
  );
}

test('section 1: reads the minimal document the spec prints', () => {
  const d = readCocad(MINIMAL);
  assert.equal(d.version, 1);
  assert.equal(d.generator, 'cocad-core 0.1.0');
  assert.equal(d.savedAt, '2026-09-22T18:00:00Z');
  assert.equal(d.operations.length, 1);
  assert.equal(d.operations[0].command, 'body.box');
  assert.deepEqual(d.operations[0].args, { size: { x: 40, y: 20, z: 10 } });
  assert.equal(d.operations[0].clientId, 'file:1');
  assert.deepEqual(d.notes, []);
});

test('section 1: reads the same document from bytes, and tolerates a byte-order mark', () => {
  const bytes = new TextEncoder().encode(MINIMAL);
  assert.equal(readCocad(bytes).operations.length, 1);
  assert.equal(readCocad(bytes.buffer).operations.length, 1);
  assert.equal(readCocad(`﻿${MINIMAL}`).operations.length, 1);
  refuses(new Uint8Array([0x7b, 0xff, 0x7d]), undefined, /not UTF-8/);
});

test('section 3: the readable window is 0 to 1, and a version outside it is named', () => {
  assert.equal(FORMAT_VERSION, 1);
  assert.equal(OLDEST_READABLE_VERSION, 0);
  const v0 = readCocad(JSON.stringify({ cocad: 0, operations: [] }));
  assert.equal(v0.version, 0);
  assert.match(v0.notes.join(' '), /version 0/);
  refuses(JSON.stringify({ cocad: 2, operations: [] }), 'cocad', /version 2.*newer CoCAD/);
  refuses(JSON.stringify({ cocad: -1, operations: [] }), 'cocad', /version -1/);
});

test('section 6: refuses bytes that are not a JSON object', () => {
  refuses('', undefined, /not valid JSON/);
  refuses('{"cocad": 1, "operations": [', undefined, /not valid JSON/);
  refuses('[]', undefined, /a list/);
  refuses('"cocad"', undefined, /one JSON object/);
  refuses('null', undefined, /null/);
});

test('section 6: refuses a missing or non-integer cocad', () => {
  refuses(JSON.stringify({ operations: [] }), 'cocad', /no "cocad"/);
  refuses(JSON.stringify({ cocad: '1', operations: [] }), 'cocad', /whole number/);
  refuses(JSON.stringify({ cocad: 1.5, operations: [] }), 'cocad', /whole number/);
  refuses(JSON.stringify({ cocad: null, operations: [] }), 'cocad', /whole number/);
});

test('sections 4 and 6: refuses an operations that is missing or not a list', () => {
  refuses(JSON.stringify({ cocad: 1 }), 'operations', /no "operations"/);
  refuses(JSON.stringify({ cocad: 1, operations: {} }), 'operations', /must be a list/);
});

test('section 6: refuses an entry that is not an object, or has no non-empty command', () => {
  refuses(doc({ operations: [42] }), 'operations[0]', /JSON object/);
  refuses(doc({ operations: [{ args: {} }] }), 'operations[0].command', /missing/);
  refuses(doc({ operations: [{ args: {}, command: '' }] }), 'operations[0].command');
  refuses(
    doc({ operations: [{ args: {}, command: 'body.box' }, { args: {}, command: 7 }] }),
    'operations[1].command',
    /the number 7/,
  );
});

test('section 6: accepts every absence and every unknown key it lists', () => {
  const d = readCocad(
    doc({
      futureKey: { anything: true },
      operations: [{ args: {}, command: 'sketch.create', someday: 'maybe' }],
    }),
  );
  assert.equal(d.generator, undefined);
  assert.equal(d.savedAt, undefined);
  assert.equal(d.geometryDigest, undefined);
  assert.equal(d.operations[0].clientId, undefined);
  assert.deepEqual(d.operations[0].unknownKeys, ['someday']);
  assert.match(d.notes.join(' '), /futureKey/);
  assert.deepEqual(readCocad(doc({})).operations, []);
});

test('section 5: reads the three replay inputs when present', () => {
  const d = readCocad(
    doc({
      geometryDigest: 'brep5-fnv1a64-0123456789abcdef',
      operations: [
        {
          args: { distance: 5 },
          bodies: [1, 2],
          command: 'feature.extrude',
          feature: 3,
          refs: { profile: 'sk:1/r:0' },
        },
      ],
    }),
  );
  const op = d.operations[0];
  assert.equal(op.feature, 3);
  assert.deepEqual(op.bodies, [1, 2]);
  assert.deepEqual(op.refs, { profile: 'sk:1/r:0' });
  assert.equal(d.geometryDigest, 'brep5-fnv1a64-0123456789abcdef');
});

test('sections 5 and 6: a missing args is reported and read as {}, never refused', () => {
  // Section 5's table marks `args` required, but section 6's refusal list does not name it and
  // section 5 makes the bus the authority on arguments. The reader follows section 6.
  const d = readCocad(doc({ operations: [{ command: 'doc.new' }] }));
  assert.deepEqual(d.operations[0].args, {});
  assert.match(d.notes.join(' '), /no "args"/);
});

test('wrongly typed optional values are notes, not refusals', () => {
  const d = readCocad(
    doc({
      generator: 5,
      operations: [{ args: [], bodies: ['x'], command: 'a.b', feature: 'ft:1', refs: { k: 1 } }],
    }),
  );
  assert.equal(d.generator, undefined);
  assert.equal(d.operations[0].feature, undefined);
  assert.equal(d.operations[0].bodies, undefined);
  assert.equal(d.operations[0].refs, undefined);
  assert.equal(d.notes.length, 5);
});

test('summarize counts commands, features and bodies without computing geometry', () => {
  const d = readCocad(
    doc({
      operations: [
        { args: {}, clientId: 'file:1', command: 'sketch.create', feature: 1 },
        { args: {}, clientId: 'file:1', command: 'sketch.draw' },
        { args: {}, clientId: 'file:2', command: 'sketch.draw' },
        { args: {}, bodies: [1], command: 'feature.extrude', feature: 2 },
        { args: {}, bodies: [1], command: 'feature.fillet', feature: 3 },
      ],
    }),
  );
  const s = summarize(d);
  assert.equal(s.operationCount, 5);
  assert.deepEqual(s.commands, {
    'feature.extrude': 1,
    'feature.fillet': 1,
    'sketch.create': 1,
    'sketch.draw': 2,
  });
  assert.equal(s.featureCount, 3);
  assert.equal(s.bodyCount, 1);
  assert.deepEqual(s.clients, ['file:1', 'file:2']);
});

test('the command-line tool reads, summarises, emits JSON and checks', () => {
  const cli = fileURLToPath(new URL('../bin/cocad-read.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'cocad-read-'));
  const good = join(dir, 'good.cocad');
  const bad = join(dir, 'bad.cocad');
  writeFileSync(good, MINIMAL);
  writeFileSync(bad, '{"cocad": 9, "operations": []}');

  const human = execFileSync(process.execPath, [cli, good], { encoding: 'utf8' });
  assert.match(human, /format version\s+1/);
  assert.match(human, /body\.box/);

  const json = JSON.parse(execFileSync(process.execPath, [cli, good, '--json'], { encoding: 'utf8' }));
  assert.equal(json.operations[0].command, 'body.box');
  assert.equal(json.raw, undefined);

  assert.throws(
    () => execFileSync(process.execPath, [cli, '--check', good, bad], { encoding: 'utf8' }),
    (error) => error.status === 1 && /ok\s+.*good\.cocad/.test(error.stdout) && /FAIL.*version 9/.test(error.stdout),
  );
  assert.throws(
    () => execFileSync(process.execPath, [cli], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => error.status === 2,
  );
});
