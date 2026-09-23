// SPDX-License-Identifier: MIT
//
// A reader for CoCAD's `.cocad` document format, version 1.
//
// Written against the published specification ALONE (`COCAD_FILE_FORMAT.md` in the CoCAD
// repository) and never against CoCAD's source, on purpose: the point of this package is that a
// `.cocad` can be read without CoCAD, and a reader that borrowed CoCAD's code would prove nothing
// about the specification. Every rule below cites the section of the spec it comes from.
//
// Zero dependencies. Node 18 or later, or any modern browser (this module touches no Node API).

/** The format version this reader understands fully (spec section 3). */
export const FORMAT_VERSION = 1;

/** The oldest version this reader accepts (spec section 3: a version-0 file opens unchanged). */
export const OLDEST_READABLE_VERSION = 0;

/** The file extension (spec section 3). */
export const EXTENSION = '.cocad';

/** The top-level keys version 1 names (spec section 4). Any other key is ignored, never refused. */
export const KNOWN_TOP_LEVEL_KEYS = Object.freeze([
  'cocad',
  'generator',
  'geometryDigest',
  'operations',
  'savedAt',
]);

/** The operation keys version 1 names (spec section 5). Any other key is ignored, never refused. */
export const KNOWN_OPERATION_KEYS = Object.freeze([
  'args',
  'bodies',
  'clientId',
  'command',
  'feature',
  'refs',
]);

/**
 * The one error this reader throws: the file is not a `.cocad` a conforming reader may accept.
 * `message` is a whole sentence saying what was wrong and what to do; `path` locates it
 * (`operations[3].command`) when there is a place to point at.
 */
export class CocadFormatError extends Error {
  /**
   * @param {string} message
   * @param {string} [path]
   */
  constructor(message, path) {
    super(message);
    this.name = 'CocadFormatError';
    /** @type {string | undefined} */
    this.path = path;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return `the text ${JSON.stringify(value)}`;
  if (typeof value === 'number') return `the number ${value}`;
  return `a ${typeof value}`;
}

/**
 * Parse and check a `.cocad` document.
 *
 * Refuses exactly what spec section 6 lists - bytes that are not a JSON object, a missing or
 * non-integer `cocad`, a version outside the readable window, an `operations` that is not a list,
 * an entry that is not an object or whose `command` is not a non-empty string - and NOTHING else.
 * Everything a conforming reader must accept is accepted, including unknown keys (spec section 2,
 * rule 2), and anything merely unusual is reported in `notes` rather than thrown.
 *
 * @param {string | Uint8Array | ArrayBuffer} input The file's bytes, or its text.
 * @returns {CocadDocument}
 * @throws {CocadFormatError}
 */
export function readCocad(input) {
  const text = toText(input);

  let root;
  try {
    root = JSON.parse(text);
  } catch (error) {
    throw new CocadFormatError(
      `This is not a .cocad file: it is not valid JSON (${error.message}). ` +
        'A .cocad is one JSON object; check the file was not truncated or re-encoded.',
    );
  }
  if (!isPlainObject(root)) {
    throw new CocadFormatError(
      `This is not a .cocad file: its JSON is ${describe(root)}, and a .cocad is one JSON object.`,
    );
  }

  // Section 6: a missing or non-integer `cocad`, or one outside the window in section 3.
  if (!('cocad' in root)) {
    throw new CocadFormatError(
      'This is not a .cocad file: it has no "cocad" version number at the top level.',
      'cocad',
    );
  }
  const version = root.cocad;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new CocadFormatError(
      `This .cocad's "cocad" version must be a whole number, and it is ${describe(version)}.`,
      'cocad',
    );
  }
  if (version < OLDEST_READABLE_VERSION || version > FORMAT_VERSION) {
    throw new CocadFormatError(
      `This .cocad is format version ${version}; this reader reads versions ` +
        `${OLDEST_READABLE_VERSION} to ${FORMAT_VERSION}. ` +
        (version > FORMAT_VERSION
          ? 'It was written by a newer CoCAD - update this reader.'
          : 'No CoCAD ever wrote that version, so the file has been edited or damaged.'),
      'cocad',
    );
  }

  // Section 6: an `operations` that is not a list. Section 4 marks it required.
  if (!('operations' in root)) {
    throw new CocadFormatError(
      'This .cocad has no "operations" list. An empty document is written "operations": [].',
      'operations',
    );
  }
  if (!Array.isArray(root.operations)) {
    throw new CocadFormatError(
      `This .cocad's "operations" must be a list, and it is ${describe(root.operations)}.`,
      'operations',
    );
  }

  /** @type {string[]} */
  const notes = [];
  const operations = root.operations.map((entry, index) => readOperation(entry, index, notes));

  for (const key of ['generator', 'savedAt', 'geometryDigest']) {
    if (key in root && typeof root[key] !== 'string') {
      notes.push(
        `"${key}" is ${describe(root[key])} rather than text; it is metadata, so it was ignored.`,
      );
    }
  }
  const unknownTop = Object.keys(root).filter((k) => !KNOWN_TOP_LEVEL_KEYS.includes(k));
  if (unknownTop.length > 0) {
    notes.push(
      `Top-level key(s) this reader does not know, ignored as the spec requires: ${unknownTop.join(', ')}.`,
    );
  }
  if (version < FORMAT_VERSION) {
    notes.push(
      `Format version ${version}: saved before version ${FORMAT_VERSION} was frozen. It reads unchanged.`,
    );
  }

