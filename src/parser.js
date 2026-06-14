// Parses scratchblocks-style text into an AST the compiler can walk.
//
// AST shape:
//   Program = {
//     stage: Stage,
//     scripts: Script[], // legacy/default Sprite1 scripts
//     sprites: Sprite[],
//     variables: Set<string>,
//     lists: Set<string>,
//     broadcasts: Set<string>
//   }
//   Stage   = { name: 'Stage', scripts: Script[], backdrops: Costume[], ...props }
//   Sprite  = { name: string, scripts: Script[], costumes: Costume[], ...props }
//   Script  = { hat: Block|null, body: Block[] }
//   Block   = { template, args: Arg[], substack?: Block[], substack2?: Block[] }
//   Arg     = { kind: 'num'|'str'|'bool'|'var'|'field'|'menu'|'broadcast'|'color'|'index', ... }
//
// Operator ambiguity: `<` is a boolean opener only when followed immediately by
// a non-space character. `>` is a closer only when preceded immediately by a
// non-space character. Otherwise they are operator tokens. This matches common
// scratchblocks style: `<(x) < (y)>` works because the middle `<` and `>` are
// space-padded and therefore operators, while the outer pair is not.

(function (global) {
'use strict';

// --- tokenizer ----------------------------------------------------------

function isBoolOpener(text, i) {
  const next = text[i + 1];
  return next !== undefined && next !== ' ' && next !== '\t';
}
function isBoolCloser(text, i) {
  const prev = text[i - 1];
  return prev !== undefined && prev !== ' ' && prev !== '\t';
}

function findClose(text, start) {
  const open = text[start];
  // Square-bracket content (strings, dropdowns, colours) is OPAQUE: it may
  // contain (, ), <, >, * etc. as literal text (e.g. a label "[>> go <<]").
  // Just scan to the next ']' rather than trying to balance nested brackets.
  if (open === '[') {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === ']') return i;
    }
    throw new Error("Unmatched '['");
  }
  let close, isOpenFn, isCloseFn;
  if (open === '(') { close = ')'; isOpenFn = () => true; isCloseFn = () => true; }
  else if (open === '[') { close = ']'; isOpenFn = () => true; isCloseFn = () => true; }
  else if (open === '<') { close = '>'; isOpenFn = isBoolOpener; isCloseFn = isBoolCloser; }
  else throw new Error(`findClose: unknown opener ${open}`);

  let depth = 1;
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    // Skip over nested brackets of OTHER kinds so their content doesn't
    // confuse our depth tracking for the current kind.
    if (c === '(' && open !== '(') { i = findClose(text, i) + 1; continue; }
    if (c === '[' && open !== '[') { i = findClose(text, i) + 1; continue; }
    if (c === '<' && open !== '<' && isBoolOpener(text, i)) { i = findClose(text, i) + 1; continue; }

    if (c === open && isOpenFn(text, i)) { depth++; i++; continue; }
    if (c === close && isCloseFn(text, i)) {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  throw new Error(`Unmatched '${open}'`);
}

// Tokenize a single line (no newlines). Returns a flat list of tokens.
// Tokens:
//   { kind: 'round',  raw: '...' }  -- (...)
//   { kind: 'square', raw: '...', dropdown: bool, color: bool }  -- [...], [... v], or [... c]
//   { kind: 'angle',  raw: '...' }  -- <...>
//   { kind: 'word',   text: '...' }
function tokenizeLine(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }

    if (c === '(') {
      const end = findClose(text, i);
      tokens.push({ kind: 'round', raw: text.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (c === '[') {
      const end = findClose(text, i);
      const inner = text.slice(i + 1, end);
      const m = /^(.*?)\s+([vcl])\s*$/i.exec(inner);
      const marker = m ? m[2].toLowerCase() : '';
      tokens.push({
        kind: 'square',
        raw: (m ? m[1] : inner).trim(),
        dropdown: marker === 'v' || marker === 'l',
        color: marker === 'c',
      });
      i = end + 1;
    } else if (c === '<' && isBoolOpener(text, i)) {
      const end = findClose(text, i);
      tokens.push({ kind: 'angle', raw: text.slice(i + 1, end).trim() });
      i = end + 1;
    } else if ('+-*/=<>'.indexOf(c) >= 0) {
      tokens.push({ kind: 'word', text: c });
      i++;
    } else {
      // Consume a word. Punctuation like `:`, `,`, `?` is kept as part of
      // the word because templates treat it as a literal (e.g. `x:`, `edge,`,
      // `down?`).
      let j = i;
      while (j < text.length) {
        const ch = text[j];
        if (ch === ' ' || ch === '\t') break;
        if ('()[]<>+-*/='.indexOf(ch) >= 0) break;
        j++;
      }
      if (j === i) { i++; continue; } // safety
      tokens.push({ kind: 'word', text: text.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

// --- template parsing ---------------------------------------------------

// Parse a template like "move %n steps" into a list of parts.
// parts are either { word: 'move' } or { slot: 'num' } etc.
function parseTemplatePattern(text) {
  const parts = [];
  const re = /%[nsbvmlci]|[^\s]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (tok[0] === '%' && tok.length === 2) {
      const kind = {
        n: 'num',
        s: 'str',
        b: 'bool',
        v: 'var',
        m: 'menu',
        l: 'list',
        c: 'color',
        i: 'index',
      }[tok[1]];
      parts.push({ slot: kind });
    } else {
      parts.push({ word: tok });
    }
  }
  return parts;
}

// Memoize template part lists.
const patternCache = new WeakMap();
function patternOf(tmpl) {
  let p = patternCache.get(tmpl);
  if (!p) { p = parseTemplatePattern(tmpl.text); patternCache.set(tmpl, p); }
  return p;
}

// --- matching -----------------------------------------------------------

function tokenMatchesSlot(token, slotType) {
  if (slotType === 'num')  return token.kind === 'round';
  if (slotType === 'str')  return token.kind === 'round' || (token.kind === 'square' && !token.dropdown && !token.color);
  if (slotType === 'bool') return token.kind === 'angle';
  if (slotType === 'var')  return token.kind === 'square' && token.dropdown;
  if (slotType === 'list') return token.kind === 'square' && token.dropdown;
  if (slotType === 'menu') return token.kind === 'square' && token.dropdown;
  if (slotType === 'color') return token.kind === 'square' && (token.color || isHexColor(token.raw));
  if (slotType === 'index') return token.kind === 'round' || (token.kind === 'square' && token.dropdown);
  return false;
}

function slotTokenKind(slotMeta) {
  if (slotMeta.type === 'field' || slotMeta.type === 'menu' ||
      slotMeta.type === 'broadcast' || slotMeta.type === 'broadcastField') {
    return 'menu';
  }
  if (slotMeta.type === 'var') return 'var';
  if (slotMeta.type === 'list') return 'list';
  return slotMeta.type;
}

function matchTemplate(tmpl, tokens) {
  const pat = patternOf(tmpl);
  if (pat.length !== tokens.length) return null;
  const captured = [];
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    const t = tokens[i];
    if (p.word !== undefined) {
      if (t.kind !== 'word') return null;
      if (t.text.toLowerCase() !== p.word.toLowerCase()) return null;
    } else {
      // slot; use the slot type declared in the template (positional).
      const slotMeta = tmpl.slots[captured.length];
      if (!slotMeta) return null;
      // Prefer the template's declared slot type; fallback to the marker
      // kind embedded in text (p.slot).
      if (!tokenMatchesSlot(t, slotTokenKind(slotMeta))) return null;
      captured.push(t);
    }
  }
  return captured;
}

// --- argument parsing ---------------------------------------------------

function isPureNumber(raw) {
  return /^-?\d+(\.\d+)?$/.test(raw);
}

function isHexColor(raw) {
  return /^#[0-9a-f]{6}$/i.test((raw || '').trim());
}

function normalizeHexColor(raw) {
  const value = (raw || '').trim();
  return isHexColor(value) ? value.toLowerCase() : '#000000';
}

function parseArg(slotMeta, token, program, errors, lineNo, paramScope) {
  if (slotMeta.type === 'num') {
    return parseNumeric(token, program, errors, lineNo, paramScope);
  }
  if (slotMeta.type === 'str') {
    return parseAny(token, program, errors, lineNo, paramScope);
  }
  if (slotMeta.type === 'bool') {
    return parseBoolean(token, program, errors, lineNo, paramScope);
  }
  if (slotMeta.type === 'var') {
    // [name v] -> declare variable, return as VARIABLE field
    const name = token.raw;
    if (!name) {
      errors.push({ line: lineNo, msg: `Empty variable name in [...]` });
      return { kind: 'field', name: slotMeta.name, value: '', isVariable: true };
    }
    program.variables.add(name);
    return { kind: 'field', name: slotMeta.name, value: name, isVariable: true };
  }
  if (slotMeta.type === 'list') {
    const name = token.raw;
    if (!name) {
      errors.push({ line: lineNo, msg: `Empty list name in [...]` });
      return { kind: 'field', name: slotMeta.name, value: '', isList: true };
    }
    program.lists.add(name);
    return { kind: 'field', name: slotMeta.name, value: name, isList: true };
  }
  if (slotMeta.type === 'field') {
    return { kind: 'field', name: slotMeta.name, value: token.raw };
  }
  if (slotMeta.type === 'broadcastField') {
    const name = token.raw || slotMeta.default || 'message1';
    program.broadcasts.add(name);
    return { kind: 'field', name: slotMeta.name, value: name, isBroadcast: true };
  }
  if (slotMeta.type === 'broadcast') {
    const name = token.raw || slotMeta.default || 'message1';
    program.broadcasts.add(name);
    return { kind: 'broadcast', name: slotMeta.name, value: name };
  }
  if (slotMeta.type === 'menu') {
    return {
      kind: 'menu',
      name: slotMeta.name,
      menuOpcode: slotMeta.menuOpcode,
      value: token.raw,
    };
  }
  if (slotMeta.type === 'color') {
    if (!isHexColor(token.raw)) {
      errors.push({ line: lineNo, msg: `Expected color like [#ff0000 c], got [${token.raw}]` });
    }
    return { kind: 'color', name: slotMeta.name, value: normalizeHexColor(token.raw) };
  }
  if (slotMeta.type === 'index') {
    if (token.kind === 'round') return parseIndex(token, slotMeta, program, errors, lineNo, paramScope);
    return { kind: 'index', name: slotMeta.name, value: token.raw || slotMeta.default || '1' };
  }
  errors.push({ line: lineNo, msg: `Unknown slot type "${slotMeta.type}"` });
  return null;
}

function parseIndex(token, slotMeta, program, errors, lineNo, paramScope) {
  const raw = token.raw;
  if (isPureNumber(raw)) return { kind: 'index', name: slotMeta.name, value: raw };
  const inner = tokenizeLine(raw);
  for (const rt of BLOCKS.REPORTERS) {
    const caps = matchTemplate(rt, inner);
    if (caps !== null) {
      const args = caps.map((t, i) => parseArg(rt.slots[i], t, program, errors, lineNo, paramScope));
      return { kind: 'reporter', template: rt, args };
    }
  }
  if (inner.every(t => t.kind === 'word')) {
    const name = raw.trim();
    if (name) {
      if (paramScope && paramScope.has(name)) {
        const p = paramScope.get(name);
        return { kind: 'arg', name, type: p.type };
      }
      program.variables.add(name);
      return { kind: 'var', name };
    }
  }
  errors.push({ line: lineNo, msg: `Cannot parse list index "(${raw})"` });
  return { kind: 'index', name: slotMeta.name, value: slotMeta.default || '1' };
}

function parseNumeric(token, program, errors, lineNo, paramScope) {
  if (token.kind !== 'round') {
    errors.push({ line: lineNo, msg: `Expected (number) got ${token.kind}` });
    return { kind: 'num', value: '0' };
  }
  const raw = token.raw;
  if (isPureNumber(raw)) return { kind: 'num', value: raw };
  const trimmed = raw.trim();
  if (paramScope && paramScope.has(trimmed)) {
    const p = paramScope.get(trimmed);
    return { kind: 'arg', name: trimmed, type: p.type };
  }
  // try reporter templates
  const inner = tokenizeLine(raw);
  for (const rt of BLOCKS.REPORTERS) {
    const caps = matchTemplate(rt, inner);
    if (caps !== null) {
      const args = caps.map((t, i) => parseArg(rt.slots[i], t, program, errors, lineNo, paramScope));
      return { kind: 'reporter', template: rt, args };
    }
  }
  // fallback: bare identifier -> variable reporter
  if (inner.every(t => t.kind === 'word')) {
    const name = trimmed;
    if (name) {
      program.variables.add(name);
      return { kind: 'var', name };
    }
  }
  errors.push({ line: lineNo, msg: `Cannot parse reporter "(${raw})"` });
  return { kind: 'num', value: '0' };
}

function parseAny(token, program, errors, lineNo, paramScope) {
  if (token.kind === 'square' && !token.dropdown) {
    const trimmed = token.raw.trim();
    if (paramScope && paramScope.has(trimmed)) {
      const p = paramScope.get(trimmed);
      return { kind: 'arg', name: trimmed, type: p.type };
    }
    return { kind: 'str', value: token.raw };
  }
  if (token.kind === 'round') {
    // treat as numeric reporter
    return parseNumeric(token, program, errors, lineNo, paramScope);
  }
  errors.push({ line: lineNo, msg: `Expected [string] or (number), got ${token.kind}` });
  return { kind: 'str', value: '' };
}

function parseBoolean(token, program, errors, lineNo, paramScope) {
  if (token.kind !== 'angle') {
    errors.push({ line: lineNo, msg: `Expected <boolean>, got ${token.kind}` });
    return null;
  }
  const raw = token.raw;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (paramScope && paramScope.has(trimmed)) {
    const p = paramScope.get(trimmed);
    return { kind: 'arg', name: trimmed, type: p.type };
  }
  const inner = tokenizeLine(raw);
  for (const bt of BLOCKS.BOOLEANS) {
    const caps = matchTemplate(bt, inner);
    if (caps !== null) {
      const args = caps.map((t, i) => parseArg(bt.slots[i], t, program, errors, lineNo, paramScope));
      return { kind: 'boolean', template: bt, args };
    }
  }
  errors.push({ line: lineNo, msg: `Cannot parse boolean "<${raw}>"` });
  return null;
}

// --- statement parsing --------------------------------------------------

function tryStatementTemplate(tokens, extras) {
  for (const tmpl of BLOCKS.STATEMENTS) {
    const caps = matchTemplate(tmpl, tokens);
    if (caps !== null) return { tmpl, caps };
  }
  if (extras) {
    for (const tmpl of extras) {
      const caps = matchTemplate(tmpl, tokens);
      if (caps !== null) return { tmpl, caps };
    }
  }
  return null;
}

// --- program parsing (indentation -> structure) -------------------------

function indentWidth(line) {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i += line[i] === '\t' ? 4 : 1;
  }
  return i;
}

function stripQuotes(text) {
  let value = (text || '').trim();
  let bracketed = false;
  if (value[0] === '[' && value[value.length - 1] === ']') {
    bracketed = true;
    value = value.slice(1, -1).trim();
  }
  if (bracketed) value = value.replace(/\s+[vcl]\s*$/i, '').trim();
  if ((value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === "'" && value[value.length - 1] === "'")) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function parseStageHeader(text) {
  return /^(stage|background)\s*$/i.test(text);
}

function parseSpriteHeader(text) {
  const m = /^(sprite|character|char)\s+(.+)$/i.exec(text);
  if (!m) return null;
  const name = stripQuotes(m[2]);
  return name || null;
}

function parseAssetHeader(text, keyword) {
  const re = new RegExp('^' + keyword + '(?:\\s+(.+?))?(?:\\s+from\\s+(.+))?$', 'i');
  const m = re.exec(text);
  if (!m) return null;
  return {
    name: stripQuotes(m[1] || ''),
    sourcePath: stripQuotes(m[2] || ''),
  };
}

function parseCostumeHeader(text) {
  return parseAssetHeader(text, 'costume');
}

function parseBackdropHeader(text) {
  return parseAssetHeader(text, 'backdrop');
}

// `local variable [name]` / `local list [name]` declares a sprite-local
// ("for this sprite only") variable or list. Also accepts `var`.
function parseLocalDeclaration(text) {
  const m = /^local\s+(variable|var|list)\s+(.+)$/i.exec(text);
  if (!m) return null;
  const name = stripQuotes(m[2]);
  if (!name) return null;
  return { kind: m[1].toLowerCase() === 'list' ? 'list' : 'variable', name };
}

function parseDefineHeader(text) {
  const m = /^define\s+(.+)$/i.exec(text);
  if (!m) return null;
  let rest = m[1].trim();
  if (!rest) return null;
  // `define warp <proccode>` marks the custom block "run without screen
  // refresh" (atomic) — essential for physics/collision loops.
  let warp = false;
  const wm = /^(warp|atomic)\s+(.+)$/i.exec(rest);
  if (wm) { warp = true; rest = wm[2].trim(); }
  let tokens;
  try { tokens = tokenizeLine(rest); }
  catch (e) { return null; }
  const paramNames = [];
  const paramTypes = [];
  const paramDefaults = [];
  let proccode = '';
  for (const t of tokens) {
    if (t.kind === 'round') {
      paramNames.push(t.raw.trim());
      paramTypes.push('num');
      paramDefaults.push('0');
      proccode += ' %n';
    } else if (t.kind === 'square' && !t.dropdown && !t.color) {
      paramNames.push(t.raw.trim());
      paramTypes.push('str');
      paramDefaults.push('');
      proccode += ' %s';
    } else if (t.kind === 'angle') {
      paramNames.push(t.raw.trim());
      paramTypes.push('bool');
      paramDefaults.push('false');
      proccode += ' %b';
    } else if (t.kind === 'word') {
      proccode += ' ' + t.text;
    } else if (t.kind === 'square') {
      proccode += ' [' + t.raw + (t.dropdown ? ' v' : t.color ? ' c' : '') + ']';
    }
  }
  proccode = proccode.trim();
  if (!proccode) return null;
  return {
    originalText: rest,
    proccode,
    paramNames,
    paramTypes,
    paramDefaults,
    warp,
  };
}

function parsePlainNumber(raw) {
  const value = stripQuotes(String(raw || '').replace(/^\((.*)\)$/, '$1'));
  return isPureNumber(value) ? Number(value) : null;
}

function parseTargetBoolean(raw) {
  const value = stripQuotes(raw).toLowerCase();
  if (value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === 'no' || value === 'off') return false;
  return null;
}

function looksLikeTargetProperty(text) {
  return /^(position|size|direction|visible|draggable|rotation\s*style|rotationStyle|layer\s*order|layerOrder|current\s*costume|currentCostume|current\s*backdrop|currentBackdrop|tempo|video\s*state|videoState|video\s*transparency|videoTransparency|text\s*to\s*speech\s*language|textToSpeechLanguage)\b/i.test(text);
}

function parseTargetProperty(text, target, errors, lineNo, isStage) {
  let m;

  m = /^position\s+x:\s*([^\s]+)\s+y:\s*([^\s]+)$/i.exec(text);
  if (m) {
    const x = parsePlainNumber(m[1]);
    const y = parsePlainNumber(m[2]);
    if (x === null || y === null) {
      errors.push({ line: lineNo, msg: `Expected numeric position like "position x: (0) y: (-100)"` });
    } else {
      target.x = x;
      target.y = y;
    }
    return true;
  }

  m = /^size\s+(.+)$/i.exec(text);
  if (m && !isStage) {
    const size = parsePlainNumber(m[1]);
    if (size === null) errors.push({ line: lineNo, msg: `Expected numeric size like "size (100)"` });
    else target.size = size;
    return true;
  }

  m = /^direction\s+(.+)$/i.exec(text);
  if (m && !isStage) {
    const direction = parsePlainNumber(m[1]);
    if (direction === null) errors.push({ line: lineNo, msg: `Expected numeric direction like "direction (90)"` });
    else target.direction = direction;
    return true;
  }

  m = /^visible\s+(.+)$/i.exec(text);
  if (m && !isStage) {
    const visible = parseTargetBoolean(m[1]);
    if (visible === null) errors.push({ line: lineNo, msg: `Expected visible true or visible false` });
    else target.visible = visible;
    return true;
  }

  m = /^draggable\s+(.+)$/i.exec(text);
  if (m && !isStage) {
    const draggable = parseTargetBoolean(m[1]);
    if (draggable === null) errors.push({ line: lineNo, msg: `Expected draggable true or draggable false` });
    else target.draggable = draggable;
    return true;
  }

  m = /^(?:rotation\s*style|rotationStyle)\s+(.+)$/i.exec(text);
  if (m && !isStage) {
    target.rotationStyle = stripQuotes(m[1]);
    return true;
  }

  m = /^(?:layer\s*order|layerOrder)\s+(.+)$/i.exec(text);
  if (m && !isStage) {
    const layerOrder = parsePlainNumber(m[1]);
    if (layerOrder === null) errors.push({ line: lineNo, msg: `Expected numeric layerOrder` });
    else target.layerOrder = layerOrder;
    return true;
  }

  m = /^(?:current\s*costume|currentCostume)\s+(.+)$/i.exec(text);
  if (m) {
    const value = stripQuotes(m[1]);
    const numeric = parsePlainNumber(value);
    if (numeric === null) target.currentCostumeName = value;
    else target.currentCostume = numeric;
    return true;
  }

  m = /^(?:current\s*backdrop|currentBackdrop)\s+(.+)$/i.exec(text);
  if (m && isStage) {
    const value = stripQuotes(m[1]);
    const numeric = parsePlainNumber(value);
    if (numeric === null) target.currentCostumeName = value;
    else target.currentCostume = numeric;
    return true;
  }

  m = /^tempo\s+(.+)$/i.exec(text);
  if (m && isStage) {
    const tempo = parsePlainNumber(m[1]);
    if (tempo === null) errors.push({ line: lineNo, msg: `Expected numeric tempo` });
    else target.tempo = tempo;
    return true;
  }

  m = /^(?:video\s*transparency|videoTransparency)\s+(.+)$/i.exec(text);
  if (m && isStage) {
    const value = parsePlainNumber(m[1]);
    if (value === null) errors.push({ line: lineNo, msg: `Expected numeric videoTransparency` });
    else target.videoTransparency = value;
    return true;
  }

  m = /^(?:video\s*state|videoState)\s+(.+)$/i.exec(text);
  if (m && isStage) {
    target.videoState = stripQuotes(m[1]);
    return true;
  }

  m = /^(?:text\s*to\s*speech\s*language|textToSpeechLanguage)\s+(.+)$/i.exec(text);
  if (m && isStage) {
    const value = stripQuotes(m[1]);
    target.textToSpeechLanguage = value || null;
    return true;
  }

  if (looksLikeTargetProperty(text)) {
    errors.push({ line: lineNo, msg: `Target property is not valid here: "${text}"` });
    return true;
  }

  return false;
}

function parseCostumeNumber(token, errors, lineNo, label) {
  if (!token || token.kind !== 'round' || !isPureNumber(token.raw)) {
    errors.push({ line: lineNo, msg: `Expected (${label}) in costume shape` });
    return 0;
  }
  return Number(token.raw);
}

function parseCostumeColor(token, errors, lineNo) {
  if (!token || token.kind !== 'square' || !(token.color || isHexColor(token.raw))) {
    errors.push({ line: lineNo, msg: `Expected color like [#ff0000 c] in costume shape` });
    return '#000000';
  }
  if (!isHexColor(token.raw)) {
    errors.push({ line: lineNo, msg: `Expected color like [#ff0000 c], got [${token.raw}]` });
  }
  return normalizeHexColor(token.raw);
}

function parseCostumeText(token, errors, lineNo) {
  if (!token || token.kind !== 'square' || token.dropdown || token.color) {
    errors.push({ line: lineNo, msg: `Expected [text] in costume text shape` });
    return '';
  }
  return token.raw;
}

function addCostumeShape(costume, line, errors) {
  let tokens;
  try { tokens = tokenizeLine(line.text); }
  catch (e) {
    errors.push({ line: line.no, msg: e.message });
    return;
  }
  if (tokens.length === 0) return;
  const word = i => tokens[i] && tokens[i].kind === 'word' ? tokens[i].text.toLowerCase() : '';
  const shape = word(0);

  if (shape === 'canvas' || shape === 'size') {
    costume.width = parseCostumeNumber(tokens[1], errors, line.no, 'width');
    costume.height = parseCostumeNumber(tokens[2], errors, line.no, 'height');
    costume.centerX = costume.width / 2;
    costume.centerY = costume.height / 2;
    return;
  }

  if (shape === 'center') {
    costume.centerX = parseCostumeNumber(tokens[1], errors, line.no, 'center x');
    costume.centerY = parseCostumeNumber(tokens[2], errors, line.no, 'center y');
    return;
  }

  if (shape === 'circle') {
    costume.shapes.push({
      type: 'circle',
      cx: parseCostumeNumber(tokens[1], errors, line.no, 'cx'),
      cy: parseCostumeNumber(tokens[2], errors, line.no, 'cy'),
      r: parseCostumeNumber(tokens[3], errors, line.no, 'radius'),
      fill: parseCostumeColor(tokens[4], errors, line.no),
    });
    return;
  }

  if (shape === 'ellipse') {
    costume.shapes.push({
      type: 'ellipse',
      cx: parseCostumeNumber(tokens[1], errors, line.no, 'cx'),
      cy: parseCostumeNumber(tokens[2], errors, line.no, 'cy'),
      rx: parseCostumeNumber(tokens[3], errors, line.no, 'rx'),
      ry: parseCostumeNumber(tokens[4], errors, line.no, 'ry'),
      fill: parseCostumeColor(tokens[5], errors, line.no),
    });
    return;
  }

  const isRoundRect = shape === 'roundrect' || (shape === 'round' && word(1) === 'rect');
  if (shape === 'rect' || isRoundRect) {
    const offset = isRoundRect && shape === 'round' ? 1 : 0;
    const entry = {
      type: 'rect',
      x: parseCostumeNumber(tokens[1 + offset], errors, line.no, 'x'),
      y: parseCostumeNumber(tokens[2 + offset], errors, line.no, 'y'),
      width: parseCostumeNumber(tokens[3 + offset], errors, line.no, 'width'),
      height: parseCostumeNumber(tokens[4 + offset], errors, line.no, 'height'),
      fill: parseCostumeColor(tokens[5 + offset + (isRoundRect ? 1 : 0)], errors, line.no),
    };
    if (isRoundRect) entry.radius = parseCostumeNumber(tokens[5 + offset], errors, line.no, 'radius');
    costume.shapes.push(entry);
    return;
  }

  if (shape === 'line') {
    costume.shapes.push({
      type: 'line',
      x1: parseCostumeNumber(tokens[1], errors, line.no, 'x1'),
      y1: parseCostumeNumber(tokens[2], errors, line.no, 'y1'),
      x2: parseCostumeNumber(tokens[3], errors, line.no, 'x2'),
      y2: parseCostumeNumber(tokens[4], errors, line.no, 'y2'),
      stroke: parseCostumeColor(tokens[5], errors, line.no),
      width: tokens[6] ? parseCostumeNumber(tokens[6], errors, line.no, 'line width') : 1,
    });
    return;
  }

  if (shape === 'text') {
    costume.shapes.push({
      type: 'text',
      text: parseCostumeText(tokens[1], errors, line.no),
      x: parseCostumeNumber(tokens[2], errors, line.no, 'x'),
      y: parseCostumeNumber(tokens[3], errors, line.no, 'y'),
      size: parseCostumeNumber(tokens[4], errors, line.no, 'font size'),
      fill: parseCostumeColor(tokens[5], errors, line.no),
    });
    return;
  }

  if (shape === 'polygon' || shape === 'poly') {
    const points = parseCostumeText(tokens[1], errors, line.no);
    if (!/^[-+0-9.,\s]+$/.test(points)) {
      errors.push({ line: line.no, msg: `Polygon points must look like [0,0 10,10 20,0]` });
    }
    costume.shapes.push({
      type: 'polygon',
      points,
      fill: parseCostumeColor(tokens[2], errors, line.no),
    });
    return;
  }

  errors.push({ line: line.no, msg: `Unknown costume shape: "${line.text}"` });
}

// Axis-aligned bounding box [minX, minY, maxX, maxY] of a parsed shape, or
// null if it has none. Used only for validation warnings.
function shapeBBox(s) {
  switch (s.type) {
    case 'circle':  return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'ellipse': return [s.cx - s.rx, s.cy - s.ry, s.cx + s.rx, s.cy + s.ry];
    case 'rect':    return [s.x, s.y, s.x + s.width, s.y + s.height];
    case 'line':    return [Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)];
    case 'text':    return [s.x, s.y - s.size, s.x, s.y]; // baseline at y; text rises above
    case 'polygon': {
      const nums = (String(s.points).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const xs = [], ys = [];
      for (let i = 0; i + 1 < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
      if (!xs.length) return null;
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    default: return null;
  }
}

// Catches the most common AI mistake: drawing with Scratch *stage* coordinates
// (origin in the centre, negatives allowed) instead of costume *SVG*
// coordinates (origin top-left). Such shapes pile up in the top-left corner.
function validateCostume(costume, kind, warnings) {
  const W = costume.width, H = costume.height;
  const cx = W / 2, cy = H / 2;
  const hint = `Costume shapes use SVG coordinates: (0,0) is the TOP-LEFT corner, ` +
    `the centre is (${cx},${cy}). Use x in 0..${W}, y in 0..${H} — these are NOT ` +
    `Scratch stage coordinates (which are centred and allow negatives).`;

  if ((!costume.shapes || costume.shapes.length === 0) && !costume.sourcePath) {
    warnings.push({ line: costume._line, severity: 'warning',
      msg: `${kind} "${costume.name}" has no shapes and no \`from "..."\` source; ` +
        `a default placeholder image is used. Add shapes or \`from "file.svg"\` ` +
        `to give it real artwork.` });
    return;
  }

  let negative = false;
  for (const s of costume.shapes) {
    const bb = shapeBBox(s);
    if (!bb) continue;
    const [minX, minY, maxX, maxY] = bb;
    if (minX < 0 || minY < 0) negative = true;
    if (maxX <= 0 || maxY <= 0 || minX >= W || minY >= H) {
      warnings.push({ line: s._line, severity: 'warning',
        msg: `${kind} "${costume.name}": ${s.type} lies entirely outside the ` +
          `canvas (0,0)-(${W},${H}) and will not be visible. ${hint}` });
    }
  }
  if (negative) {
    warnings.push({ line: costume._line, severity: 'warning',
      msg: `${kind} "${costume.name}" uses negative coordinates, which fall off ` +
        `the top-left of the canvas. ${hint}` });
  }
}

function parseProgram(source) {
  const stage = { name: 'Stage', scripts: [], backdrops: [],
    localVars: new Set(), localLists: new Set() };
  const program = {
    stage,
    scripts: [],
    sprites: [],
    variables: new Set(),
    lists: new Set(),
    broadcasts: new Set(),
  };
  const errors = [];
  const warnings = [];
  const defaultSprite = { name: 'Sprite1', scripts: program.scripts, costumes: [],
    localVars: new Set(), localLists: new Set() };
  const namedSprites = [];

  function getSprite(name) {
    const cleanName = (name || '').trim() || 'Sprite1';
    if (cleanName.toLowerCase() === 'sprite1') return defaultSprite;
    let sprite = namedSprites.find(s => s.name === cleanName);
    if (!sprite) {
      sprite = { name: cleanName, scripts: [], costumes: [],
        localVars: new Set(), localLists: new Set() };
      namedSprites.push(sprite);
    }
    return sprite;
  }

  const rawLines = source.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.replace(/\s+$/, '');
    if (!trimmed.trim()) continue;
    // strip a leading `//` or `#` comment
    if (/^\s*(\/\/|#)/.test(trimmed)) continue;
    lines.push({ indent: indentWidth(trimmed), text: trimmed.trim(), no: i + 1 });
  }

  // ---- Pre-scan custom procedure definitions per target ----
  const customProcedures = new Map(); // targetName -> callTemplate[]
  {
    let targetName = 'Sprite1';
    for (const line of lines) {
      if (parseStageHeader(line.text)) { targetName = 'Stage'; continue; }
      const sName = parseSpriteHeader(line.text);
      if (sName !== null) { targetName = sName; continue; }
      const dm = parseDefineHeader(line.text);
      if (dm) {
        if (!customProcedures.has(targetName)) customProcedures.set(targetName, []);
        const slots = [];
        const nameOf = i => 'arg_' + dm.paramNames[i].replace(/[^A-Za-z0-9_]/g, '_');
        const parts = parseTemplatePattern(dm.proccode);
        let pi = 0;
        for (const p of parts) {
          if (p.slot) {
            const type = dm.paramTypes[pi];
            slots.push({
              type: type === 'num' ? 'num' : type === 'str' ? 'str' : 'bool',
              name: nameOf(pi),
              default: dm.paramDefaults[pi],
            });
            pi++;
          }
        }
        customProcedures.get(targetName).push({
          shape: 'stack',
          text: dm.proccode,
          opcode: 'procedures_call',
          slots,
          _isCustomCall: true,
          _proccode: dm.proccode,
          _paramNames: dm.paramNames,
          _paramTypes: dm.paramTypes,
          _paramDefaults: dm.paramDefaults,
          _warp: dm.warp,
        });
      }
    }
  }

  let idx = 0;

  // Parse a stack at a given indent level. Stops when a line with lower
  // indent appears or we see `end`/`else` tokens.
  function parseStack(minIndent, paramScope) {
    const extras = customProcedures.get(currentTarget.name) || null;
    const body = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < minIndent) break;
      if (line.text === 'end') return body;
      if (line.text === 'else') return body;
      if (parseStageHeader(line.text)) return body;
      if (parseSpriteHeader(line.text)) return body;
      if (parseCostumeHeader(line.text)) return body;
      if (parseBackdropHeader(line.text)) return body;
      if (looksLikeTargetProperty(line.text)) return body;
      if (parseLocalDeclaration(line.text)) return body;
      const defineMeta = parseDefineHeader(line.text);
      if (defineMeta) return body;

      const tokens = (() => {
        try { return tokenizeLine(line.text); }
        catch (e) {
          errors.push({ line: line.no, msg: e.message });
          return null;
        }
      })();
      if (!tokens) { idx++; continue; }

      const match = tryStatementTemplate(tokens, extras);
      if (!match) {
        errors.push({ line: line.no, msg: `Unknown block: "${line.text}"` });
        idx++;
        continue;
      }

      // A new hat terminates the current script without consuming the line.
      if (match.tmpl.shape === 'hat') return body;

      idx++; // consume this header line
      const { tmpl, caps } = match;
      const args = caps.map((t, i) => parseArg(tmpl.slots[i], t, program, errors, line.no, paramScope));

      const block = { template: tmpl, args, line: line.no };

      if (tmpl.shape === 'c') {
        const childIndent = line.indent + 1; // any deeper is "inside"
        block.substack = parseStack(childIndent, paramScope);
        // consume optional `else` -> second substack
        if (tmpl.canElse && idx < lines.length && lines[idx].indent === line.indent && lines[idx].text === 'else') {
          idx++;
          block.substack2 = parseStack(childIndent, paramScope);
        }
        // consume trailing `end`
        if (idx < lines.length && lines[idx].indent === line.indent && lines[idx].text === 'end') {
          idx++;
        } else {
          errors.push({ line: line.no, msg: `Missing "end" for "${tmpl.text}"` });
        }
      }

      body.push(block);
    }
    return body;
  }

  // Top-level: a sequence of target sections and scripts. A script starts
  // with a hat (or just a stack of blocks if no hat is present). Blocks at
  // the same indent form the next script's body; a new hat starts a new
  // script. `stage`, `sprite Name`, or `character Name` switches the current
  // Scratch target.
  let currentTarget = defaultSprite;
  let currentIsStage = false;

  function targetHasContent(target) {
    return (target.scripts && target.scripts.length > 0) ||
      (target.costumes && target.costumes.length > 0) ||
      (target.localVars && target.localVars.size > 0) ||
      (target.localLists && target.localLists.size > 0) ||
      target.x !== undefined || target.y !== undefined ||
      target.size !== undefined || target.direction !== undefined ||
      target.visible !== undefined || target.draggable !== undefined ||
      target.rotationStyle !== undefined || target.layerOrder !== undefined ||
      target.currentCostume !== undefined || target.currentCostumeName !== undefined;
  }

  function defaultCostumeSize(isStage) {
    return isStage
      ? { width: 480, height: 360, centerX: 240, centerY: 180 }
      : { width: 48, height: 48, centerX: 24, centerY: 24 };
  }

  function parseCostumeLike(line, isBackdrop) {
    const header = isBackdrop ? parseBackdropHeader(line.text) : parseCostumeHeader(line.text);
    const owner = isBackdrop ? stage : currentTarget;
    const isStageCostume = isBackdrop || owner === stage;
    const size = defaultCostumeSize(isStageCostume);
    const keyword = isStageCostume ? 'backdrop' : 'costume';
    const kind = isStageCostume ? 'Backdrop' : 'Costume';
    const costume = {
      name: header.name || `${keyword}${(isStageCostume ? stage.backdrops : owner.costumes).length + 1}`,
      width: size.width,
      height: size.height,
      centerX: size.centerX,
      centerY: size.centerY,
      shapes: [],
    };
    costume._line = line.no;

    // This build cannot create or import artwork. A costume/backdrop is only a
    // named placeholder; the actual image must be added by hand in Scratch after
    // importing the .sb3. So `from "..."` imports and the drawing DSL (canvas,
    // circle, rect, ...) are rejected here rather than silently accepted.
    if (header.sourcePath) {
      errors.push({ line: line.no, msg:
        `Importing images with \`from "..."\` is disabled in this build. ` +
        `Write just \`${keyword} ${costume.name}\` and add the ${kind.toLowerCase()} ` +
        `artwork yourself in Scratch after importing the .sb3.` });
    }

    const costumeIndent = line.indent;
    idx++;
    let sawDrawing = false;
    while (idx < lines.length) {
      const shapeLine = lines[idx];
      if (shapeLine.indent <= costumeIndent) break;
      if (parseStageHeader(shapeLine.text) || parseSpriteHeader(shapeLine.text) ||
          parseCostumeHeader(shapeLine.text) || parseBackdropHeader(shapeLine.text) ||
          looksLikeTargetProperty(shapeLine.text)) break;
      sawDrawing = true; // a drawing-DSL line (canvas/circle/rect/...) — disabled
      idx++;
    }
    if (sawDrawing) {
      errors.push({ line: costume._line, msg:
        `Drawing ${kind.toLowerCase()}s in text (canvas, circle, rect, ...) is disabled ` +
        `in this build. Write just \`${keyword} ${costume.name}\` and add the artwork ` +
        `yourself in Scratch after importing the .sb3.` });
    }

    if (isStageCostume) stage.backdrops.push(costume);
    else owner.costumes.push(costume);
  }

  function parseScript() {
    const line = lines[idx];
    if (parseStageHeader(line.text)) {
      currentTarget = stage;
      currentIsStage = true;
      idx++;
      return null;
    }

    const headerName = parseSpriteHeader(line.text);
    if (headerName !== null) {
      currentTarget = getSprite(headerName);
      currentIsStage = false;
      idx++;
      return null;
    }

    const backdropHeader = parseBackdropHeader(line.text);
    if (backdropHeader !== null) {
      parseCostumeLike(line, true);
      return null;
    }

    const costumeHeader = parseCostumeHeader(line.text);
    if (costumeHeader !== null) {
      parseCostumeLike(line, currentIsStage);
      return null;
    }

    if (parseTargetProperty(line.text, currentTarget, errors, line.no, currentIsStage)) {
      idx++;
      return null;
    }

    const localDecl = parseLocalDeclaration(line.text);
    if (localDecl) {
      if (currentIsStage) {
        // The Stage has no "for this sprite only" scope; its variables are the
        // global ones. Treat a local declaration there as a global declaration.
        if (localDecl.kind === 'list') program.lists.add(localDecl.name);
        else program.variables.add(localDecl.name);
      } else {
        const set = localDecl.kind === 'list' ? currentTarget.localLists : currentTarget.localVars;
        set.add(localDecl.name);
      }
      idx++;
      return null;
    }

    if (/^(sprite|character|char)\s*$/i.test(line.text)) {
      errors.push({ line: line.no, msg: `Missing character name after "${line.text}"` });
      idx++;
      return null;
    }

    // stray end/else at top level
    if (line.text === 'end' || line.text === 'else') {
      errors.push({ line: line.no, msg: `Unexpected "${line.text}" at top level` });
      idx++;
      return null;
    }

    // custom procedure definition
    const defineMeta = parseDefineHeader(line.text);
    if (defineMeta) {
      idx++;
      const paramScope = new Map();
      for (let pi = 0; pi < defineMeta.paramNames.length; pi++) {
        paramScope.set(defineMeta.paramNames[pi],
          { type: defineMeta.paramTypes[pi], default: defineMeta.paramDefaults[pi] });
      }
      const body = parseStack(line.indent + 1, paramScope);
      // validate call templates exist
      const extras = customProcedures.get(currentTarget.name) || [];
      const callTmpl = extras.find(t => t._proccode === defineMeta.proccode);
      if (!callTmpl) {
        errors.push({ line: line.no, msg: `Internal error: could not find call template for "${defineMeta.proccode}"` });
      }
      const hat = {
        template: {
          shape: 'hat',
          text: 'define ' + defineMeta.proccode,
          opcode: 'procedures_definition',
          slots: [],
          _isCustomDefinition: true,
          _proccode: defineMeta.proccode,
          _paramNames: defineMeta.paramNames,
          _paramTypes: defineMeta.paramTypes,
          _paramDefaults: defineMeta.paramDefaults,
          _warp: defineMeta.warp,
        },
        args: [],
        line: line.no,
      };
      return { hat, body };
    }

    // Start a script. Parse one top-level statement, which might be a hat.
    const tokens = (() => {
      try { return tokenizeLine(line.text); }
      catch (e) { errors.push({ line: line.no, msg: e.message }); return null; }
    })();
    if (!tokens) { idx++; return null; }
    const extras = customProcedures.get(currentTarget.name) || null;
    const match = tryStatementTemplate(tokens, extras);
    if (!match) {
      errors.push({ line: line.no, msg: `Unknown block: "${line.text}"` });
      idx++;
      return null;
    }

    const { tmpl, caps } = match;
    const args = caps.map((t, i) => parseArg(tmpl.slots[i], t, program, errors, line.no));
    const head = { template: tmpl, args, line: line.no };
    idx++;

    let body = [];
    if (tmpl.shape === 'c') {
      const childIndent = line.indent + 1;
      head.substack = parseStack(childIndent);
      if (tmpl.canElse && idx < lines.length && lines[idx].indent === line.indent && lines[idx].text === 'else') {
        idx++;
        head.substack2 = parseStack(childIndent);
      }
      if (idx < lines.length && lines[idx].indent === line.indent && lines[idx].text === 'end') {
        idx++;
      } else {
        errors.push({ line: line.no, msg: `Missing "end" for "${tmpl.text}"` });
      }
    }

    if (tmpl.shape === 'hat') {
      // the rest of the script at the same indent is the body
      body = parseStack(line.indent);
      return { hat: head, body };
    }

    // headless script: just this block + any siblings at same indent
    body = [head];
    body = body.concat(parseStack(line.indent));
    return { hat: null, body };
  }

  while (idx < lines.length) {
    const script = parseScript();
    if (script) currentTarget.scripts.push(script);
  }

  program.sprites = targetHasContent(defaultSprite)
    ? [defaultSprite].concat(namedSprites)
    : namedSprites;

  return { program, errors, warnings };
}

global.PARSER = { parseProgram, tokenizeLine };

})(window);
