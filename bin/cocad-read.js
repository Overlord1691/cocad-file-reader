#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// cocad-read - print what a .cocad document contains, without CoCAD.
//
//   cocad-read model.cocad            a summary and the operation list
//   cocad-read model.cocad --summary  the summary only
//   cocad-read model.cocad --json     the checked document as JSON, for another program
//   cocad-read --check a.cocad b.cocad  exit 0 if every file is a readable .cocad, 1 if not
//
// Exit codes: 0 read, 1 a file is not a readable .cocad (the reason is printed), 2 usage.

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { CocadFormatError, readCocad, summarize } from '../src/reader.js';

const USAGE = `usage: cocad-read <file.cocad> [--summary | --json]
       cocad-read --check <file.cocad>...`;

function shortArgs(args) {
  const text = JSON.stringify(args ?? {});
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function printHuman(doc, summaryOnly) {
  const s = summarize(doc);
  const lines = [
    `format version   ${s.version}`,
    `written by       ${s.generator ?? '(not recorded)'}`,
    `saved at         ${s.savedAt ?? '(not recorded)'}`,
    `geometry digest  ${s.geometryDigest ?? '(not recorded)'}`,
    `operations       ${s.operationCount}`,
    `features         ${s.featureCount}`,
    `bodies           ${s.bodyCount}`,
  ];
  const counts = Object.entries(s.commands).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (counts.length > 0) {
    lines.push('', 'commands');
    for (const [command, n] of counts) lines.push(`  ${String(n).padStart(4)}  ${command}`);
  }
  if (!summaryOnly && doc.operations.length > 0) {
    lines.push('', 'operations, in order');
    for (const op of doc.operations) {
      const tag = op.feature !== undefined ? `ft:${op.feature}`.padEnd(7) : ''.padEnd(7);
      lines.push(`  ${String(op.index).padStart(4)}  ${tag} ${op.command}  ${shortArgs(op.args)}`);
    }
  }
  if (doc.notes.length > 0) {
    lines.push('', 'notes');
    for (const note of doc.notes) lines.push(`  - ${note}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function readOne(path) {
  const bytes = await readFile(path);
  return readCocad(new Uint8Array(bytes));
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const files = argv.filter((a) => !a.startsWith('--'));
  const known = new Set(['--summary', '--json', '--check', '--help']);
  const unknown = [...flags].filter((f) => !known.has(f));

  if (flags.has('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (unknown.length > 0 || files.length === 0 || (!flags.has('--check') && files.length > 1)) {
    process.stderr.write(`${unknown.length > 0 ? `unknown option ${unknown[0]}\n` : ''}${USAGE}\n`);
    return 2;
  }

  if (flags.has('--check')) {
    let bad = 0;
    for (const file of files) {
      try {
        const doc = await readOne(file);
        process.stdout.write(`ok    ${file}  (version ${doc.version}, ${doc.operations.length} operations)\n`);
      } catch (error) {
        bad += 1;
        process.stdout.write(`FAIL  ${file}  ${error.message}\n`);
      }
    }
    return bad === 0 ? 0 : 1;
  }

  try {
    const doc = await readOne(files[0]);
    if (flags.has('--json')) {
      const { raw, ...checked } = doc;
      void raw;
      process.stdout.write(`${JSON.stringify(checked, null, 2)}\n`);
    } else {
      printHuman(doc, flags.has('--summary'));
    }
    return 0;
  } catch (error) {
    if (error instanceof CocadFormatError || error.code === 'ENOENT' || error.code === 'EISDIR') {
      process.stderr.write(`${files[0]}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
