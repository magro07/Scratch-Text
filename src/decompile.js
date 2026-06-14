// Reverse direction: walk a Scratch 3 project.json and emit Scratch Text that
// parses back (via parser.js) into an equivalent project. This is the inverse
// of compile.js. Costume *artwork* cannot be turned back into the shape DSL
// (the shapes are gone once rendered to SVG). This build also cannot import
// images, so costumes are emitted by name only — the user re-adds the artwork
// in Scratch after loading the project.
//
// See AGENT.md § 8.3. Unknown opcodes degrade to a `// unknown: <opcode>`
// comment instead of crashing.

(function (global) {
'use strict';

// --- reverse template registry ----------------------------------------
// opcode -> canonical template. First template registered for an opcode wins,
// so the preferred spelling (listed first in blocks.js) is used.
function buildRegistry() {
  const byOpcode = {};
  const register = list => {
    for (const t of list) {
      if (!byOpcode[t.opcode]) byOpcode[t.opcode] = t;
    }
  };
  register(BLOCKS.HATS);
  register(BLOCKS.STACKS);
  register(BLOCKS.C_BLOCKS);
  register(BLOCKS.REPORTERS);
  register(BLOCKS.BOOLEANS);
  // if/else shares the `if %b then` template (it carries the else metadata).
  if (byOpcode.control_if) byOpcode.control_if_else = byOpcode.control_if;
  return byOpcode;
}

// Inverse of compile.js's SPECIAL_MENU_VALUES: special token -> friendly text,
// keyed by menu opcode so `_random_` maps to the right phrase per block.
const MENU_REVERSE = {
  motion_goto_menu: { _mouse_: 'mouse-pointer', _random_: 'random position' },
  motion_glideto_menu: { _mouse_: 'mouse-pointer', _random_: 'random position' },
  motion_pointtowards_menu: { _mouse_: 'mouse-pointer', _random_: 'random direction' },
  sensing_touchingobjectmenu: { _mouse_: 'mouse-pointer', _edge_: 'edge' },
  sensing_distancetomenu: { _mouse_: 'mouse-pointer' },
  sensing_of_object_menu: { _stage_: 'stage' },
  control_create_clone_of_menu: { _myself_: 'myself' },
};

function isPureNumber(raw) {
  return /^-?\d+(\.\d+)?$/.test(String(raw));
}

// --- expression rendering ---------------------------------------------

function decompiler(project) {
  const byOpcode = buildRegistry();

  // Render a reporter/boolean block to its inner text (no surrounding
  // bracket; the caller's slot adds it).
  function renderBlockExpr(blockId, target) {
    const b = target.blocks[blockId];
    if (!b) return '';
    // Top-level primitives are stored as arrays, e.g. [12, name, id, x, y] for
    // a variable reporter or [13, name, id] for a list.
    if (Array.isArray(b)) {
      if (b[0] === 12 || b[0] === 13) return String(b[1]);
      return String(b[1] !== undefined ? b[1] : '');
    }
    if (b.opcode === 'argument_reporter_string_number' ||
        b.opcode === 'argument_reporter_boolean') {
      return (b.fields.VALUE && b.fields.VALUE[0]) || '';
    }
    const tmpl = byOpcode[b.opcode];
    if (!tmpl) return '/* ' + b.opcode + ' */';
    return fillTemplate(tmpl, b, target);
  }

  // Value inside a (round) numeric slot (no parens).
  function renderNum(inp, target) {
    if (!inp) return '0';
    const v = inp[1];
    if (Array.isArray(v)) {
      if (v[0] === 12 || v[0] === 13) return v[1]; // variable / list reporter
      return String(v[1]);                          // literal
    }
    return renderBlockExpr(v, target);              // reporter block id
  }

  // Full token for a %s slot: [literal] or (reporter)/(variable).
  function renderStr(inp, target) {
    if (!inp) return '[]';
    const v = inp[1];
    if (Array.isArray(v)) {
      if (v[0] === 12 || v[0] === 13) return '(' + v[1] + ')';
      return '[' + String(v[1]) + ']';
    }
    return '(' + renderBlockExpr(v, target) + ')';
  }

  // Full token for a %i list-index slot: (number)/(reporter) or [keyword v].
  function renderIndex(inp, target) {
    if (!inp) return '(1)';
    const v = inp[1];
    if (Array.isArray(v)) {
      if (v[0] === 12 || v[0] === 13) return '(' + v[1] + ')';
      const val = String(v[1]);
      return isPureNumber(val) ? '(' + val + ')' : '[' + val + ' v]';
    }
    return '(' + renderBlockExpr(v, target) + ')';
  }

  function renderColor(inp) {
    if (!inp) return '#000000';
    const v = inp[1];
    return Array.isArray(v) ? String(v[1]) : '#000000';
  }

  function fieldText(field) {
    return field ? String(field[0]) : '';
  }

  function renderMenu(slot, block, target) {
    const inp = block.inputs[slot.name];
    if (!inp) return slot.default || '';
    const ref = inp[1];
    let value = '';
    if (typeof ref === 'string') {
      const mb = target.blocks[ref];
      if (mb && mb.fields) {
        const f = mb.fields[slot.name] || mb.fields[Object.keys(mb.fields)[0]];
        value = f ? String(f[0]) : '';
      }
    } else if (Array.isArray(ref)) {
      value = String(ref[1]); // inline primitive (rare for menus)
    }
    const rev = MENU_REVERSE[slot.menuOpcode];
    return (rev && rev[value] !== undefined) ? rev[value] : value;
  }

  // Render one slot to its bracketed source token.
  function renderSlot(slot, block, target) {
    switch (slot.type) {
      case 'num':   return '(' + renderNum(block.inputs[slot.name], target) + ')';
      case 'str':   return renderStr(block.inputs[slot.name], target);
      case 'index': return renderIndex(block.inputs[slot.name], target);
      case 'color': return '[' + renderColor(block.inputs[slot.name]) + ' c]';
      case 'bool': {
        const inp = block.inputs[slot.name];
        if (!inp || inp[1] === undefined || inp[1] === null) return '<>';
        return '<' + renderBlockExpr(inp[1], target) + '>';
      }
      case 'var':
      case 'list':
      case 'field':
      case 'broadcastField':
        return '[' + fieldText(block.fields[slot.name]) + ' v]';
      case 'broadcast': {
        const inp = block.inputs[slot.name];
        const name = inp && Array.isArray(inp[1]) ? inp[1][1] : '';
        return '[' + (name || '') + ' v]';
      }
      case 'menu':
        return '[' + renderMenu(slot, block, target) + ' v]';
      default:
        return '';
    }
  }

  // Substitute a template's %-markers with rendered slot tokens in order.
  function fillTemplate(tmpl, block, target) {
    const slots = tmpl.slots || [];
    const parts = tmpl.text.split(/%[a-z]/);
    let out = parts[0];
    for (let i = 0; i < slots.length; i++) {
      out += renderSlot(slots[i], block, target) + (parts[i + 1] || '');
    }
    return out;
  }

  // --- custom procedures ------------------------------------------------

  function fillProccode(proccode, render) {
    let i = 0;
    return proccode.replace(/%[nsb]/g, marker => render(marker, i++));
  }

  function emitDefine(block, target) {
    const protoRef = block.inputs.custom_block;
    const proto = protoRef && target.blocks[protoRef[1]];
    const mut = proto && proto.mutation;
    if (!mut) return 'define (unknown custom block)';
    let names = [];
    try { names = JSON.parse(mut.argumentnames || '[]'); } catch (e) { names = []; }
    const text = fillProccode(mut.proccode, (marker, i) => {
      const name = names[i] !== undefined ? names[i] : '';
      if (marker === '%n') return '(' + name + ')';
      if (marker === '%b') return '<' + name + '>';
      return '[' + name + ']';
    });
    return 'define ' + (mut.warp === 'true' || mut.warp === true ? 'warp ' : '') + text;
  }

  function emitCall(block, target) {
    const mut = block.mutation || {};
    let ids = [];
    try { ids = JSON.parse(mut.argumentids || '[]'); } catch (e) { ids = []; }
    return fillProccode(mut.proccode || '', (marker, i) => {
      const inp = block.inputs[ids[i]];
      if (marker === '%n') return '(' + renderNum(inp, target) + ')';
      if (marker === '%b') return (inp && inp[1] != null) ? '<' + renderBlockExpr(inp[1], target) + '>' : '<>';
      return renderStr(inp, target);
    });
  }

  // --- statement / script emission --------------------------------------

  function firstChildId(inp) {
    return inp && Array.isArray(inp) ? inp[1] : null;
  }

  function emitChain(firstId, target, indent, lines) {
    let id = firstId;
    while (id) {
      const b = target.blocks[id];
      if (!b || typeof b !== 'object' || Array.isArray(b) || !b.opcode) break;
      emitStatement(b, target, indent, lines);
      id = b.next;
    }
  }

  function emitStatement(block, target, indent, lines) {
    const pad = ' '.repeat(indent);
    const op = block.opcode;

    if (op === 'procedures_definition') { lines.push(pad + emitDefine(block, target)); return; }
    if (op === 'procedures_call')       { lines.push(pad + emitCall(block, target)); return; }

    const tmpl = byOpcode[op];
    if (!tmpl) { lines.push(pad + '// unknown: ' + op); return; }

    if (tmpl.shape === 'c') {
      lines.push(pad + fillTemplate(tmpl, block, target));
      const subName = tmpl.substack || 'SUBSTACK';
      emitChain(firstChildId(block.inputs[subName]), target, indent + 4, lines);
      const elseName = tmpl.elseSubstack || 'SUBSTACK2';
      if (block.inputs[elseName]) {
        lines.push(pad + 'else');
        emitChain(firstChildId(block.inputs[elseName]), target, indent + 4, lines);
      }
      lines.push(pad + 'end');
      return;
    }

    lines.push(pad + fillTemplate(tmpl, block, target));
  }

  function topLevelIds(target) {
    return Object.keys(target.blocks)
      .filter(id => {
        const b = target.blocks[id];
        // Skip top-level primitives (arrays) and anything without an opcode.
        if (!b || typeof b !== 'object' || Array.isArray(b) || !b.opcode) return false;
        if (!b.topLevel) return false;
        // Skip orphan reporter/boolean blocks left floating in the editor —
        // they are expressions, not runnable scripts, and would otherwise be
        // emitted as invalid statement lines.
        const tmpl = byOpcode[b.opcode];
        if (tmpl && (tmpl.shape === 'reporter' || tmpl.shape === 'boolean')) return false;
        return true;
      })
      .sort((a, b) => {
        const A = target.blocks[a], B = target.blocks[b];
        return (A.x - B.x) || (A.y - B.y);
      });
  }

  // --- target sections --------------------------------------------------

  function emitLocals(target, lines) {
    for (const id of Object.keys(target.variables || {})) {
      lines.push('local variable [' + target.variables[id][0] + ']');
    }
    for (const id of Object.keys(target.lists || {})) {
      lines.push('local list [' + target.lists[id][0] + ']');
    }
  }

  function emitCostumes(target, lines) {
    const keyword = target.isStage ? 'backdrop' : 'costume';
    const list = (target.costumes && target.costumes.length)
      ? target.costumes
      : (target._scratchTextCostumes || []);
    for (const c of list) {
      const name = c.name || (keyword + '1');
      // This build can't import artwork, so costumes decompile to a bare name
      // (the user re-adds the image in Scratch); we never emit `from "..."`.
      lines.push(`${keyword} ${name}`);
    }
  }

  function costumeNameAt(target, idx) {
    const list = (target.costumes && target.costumes.length)
      ? target.costumes : (target._scratchTextCostumes || []);
    return list[idx] && list[idx].name;
  }

  function emitSpriteMeta(target, indexInList, lines) {
    lines.push(`position x: (${target.x || 0}) y: (${target.y || 0})`);
    if (target.size !== undefined && target.size !== 100) lines.push(`size (${target.size})`);
    if (target.direction !== undefined && target.direction !== 90) lines.push(`direction (${target.direction})`);
    if (target.visible === false) lines.push('visible false');
    if (target.draggable === true) lines.push('draggable true');
    if (target.rotationStyle && target.rotationStyle !== 'all around') {
      lines.push(`rotation style [${target.rotationStyle}]`);
    }
    if (target.layerOrder !== undefined && target.layerOrder !== indexInList + 1) {
      lines.push(`layerOrder (${target.layerOrder})`);
    }
    if (target.currentCostume) {
      const name = costumeNameAt(target, target.currentCostume);
      lines.push(name ? `current costume [${name} v]` : `current costume (${target.currentCostume})`);
    }
  }

  function emitStageMeta(target, lines) {
    if (target.currentCostume) {
      const name = costumeNameAt(target, target.currentCostume);
      lines.push(name ? `current backdrop [${name} v]` : `current backdrop (${target.currentCostume})`);
    }
  }

  function emitTarget(target, indexInList, lines, opts) {
    const hasScripts = topLevelIds(target).length > 0;
    const costumes = (target.costumes && target.costumes.length)
      ? target.costumes : (target._scratchTextCostumes || []);
    const isDefaultStage = target.isStage && !hasScripts && costumes.length === 0;
    if (isDefaultStage) return; // an empty stage adds nothing useful

    if (lines.length > 0) lines.push('');

    if (target.isStage) {
      lines.push('stage');
      emitStageMeta(target, lines);
    } else {
      lines.push('sprite ' + target.name);
      emitSpriteMeta(target, indexInList, lines);
      // A sprite's variables/lists are all "for this sprite only" (globals
      // live on the Stage), so emit them as local declarations.
      emitLocals(target, lines);
    }
    emitCostumes(target, lines);

    for (const topId of topLevelIds(target)) {
      lines.push('');
      const head = target.blocks[topId];
      if (head.opcode === 'procedures_definition') {
        // A `define` hat's body must be indented (parser uses indent + 1),
        // unlike ordinary hats whose body sits at the same indent.
        lines.push(emitDefine(head, target));
        emitChain(head.next, target, 4, lines);
      } else {
        emitChain(topId, target, 0, lines);
      }
    }
  }

  function run() {
    const lines = [];
    const targets = project.targets || [];
    targets.forEach((target, i) => {
      emitTarget(target, i - 1, lines, {});
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '') + '\n';
  }

  return run();
}

function decompile(project) {
  return decompiler(project);
}

global.DECOMPILE = { decompile };

})(window);