  return {
    version,
    generator: typeof root.generator === 'string' ? root.generator : undefined,
    savedAt: typeof root.savedAt === 'string' ? root.savedAt : undefined,
    geometryDigest: typeof root.geometryDigest === 'string' ? root.geometryDigest : undefined,
    operations,
    notes,
    raw: root,
  };
}

function readOperation(entry, index, notes) {
  const where = `operations[${index}]`;
  if (!isPlainObject(entry)) {
    throw new CocadFormatError(
      `Operation ${index} (counting from 0) must be a JSON object, and it is ${describe(entry)}.`,
      where,
    );
  }
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    throw new CocadFormatError(
      `Operation ${index} (counting from 0) must name its command as non-empty text, ` +
        `and its "command" is ${'command' in entry ? describe(entry.command) : 'missing'}.`,
      `${where}.command`,
    );
  }

  // Section 5 marks `args` required, but section 6's refusal list does not name it, and section 5
  // says the command bus - not the file - is the authority on arguments. So a missing `args` is
  // reported and read as `{}` rather than refused: a reader has no second opinion about arguments.
  let args = entry.args;
  if (!('args' in entry)) {
    notes.push(`${where} (${entry.command}) has no "args"; read as {}.`);
    args = {};
  } else if (!isPlainObject(args)) {
    notes.push(
      `${where} (${entry.command}) has "args" that is ${describe(args)} rather than an object; kept as it is.`,
    );
  }

  const feature =
    typeof entry.feature === 'number' && Number.isInteger(entry.feature) ? entry.feature : undefined;
  if ('feature' in entry && feature === undefined) {
    notes.push(
      `${where} (${entry.command}) has a "feature" that is ${describe(entry.feature)} rather than a whole number.`,
    );
  }
  const bodies =
    Array.isArray(entry.bodies) && entry.bodies.every((b) => Number.isInteger(b))
      ? entry.bodies
      : undefined;
  if ('bodies' in entry && bodies === undefined) {
    notes.push(`${where} (${entry.command}) has "bodies" that is not a list of whole numbers.`);
  }
  const refs =
    isPlainObject(entry.refs) && Object.values(entry.refs).every((v) => typeof v === 'string')
      ? entry.refs
      : undefined;
  if ('refs' in entry && refs === undefined) {
    notes.push(`${where} (${entry.command}) has "refs" that is not an object of text values.`);
  }

  return {
    index,
    command: entry.command,
    args,
    clientId: typeof entry.clientId === 'string' ? entry.clientId : undefined,
    feature,
    bodies,
    refs,
    unknownKeys: Object.keys(entry).filter((k) => !KNOWN_OPERATION_KEYS.includes(k)),
  };
}

function toText(input) {
  let text;
  if (typeof input === 'string') {
    text = input;
  } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new CocadFormatError('This is not a .cocad file: it is not UTF-8 text.');
    }
  } else {
    throw new TypeError('readCocad takes the file as a string, a Uint8Array or an ArrayBuffer.');
  }
  // A byte-order mark is not part of the JSON; tolerate one rather than refuse a file a text
  // editor re-saved.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * A plain summary of a document: how many operations, which commands and how often, how many
 * timeline features and bodies the log records. Pure; no geometry is computed - a `.cocad` stores
 * the recipe, and turning it into shapes is CoCAD's (or any other replayer's) job.
 *
 * @param {CocadDocument} doc
 */
export function summarize(doc) {
  /** @type {Record<string, number>} */
  const commands = {};
  let features = 0;
  const bodies = new Set();
  const clients = new Set();
  for (const op of doc.operations) {
    commands[op.command] = (commands[op.command] ?? 0) + 1;
    if (op.feature !== undefined) features += 1;
    for (const b of op.bodies ?? []) bodies.add(b);
    if (op.clientId !== undefined) clients.add(op.clientId);
  }
  return {
    version: doc.version,
    generator: doc.generator,
    savedAt: doc.savedAt,
    geometryDigest: doc.geometryDigest,
    operationCount: doc.operations.length,
    commands,
    featureCount: features,
    bodyCount: bodies.size,
    clients: [...clients].sort(),
  };
}

/**
 * @typedef {object} CocadOperation
 * @property {number} index Position in the log, from 0.
 * @property {string} command The command name, e.g. `body.box`.
 * @property {unknown} args The command's arguments, exactly as stored.
 * @property {string} [clientId] Who ran it.
 * @property {number} [feature] The `ft:` id this record minted.
 * @property {number[]} [bodies] The bodies this record produced.
 * @property {Record<string, string>} [refs] Entities referred to, by derivation key.
 * @property {string[]} unknownKeys Keys this reader does not know (ignored, per the spec).
 */

/**
 * @typedef {object} CocadDocument
 * @property {number} version The file's `cocad` number.
 * @property {string} [generator]
 * @property {string} [savedAt]
 * @property {string} [geometryDigest]
 * @property {CocadOperation[]} operations The log, in order.
 * @property {string[]} notes Things worth knowing that are not errors.
 * @property {Record<string, unknown>} raw The parsed JSON, untouched.
 */
