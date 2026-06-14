// Walks the AST produced by parser.js and emits a Scratch 3 project.json.
//
// Scratch 3 input-field encoding cheatsheet:
//   num literal:             [1, [4, "N"]]
//   str literal:             [1, [10, "..."]]
//   variable reporter:       [3, [12, name, id], fallback]
//   block reporter:          [3, "blockId", fallback]
//   bool block:              [2, "blockId"]
//   c-block SUBSTACK:        [2, "firstBlockId"]
//   menu shadow block:       [1, "menuBlockId"]
//   color literal:           [1, [9, "#ff0000"]]
//   broadcast literal:       [1, [11, name, id]]
//
// Shadow primitive type codes used here:
//   4  = math_number,  5 = math_positive_number,  6 = math_whole_number
//   8  = math_angle,  9 = color_picker,  10 = text
//   11 = broadcast,  12 = variable reporter,  13 = list reporter

(function (global) {
'use strict';

const SHADOW_NUM = 4;
const SHADOW_POSITIVE_NUM = 5;
const SHADOW_WHOLE_NUM = 6;
const SHADOW_INTEGER = 7;
const SHADOW_ANGLE = 8;
const SHADOW_COLOR = 9;
const SHADOW_TEXT = 10;
const PRIM_BROADCAST = 11;
const PRIM_VARIABLE = 12;

function sanitizeBlockPrefix(name) {
  return String(name || 'target').replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'target';
}

function makeIdGen(prefix) {
  let counter = 0;
  const cleanPrefix = sanitizeBlockPrefix(prefix);
  return () => `b_${cleanPrefix}_${++counter}`;
}

function sanitizeVarId(name) {
  return 'var_' + name.replace(/[^A-Za-z0-9_]/g, '_') + '_' + name.length;
}

function sanitizeListId(name) {
  return 'list_' + name.replace(/[^A-Za-z0-9_]/g, '_') + '_' + name.length;
}

// Sprite-local ids are namespaced by the target prefix so a local variable and
// a same-named global (or another sprite's local) never collide.
function sanitizeLocalVarId(prefix, name) {
  return 'lvar_' + sanitizeBlockPrefix(prefix) + '_' + name.replace(/[^A-Za-z0-9_]/g, '_') + '_' + name.length;
}

function sanitizeLocalListId(prefix, name) {
  return 'llist_' + sanitizeBlockPrefix(prefix) + '_' + name.replace(/[^A-Za-z0-9_]/g, '_') + '_' + name.length;
}

function sanitizeBroadcastId(name) {
  return 'broadcast_' + name.replace(/[^A-Za-z0-9_]/g, '_') + '_' + name.length;
}

function sanitizeArgId(name) {
  return 'arg_' + name.replace(/[^A-Za-z0-9_]/g, '_');
}

function primitiveForSlot(slot) {
  if (!slot) return SHADOW_NUM;
  if (slot.type === 'str') return SHADOW_TEXT;
  if (slot.type === 'index') return SHADOW_POSITIVE_NUM;
  if (slot.type === 'color') return SHADOW_COLOR;
  if (slot.primitive === 'positive') return SHADOW_POSITIVE_NUM;
  if (slot.primitive === 'whole') return SHADOW_WHOLE_NUM;
  if (slot.primitive === 'integer') return SHADOW_INTEGER;
  if (slot.primitive === 'angle') return SHADOW_ANGLE;
  return SHADOW_NUM;
}

function fallbackForSlot(slot) {
  return [primitiveForSlot(slot), slot && slot.default !== undefined ? slot.default : '0'];
}

const SPECIAL_MENU_VALUES = {
  motion_goto_menu: {
    'mouse-pointer': '_mouse_',
    'mouse pointer': '_mouse_',
    'random position': '_random_',
  },
  motion_glideto_menu: {
    'mouse-pointer': '_mouse_',
    'mouse pointer': '_mouse_',
    'random position': '_random_',
  },
  motion_pointtowards_menu: {
    'mouse-pointer': '_mouse_',
    'mouse pointer': '_mouse_',
    'random direction': '_random_',
  },
  sensing_touchingobjectmenu: {
    'mouse-pointer': '_mouse_',
    'mouse pointer': '_mouse_',
    edge: '_edge_',
  },
  sensing_distancetomenu: {
    'mouse-pointer': '_mouse_',
    'mouse pointer': '_mouse_',
  },
  sensing_of_object_menu: {
    stage: '_stage_',
  },
  control_create_clone_of_menu: {
    myself: '_myself_',
  },
};

function normalizeMenuValue(slot, value) {
  const raw = value !== undefined && value !== '' ? String(value) : String(slot.default || '');
  const map = SPECIAL_MENU_VALUES[slot.menuOpcode] || {};
  return map[raw.trim().toLowerCase()] || raw;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function numAttr(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}

function dataFormatFromPath(path) {
  const m = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(path || '');
  if (!m) return '';
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function renderCostumeSvg(costume, defaults) {
  const width = Math.max(1, Number(costume.width) || (defaults && defaults.width) || 48);
  const height = Math.max(1, Number(costume.height) || (defaults && defaults.height) || 48);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${numAttr(width)}" height="${numAttr(height)}" viewBox="0 0 ${numAttr(width)} ${numAttr(height)}">`,
  ];
  // A costume declared without any shapes would otherwise export as a blank
  // (invisible) SVG. Fall back to a visible default placeholder so the sprite
  // still shows up — the user keeps the costume name and gets a warning.
  if (!costume.shapes || costume.shapes.length === 0) {
    const isStageBackdrop = defaults && defaults.name === 'backdrop1';
    if (isStageBackdrop) {
      parts.push(`<rect width="${numAttr(width)}" height="${numAttr(height)}" fill="#ffffff"/>`);
    } else {
      const r = Math.max(1, Math.min(width, height) / 2 - 1);
      parts.push(`<circle cx="${numAttr(width / 2)}" cy="${numAttr(height / 2)}" r="${numAttr(r)}" fill="#4c97ff" stroke="#3373cc" stroke-width="2"/>`);
    }
    parts.push('</svg>');
    return {
      name: costume.name || (defaults && defaults.name) || 'costume1',
      svg: parts.join(''),
      rotationCenterX: Number.isFinite(Number(costume.centerX)) ? Number(costume.centerX) : width / 2,
      rotationCenterY: Number.isFinite(Number(costume.centerY)) ? Number(costume.centerY) : height / 2,
    };
  }
  for (const shape of costume.shapes || []) {
    if (shape.type === 'circle') {
      parts.push(`<circle cx="${numAttr(shape.cx)}" cy="${numAttr(shape.cy)}" r="${numAttr(shape.r)}" fill="${escapeXml(shape.fill)}"/>`);
    } else if (shape.type === 'ellipse') {
      parts.push(`<ellipse cx="${numAttr(shape.cx)}" cy="${numAttr(shape.cy)}" rx="${numAttr(shape.rx)}" ry="${numAttr(shape.ry)}" fill="${escapeXml(shape.fill)}"/>`);
    } else if (shape.type === 'rect') {
      const radius = shape.radius !== undefined ? ` rx="${numAttr(shape.radius)}" ry="${numAttr(shape.radius)}"` : '';
      parts.push(`<rect x="${numAttr(shape.x)}" y="${numAttr(shape.y)}" width="${numAttr(shape.width)}" height="${numAttr(shape.height)}"${radius} fill="${escapeXml(shape.fill)}"/>`);
    } else if (shape.type === 'line') {
      parts.push(`<line x1="${numAttr(shape.x1)}" y1="${numAttr(shape.y1)}" x2="${numAttr(shape.x2)}" y2="${numAttr(shape.y2)}" stroke="${escapeXml(shape.stroke)}" stroke-width="${numAttr(shape.width)}" stroke-linecap="round"/>`);
    } else if (shape.type === 'text') {
      parts.push(`<text x="${numAttr(shape.x)}" y="${numAttr(shape.y)}" fill="${escapeXml(shape.fill)}" font-family="Arial, Helvetica, sans-serif" font-size="${numAttr(shape.size)}" text-anchor="middle">${escapeXml(shape.text)}</text>`);
    } else if (shape.type === 'polygon') {
      parts.push(`<polygon points="${escapeXml(shape.points)}" fill="${escapeXml(shape.fill)}"/>`);
    }
  }
  parts.push('</svg>');
  return {
    name: costume.name || (defaults && defaults.name) || 'costume1',
    svg: parts.join(''),
    rotationCenterX: Number.isFinite(Number(costume.centerX)) ? Number(costume.centerX) : width / 2,
    rotationCenterY: Number.isFinite(Number(costume.centerY)) ? Number(costume.centerY) : height / 2,
  };
}

function renderCostumeAsset(costume, defaults) {
  if (costume && costume.sourcePath) {
    return {
      name: costume.name || defaults.name,
      path: costume.sourcePath,
      dataFormat: costume.dataFormat || dataFormatFromPath(costume.sourcePath),
      rotationCenterX: Number.isFinite(Number(costume.centerX)) ? Number(costume.centerX) : defaults.centerX,
      rotationCenterY: Number.isFinite(Number(costume.centerY)) ? Number(costume.centerY) : defaults.centerY,
      bitmapResolution: costume.bitmapResolution,
    };
  }
  return renderCostumeSvg(costume || {}, defaults);
}

function resolveCurrentCostume(targetSpec, costumeAssets) {
  if (!targetSpec) return 0;
  if (targetSpec.currentCostumeName) {
    const wanted = String(targetSpec.currentCostumeName).toLowerCase();
    const idx = costumeAssets.findIndex(c => String(c.name || '').toLowerCase() === wanted);
    return idx >= 0 ? idx : 0;
  }
  if (Number.isFinite(Number(targetSpec.currentCostume))) {
    const idx = Number(targetSpec.currentCostume);
    return idx >= 0 && idx < costumeAssets.length ? idx : 0;
  }
  return 0;
}

function compile(program) {
  const variables = {};        // variableId -> [name, defaultValue]
  const lists = {};            // listId -> [name, items]
  const broadcasts = {};       // broadcastId -> name
  const extensions = new Set();

  // Names declared "for this sprite only" in any sprite must not also be
  // pre-declared as globals on the Stage (a genuine global reference elsewhere
  // still creates one lazily during the script walk).
  const allLocalVarNames = new Set();
  const allLocalListNames = new Set();
  for (const sp of program.sprites || []) {
    for (const n of sp.localVars || []) allLocalVarNames.add(n);
    for (const n of sp.localLists || []) allLocalListNames.add(n);
  }

  // Pre-declare global variables/lists on Stage.
  for (const name of program.variables || []) {
    if (!allLocalVarNames.has(name)) ensureVariable(name);
  }
  for (const name of program.lists || []) {
    if (!allLocalListNames.has(name)) ensureList(name);
  }
  for (const name of program.broadcasts || []) {
    ensureBroadcast(name);
  }

  function ensureVariable(name) {
    const id = sanitizeVarId(name);
    if (!variables[id]) variables[id] = [name, 0];
    return id;
  }

  function ensureList(name) {
    const id = sanitizeListId(name);
    if (!lists[id]) lists[id] = [name, []];
    return id;
  }

  function ensureBroadcast(name) {
    const id = sanitizeBroadcastId(name);
    if (!broadcasts[id]) broadcasts[id] = name;
    return id;
  }

  function markExtension(template) {
    if (template && template.extension) extensions.add(template.extension);
  }

  function compileScripts(scripts, idPrefix, scope) {
    const nextId = makeIdGen(idPrefix);
    const blocks = {};
    let hatX = 60, hatY = 60;

    // Resolve a variable/list name to its id, preferring this target's locals
    // ("for this sprite only") over the global Stage scope.
    function resolveVarId(name) {
      if (scope && scope.localVars && scope.localVars.has(name)) {
        const id = sanitizeLocalVarId(idPrefix, name);
        if (!scope.varDict[id]) scope.varDict[id] = [name, 0];
        return id;
      }
      return ensureVariable(name);
    }
    function resolveListId(name) {
      if (scope && scope.localLists && scope.localLists.has(name)) {
        const id = sanitizeLocalListId(idPrefix, name);
        if (!scope.listDict[id]) scope.listDict[id] = [name, []];
        return id;
      }
      return ensureList(name);
    }

    for (const script of scripts || []) {
      let firstId = null;
      let prevId = null;

      function emitBlock(block, parentId) {
        markExtension(block.template);
        const id = nextId();
        const entry = {
          opcode: block.template.opcode,
          next: null,
          parent: parentId,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: false,
        };
        blocks[id] = entry;

        if (block.template._isCustomDefinition) {
          // procedures_definition hat with a custom_block input pointing to prototype
          entry.opcode = 'procedures_definition';
          const prototypeId = emitProcedurePrototype(block.template, id);
          entry.inputs.custom_block = [1, prototypeId];
          return id;
        }

        if (block.template._isCustomCall) {
          entry.opcode = 'procedures_call';
          entry.mutation = makeCallMutation(block.template);
          const slots = block.template.slots || [];
          for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const arg = block.args[i];
            emitArg(entry, id, slot, arg);
          }
          return id;
        }

        // Emit args as inputs/fields.
        const slots = block.template.slots || [];
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          const arg = block.args[i];
          emitArg(entry, id, slot, arg);
        }
        emitFixedInputs(entry, id, block.template.fixedInputs);

        // c-block SUBSTACK and SUBSTACK2
        if (block.template.shape === 'c') {
          if (block.substack && block.substack.length > 0) {
            const firstChildId = emitChain(block.substack, id);
            const sub = block.template.substack || 'SUBSTACK';
            entry.inputs[sub] = [2, firstChildId];
          }
          if (block.substack2 && block.substack2.length > 0) {
            const firstChildId = emitChain(block.substack2, id);
            const sub2 = block.template.elseSubstack || 'SUBSTACK2';
            entry.inputs[sub2] = [2, firstChildId];
            // if/else uses a different opcode
            if (block.template.elseOpcode) entry.opcode = block.template.elseOpcode;
          }
        }

        return id;
      }

      // Emit a sequential chain and return the id of the first block.
      function emitChain(list, parentId) {
        let firstChild = null;
        let prevChild = null;
        for (let k = 0; k < list.length; k++) {
          const childId = emitBlock(list[k], prevChild === null ? parentId : prevChild);
          if (firstChild === null) firstChild = childId;
          if (prevChild !== null) blocks[prevChild].next = childId;
          prevChild = childId;
        }
        return firstChild;
      }

      function emitArg(ownerEntry, ownerId, slot, arg) {
        if (!arg) return;
        switch (arg.kind) {
          case 'num': {
            ownerEntry.inputs[slot.name] = [1, [primitiveForSlot(slot), arg.value]];
            break;
          }
          case 'str': {
            ownerEntry.inputs[slot.name] = [1, [SHADOW_TEXT, arg.value]];
            break;
          }
          case 'index': {
            ownerEntry.inputs[slot.name] = [1, [SHADOW_POSITIVE_NUM, arg.value]];
            break;
          }
          case 'color': {
            ownerEntry.inputs[slot.name] = [1, [SHADOW_COLOR, arg.value]];
            break;
          }
          case 'broadcast': {
            const broadcastId = ensureBroadcast(arg.value);
            ownerEntry.inputs[slot.name] = [1, [PRIM_BROADCAST, arg.value, broadcastId]];
            break;
          }
          case 'var': {
            const varId = resolveVarId(arg.name);
            const shadow = slot.type === 'str' ? [SHADOW_TEXT, ''] : fallbackForSlot(slot);
            ownerEntry.inputs[slot.name] = [3, [PRIM_VARIABLE, arg.name, varId], shadow];
            break;
          }
          case 'reporter': {
            const innerId = emitReporter(arg, ownerId);
            const shadow = slot.type === 'str' ? [SHADOW_TEXT, ''] : fallbackForSlot(slot);
            ownerEntry.inputs[slot.name] = [3, innerId, shadow];
            break;
          }
          case 'boolean': {
            const innerId = emitBoolean(arg, ownerId);
            if (innerId) ownerEntry.inputs[slot.name] = [2, innerId];
            break;
          }
          case 'field': {
            if (arg.isVariable) {
              const varId = resolveVarId(arg.value);
              ownerEntry.fields[slot.name] = [arg.value, varId];
            } else if (arg.isList) {
              const listId = resolveListId(arg.value);
              ownerEntry.fields[slot.name] = [arg.value, listId];
            } else if (arg.isBroadcast) {
              const broadcastId = ensureBroadcast(arg.value);
              ownerEntry.fields[slot.name] = [arg.value, broadcastId];
            } else {
              ownerEntry.fields[slot.name] = [arg.value, null];
            }
            break;
          }
          case 'arg': {
            const argId = nextId();
            const isBool = arg.type === 'bool';
            blocks[argId] = {
              opcode: isBool ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
              next: null,
              parent: ownerId,
              inputs: {},
              fields: { VALUE: [arg.name, null] },
              shadow: false,
              topLevel: false,
            };
            const shadow = slot.type === 'str' ? [SHADOW_TEXT, ''] : fallbackForSlot(slot);
            ownerEntry.inputs[slot.name] = [3, argId, shadow];
            break;
          }
          case 'menu': {
            // Create a shadow menu block and reference it.
            const menuId = emitMenuShadow(ownerId, arg.menuOpcode, slot.name, normalizeMenuValue(slot, arg.value));
            ownerEntry.inputs[slot.name] = [1, menuId];
            break;
          }
        }
      }

      function emitMenuShadow(ownerId, opcode, fieldName, value) {
        const menuId = nextId();
        blocks[menuId] = {
          opcode,
          next: null,
          parent: ownerId,
          inputs: {},
          fields: { [fieldName]: [value, null] },
          shadow: true,
          topLevel: false,
        };
        return menuId;
      }

      function emitFixedInputs(ownerEntry, ownerId, fixedInputs) {
        if (!fixedInputs) return;
        for (const inputName of Object.keys(fixedInputs)) {
          const spec = fixedInputs[inputName];
          if (spec.type === 'menu') {
            const slot = {
              name: inputName,
              menuOpcode: spec.menuOpcode,
              default: spec.value,
            };
            const value = normalizeMenuValue(slot, spec.value);
            const menuId = emitMenuShadow(ownerId, spec.menuOpcode, spec.fieldName || inputName, value);
            ownerEntry.inputs[inputName] = [1, menuId];
          }
        }
      }

      function emitProcedurePrototype(meta, parentId) {
        const prototypeId = nextId();
        const ids = meta._paramNames.map(n => sanitizeArgId(n));
        const names = meta._paramNames;
        const defaults = meta._paramDefaults;
        blocks[prototypeId] = {
          opcode: 'procedures_prototype',
          next: null,
          parent: parentId,
          inputs: {},
          fields: {},
          shadow: true,
          topLevel: false,
          mutation: {
            tagName: 'mutation',
            children: [],
            proccode: meta._proccode,
            argumentids: JSON.stringify(ids),
            argumentnames: JSON.stringify(names),
            argumentdefaults: JSON.stringify(defaults),
            warp: meta._warp ? 'true' : 'false',
          },
        };
        return prototypeId;
      }

      function makeCallMutation(meta) {
        return {
          tagName: 'mutation',
          children: [],
          proccode: meta._proccode,
          argumentids: JSON.stringify(meta._paramNames.map(n => sanitizeArgId(n))),
          warp: meta._warp ? 'true' : 'false',
        };
      }

      function emitReporter(node, parentId) {
        markExtension(node.template);
        const id = nextId();
        const entry = {
          opcode: node.template.opcode,
          next: null,
          parent: parentId,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: false,
        };
        blocks[id] = entry;
        const slots = node.template.slots || [];
        for (let i = 0; i < slots.length; i++) {
          emitArg(entry, id, slots[i], node.args[i]);
        }
        return id;
      }

      function emitBoolean(node, parentId) {
        markExtension(node.template);
        const id = nextId();
        const entry = {
          opcode: node.template.opcode,
          next: null,
          parent: parentId,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: false,
        };
        blocks[id] = entry;
        const slots = node.template.slots || [];
        for (let i = 0; i < slots.length; i++) {
          emitArg(entry, id, slots[i], node.args[i]);
        }
        return id;
      }

      // Emit the script itself.
      const chain = [];
      if (script.hat) chain.push(script.hat);
      for (const b of script.body) chain.push(b);

      if (chain.length === 0) continue;

      for (let k = 0; k < chain.length; k++) {
        const id = emitBlock(chain[k], prevId);
        if (firstId === null) {
          firstId = id;
          blocks[id].topLevel = true;
          blocks[id].x = hatX;
          blocks[id].y = hatY;
        }
        if (prevId !== null) blocks[prevId].next = id;
        prevId = id;
      }

      hatY += 260;
      if (hatY > 900) { hatY = 60; hatX += 360; }
    }

    return blocks;
  }

  const stageSpec = program.stage || { name: 'Stage', scripts: [], backdrops: [] };
  const stageCostumeAssets = (stageSpec.backdrops || []).map(c => renderCostumeAsset(c, {
    name: 'backdrop1',
    width: 480,
    height: 360,
    centerX: 240,
    centerY: 180,
  }));

  const sourceSprites = program.sprites && program.sprites.length > 0
    ? program.sprites
    : ((program.scripts && program.scripts.length > 0)
      ? [{ name: 'Sprite1', scripts: program.scripts || [], costumes: [] }]
      : []);

  // Assemble project.json targets. Assets are filled in by sb3.js after
  // hashing.
  const stage = {
    isStage: true,
    name: 'Stage',
    variables,
    lists,
    broadcasts,
    blocks: compileScripts(stageSpec.scripts || [], 'stage'),
    comments: {},
    currentCostume: resolveCurrentCostume(stageSpec, stageCostumeAssets),
    costumes: [],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: stageSpec.tempo !== undefined ? stageSpec.tempo : 60,
    videoTransparency: stageSpec.videoTransparency !== undefined ? stageSpec.videoTransparency : 50,
    videoState: stageSpec.videoState || 'on',
    textToSpeechLanguage: stageSpec.textToSpeechLanguage !== undefined ? stageSpec.textToSpeechLanguage : null,
  };
  if (stageCostumeAssets.length > 0) {
    Object.defineProperty(stage, '_scratchTextCostumes', {
      value: stageCostumeAssets,
      enumerable: false,
    });
  }

  const sprites = sourceSprites.map((spriteSpec, i) => {
    const spread = sourceSprites.length <= 1 ? 0 : (i - (sourceSprites.length - 1) / 2) * 80;
    const designedCostumes = (spriteSpec.costumes || []).map(c => renderCostumeAsset(c, {
      name: 'costume1',
      width: 48,
      height: 48,
      centerX: 24,
      centerY: 24,
    }));
    const prefix = `sprite_${i + 1}_${spriteSpec.name || ''}`;
    // Sprite-local ("for this sprite only") variables/lists live on the sprite
    // target's own dicts, not the Stage. Pre-declare them so a declared-but-
    // unused local still exists, matching Scratch.
    const localVarDict = {};
    const localListDict = {};
    for (const name of spriteSpec.localVars || []) {
      localVarDict[sanitizeLocalVarId(prefix, name)] = [name, 0];
    }
    for (const name of spriteSpec.localLists || []) {
      localListDict[sanitizeLocalListId(prefix, name)] = [name, []];
    }
    const scope = {
      localVars: spriteSpec.localVars || new Set(),
      localLists: spriteSpec.localLists || new Set(),
      varDict: localVarDict,
      listDict: localListDict,
    };
    const sprite = {
      isStage: false,
      name: spriteSpec.name || `Sprite${i + 1}`,
      variables: localVarDict,
      lists: localListDict,
      broadcasts: {},
      blocks: compileScripts(spriteSpec.scripts || [], prefix, scope),
      comments: {},
      currentCostume: resolveCurrentCostume(spriteSpec, designedCostumes),
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: spriteSpec.layerOrder !== undefined ? spriteSpec.layerOrder : i + 1,
      visible: spriteSpec.visible !== undefined ? spriteSpec.visible : true,
      x: spriteSpec.x !== undefined ? spriteSpec.x : spread,
      y: spriteSpec.y !== undefined ? spriteSpec.y : 0,
      size: spriteSpec.size !== undefined ? spriteSpec.size : 100,
      direction: spriteSpec.direction !== undefined ? spriteSpec.direction : 90,
      draggable: spriteSpec.draggable !== undefined ? spriteSpec.draggable : false,
      rotationStyle: spriteSpec.rotationStyle || 'all around',
    };
    if (designedCostumes.length > 0) {
      Object.defineProperty(sprite, '_scratchTextCostumes', {
        value: designedCostumes,
        enumerable: false,
      });
    }
    return sprite;
  });

  // Emit a (hidden) monitor for every global variable and list so the
  // `show variable` / `show list` blocks have a monitor to toggle. Scratch
  // stacks them top-left; they appear only once `show variable` runs.
  const monitors = [];
  let monIndex = 0;
  for (const id of Object.keys(variables)) {
    monitors.push({
      id,
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: variables[id][0] },
      spriteName: null,
      value: variables[id][1],
      width: 0,
      height: 0,
      x: 5,
      y: 5 + monIndex * 26,
      visible: false,
      sliderMin: 0,
      sliderMax: 100,
      isDiscrete: true,
    });
    monIndex++;
  }
  for (const id of Object.keys(lists)) {
    monitors.push({
      id,
      mode: 'list',
      opcode: 'data_listcontents',
      params: { LIST: lists[id][0] },
      spriteName: null,
      value: lists[id][1],
      width: 100,
      height: 120,
      x: 5,
      y: 5 + monIndex * 26,
      visible: false,
    });
    monIndex++;
  }

  return {
    targets: [stage].concat(sprites),
    monitors,
    extensions: Array.from(extensions),
    meta: {
      semver: '3.0.0',
      vm: '0.2.0',
      agent: 'scratch-text',
    },
  };
}

global.COMPILE = { compile };

})(window);
