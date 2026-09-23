# The `.cocad` file format — version 1, frozen

**This is a published specification.** It exists so that anybody can read a CoCAD document without
CoCAD, and so that the promise *your data is never hostage* is a document rather than a slogan
(`04_ROADMAP.md`, *Data-freedom guarantee*). It describes the format CoCAD **writes today** and the
rules a reader may rely on; `tools/check-format-spec.mjs` fails the build if this file and the two
implementations stop agreeing, so a key that appears in the code and not here is a broken gate
rather than a stale document.

The two implementations are `core/cocad-core/src/io/document_file.cpp` (the shipping core) and
`packages/mock-core/src/document-file.ts` (the reference core, which is the conformance fixture —
ADR 0015). They write the same bytes for the same log, deliberately and under test.

---

## 1. What a `.cocad` is

**A saved CoCAD document is its operation log.** Not a geometry dump, not a proprietary container:
the ordered list of the commands that built the model, replayed on open. That is ADR 0092's
decision and ADR 0112's encoding of it, and it is the whole reason this format can be specified in
one short page.

The file is **one JSON object, pretty-printed with a two-space indent and a trailing newline**,
UTF-8, not ASCII-escaped. It is meant to be opened in a text editor, diffed in git, and written by
hand or by a program that has never linked against CoCAD.

A minimal, complete, valid document:

```json
{
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
```

## 2. The two rules that make version 1 mean something

1. **Metadata never reaches replay.** `savedAt`, `generator` and `geometryDigest` are for a human
   or a diagnostic reading the file. No command handler ever sees them, so two saves of one model
   differ in those columns and in nothing else.
2. **Unknown keys are ignored** — at the top level and inside an operation. **Adding a key is
   therefore never a version bump.** The version number moves only for a change a reader written
   against the current version could not survive.

Because of rule 2, a reader written against this page keeps working as CoCAD grows. Version 1 is
**frozen** (ADR 0191): what is frozen is a rule rather than a field list — *a `.cocad` stores the
operation log plus facts about the save, and nothing else*. Everything a CAD file usually hoards
(named views, display state, browser folders, exploded states, drawing sheets, sheet-metal flags,
per-face appearance) is produced by a command, so it rides the log and costs this format nothing.

## 3. Versions

<!-- check:format-spec versions -->

| What | Value |
| --- | --- |
| `formatVersion` — the version this build writes | `1` |
| `oldestReadableVersion` — the oldest this build reads | `0` |
| `extension` | `.cocad` |

<!-- /check:format-spec versions -->

A version-0 file — anything saved before the freeze — opens unchanged and is written back as
version 1 on the next save. That is the whole of the migration. A file whose `cocad` is outside
that window is refused with a sentence naming the number it carried.

## 4. Top-level keys

<!-- check:format-spec top-level -->

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `cocad` | integer | **yes** | The format version. A reader may refuse on this alone, having parsed one number. |
| `generator` | string | no | The build that wrote the file, verbatim. Absent is not damage — a hand-written `.cocad` may omit it, and no replay reads it. |
| `geometryDigest` | string | no | What the log *produced*, as `brep<n>-fnv1a64-<16 hex>` (ADR 0215). The one key here a later build **compares** rather than displays: it tells a replay that reproduced the model apart from one that did not. Omitted when the saving build could not compute one — which is a different fact from a recorded digest of *nothing*. |
| `operations` | array | **yes** | The log, in order. May be empty: an empty document is a valid one. |
| `savedAt` | string | no | ISO 8601 UTC, the instant of the save. |

<!-- /check:format-spec top-level -->

Keys are written in lexicographic order. That is not decoration: it is what lets a C++
`nlohmann::json` (which sorts) and a TypeScript `JSON.stringify` (which does not) emit the same
bytes, and both cores pin those bytes in a test.

## 5. An operation

Each entry of `operations` is one command as it was executed.

<!-- check:format-spec operation -->

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `args` | object | **yes** | The command's arguments, exactly as they went over the command bus. The bus's own JSON Schema is the authority on what they may be; this file has no second opinion. |
| `bodies` | array of integers | no | The bodies this record produced (ADR 0376). Written only when non-empty. |
| `clientId` | string | no | Who ran it. A document read back off disk replays as `file:<n>` — nobody in the current session — which is what keeps *undo is yours* honest across an open. |
| `command` | string | **yes** | The command name, e.g. `body.box`. Must be a non-empty string; everything else about it is the bus's business. |
| `feature` | integer | no | The `ft:` id this record minted (ADR 0161). **The only field in a `.cocad` that is a replay input**: reserving it is what lets a `feature.reorder` move a record without renumbering everything after it. A record that mints a feature and carries no number is filled in by the replay that opens the file. |
| `refs` | object (string → string) | no | The entities this record referred to, by derivation key (ADR 0376). Written only when non-empty, with its own keys sorted. |

<!-- /check:format-spec operation -->

## 6. What a reader must refuse, and what it must not

A conforming reader **refuses**: bytes that are not a JSON object; a missing or non-integer
`cocad`; a version outside the window in §3; an `operations` that is not an array; an entry that is
not an object, or whose `command` is not a non-empty string.

A conforming reader **accepts**: an unknown top-level key, an unknown key inside an operation, a
missing `clientId`, a missing `generator`, a missing `savedAt`, a missing `geometryDigest`, and an
empty `operations`.

The asymmetry is the point. A schema validator on the command bus is what refuses a bad argument;
a file reader has no business having a second opinion about one. This is also what makes the format
safe for an AI or a script to write: get the five structural things right and CoCAD will tell you,
in its own error messages, about anything else.

## 7. What is deliberately NOT in the file

- **No rendered preview.** A save would then depend on a render provider being connected, so the
  field would be present or absent for a reason the user cannot see. A thumbnail is a cache keyed
  by path, beside the preferences file.
- **No absolute paths and no `doc:` ids.** A cross-file reference is a relative path resolved at
  open, because a process-scoped id does not outlive the process and a file does.
- **No reserved slots.** A reserved slot is a second place a fact could live.

## 8. Related reading

`docs/adr/0092-*`, `0112-*`, `0161-*`, `0191-*`, `0215-*` and `0376-*` carry the decisions and
their reasons. `export.recipe` with `source: "document"` writes an open document's log as a
`.cocadrecipe` - the same commands and arguments, without the three replay inputs (`feature`,
`bodies`, `refs`), and refused when the log depends on them (ADR 0471) - and `query.recipe` reads
one back over the command bus without running it, for a program that would rather not parse a file.
