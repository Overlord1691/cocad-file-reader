# cocad-file-reader

**Read a CoCAD `.cocad` document without CoCAD.** Zero dependencies, MIT-licensed, a few hundred
lines you can read in one sitting.

Your files are yours. A `.cocad` file is a plain, documented operation log — the specification is
published and this free, open-source reader exists — so your work is readable without CoCAD,
without an account, and without us. Your data is never hostage.

## What a `.cocad` is

One JSON object: a format version, some facts about the save, and the **ordered list of commands
that built the model**. Not a geometry dump — the recipe. `SPEC.md` in this repository is a copy of
the published specification this reader was written against; it is short.

## Command line

Node 18 or later.

```sh
npx cocad-file-reader model.cocad            # or: node bin/cocad-read.js model.cocad
cocad-read model.cocad --summary             # the counts only
cocad-read model.cocad --json                # the checked document, for another program
cocad-read --check *.cocad                   # exit 0 if every file is a readable .cocad
```

```
format version   1
written by       cocad-core 0.1.0
saved at         2026-09-22T18:00:00Z
geometry digest  (not recorded)
operations       1
features         0
bodies           0

commands
     1  body.box

operations, in order
     0          body.box  {"size":{"x":40,"y":20,"z":10}}
```

Exit codes: `0` read, `1` a file is not a readable `.cocad` (the reason is printed), `2` usage.

## Library

```js
import { readFile } from 'node:fs/promises';
import { readCocad, summarize, CocadFormatError } from 'cocad-file-reader';

const doc = readCocad(await readFile('model.cocad'));
for (const op of doc.operations) console.log(op.index, op.command, op.args);
console.log(summarize(doc));
```

`readCocad` takes a string, a `Uint8Array` or an `ArrayBuffer`, and works in a browser as well as
in Node. It returns the log in order, each operation's `command`, `args`, and — when the file
records them — `clientId`, `feature` (the timeline id it minted), `bodies` and `refs`, plus
`notes`: things worth knowing that are not errors.

## What it refuses, and what it does not

Exactly the spec's section 6, and nothing more. It **refuses** bytes that are not a JSON object, a
missing or non-integer `cocad`, a version outside 0–1, an `operations` that is not a list, and an
entry that is not an object or has no command name — each with a sentence saying which, and a
`path` pointing at it. It **accepts** unknown keys anywhere (that is how the format grows without a
version bump), and every optional field's absence. A wrongly typed optional value becomes a note,
not a failure: a reader has no second opinion about a command's arguments — CoCAD's command bus
does.

It does **not** compute geometry. Turning the recipe into shapes is what CoCAD, or any program that
implements its commands, does on open.

## Tests

```sh
npm test
```

Every case cites the section of the specification it checks.

## Licence

MIT — see `LICENSE`.
