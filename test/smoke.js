// Node smoke test for parser + compiler + synchronous asset attachment.

const fs = require('fs');
const path = require('path');

const win = {};
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = require('util').TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = require('util').TextDecoder;
}

function loadModule(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(win);
  Object.assign(global, win);
}

loadModule('src/md5.js');
loadModule('src/blocks.js');
loadModule('src/parser.js');
loadModule('src/compile.js');
loadModule('src/sb3.js');

let pass = 0;
function check(name, cond, detail) {
  if (!cond) throw new Error(name + (detail ? ': ' + detail : ''));
  pass++;
}

const legacySample = [
  'when flag clicked',
  'say [Hello, Scratch Text!] for (2) seconds',
  'set [score v] to (0)',
  'forever',
  '    move (10) steps',
  '    if on edge, bounce',
  '    change [score v] by (1)',
  '    if <(score) > (20)> then',
  '        say [Twenty points!] for (1) seconds',
  '    end',
  'end',
  '',
  'when [space v] key pressed',
  'turn cw (15) degrees',
].join('\n');

const legacy = win.PARSER.parseProgram(legacySample);
check('legacy no parse errors', legacy.errors.length === 0, JSON.stringify(legacy.errors));
check('legacy scripts kept', legacy.program.scripts.length === 2);
const legacyProject = win.COMPILE.compile(legacy.program);
check('legacy has stage and default sprite', legacyProject.targets.length === 2);
check('legacy stage has no code', Object.keys(legacyProject.targets[0].blocks).length === 0);
check('legacy sprite has code', Object.keys(legacyProject.targets[1].blocks).length > 0);

const multiTargetSample = [
  'stage',
  '    backdrop Sky',
  '        canvas (480) (360)',
  '        rect (0) (0) (480) (360) [#88ccff c]',
  '    backdrop Night',
  '        canvas (480) (360)',
  '        rect (0) (0) (480) (360) [#111133 c]',
  '    current backdrop [Night v]',
  '    when green flag clicked',
  '        switch backdrop to [Sky v]',
  '    when backdrop switches to [Night v]',
  '        say [stage script]',
  '',
  'character Player',
  '    costume Idle',
  '        canvas (64) (64)',
  '        circle (32) (32) (28) [#ffcc66 c]',
  '    position x: (0) y: (-100)',
  '    size (90)',
  '    direction (45)',
  '    visible true',
  '    when flag clicked',
  '        go to x: (0) y: (-100)',
  '',
  'sprite Enemy',
  '    costume Default',
  '        canvas (32) (32)',
  '        rect (0) (0) (32) (32) [#ff3333 c]',
  '    visible false',
  '    when flag clicked',
  '        show',
].join('\n');

const multi = win.PARSER.parseProgram(multiTargetSample);
check('multi-target no parse errors', multi.errors.length === 0, JSON.stringify(multi.errors));
check('stage AST parsed', multi.program.stage.scripts.length === 2 && multi.program.stage.backdrops.length === 2);
check('sprite AST parsed', multi.program.sprites.length === 2);

const projectA = win.COMPILE.compile(multi.program);
const projectB = win.COMPILE.compile(multi.program);
check('compile deterministic JSON', JSON.stringify(projectA) === JSON.stringify(projectB));

const stage = projectA.targets.find(t => t.isStage);
const player = projectA.targets.find(t => t.name === 'Player');
const enemy = projectA.targets.find(t => t.name === 'Enemy');
check('targets exported', projectA.targets.length === 3 && stage && player && enemy);
check('stage scripts exported to stage', Object.values(stage.blocks).filter(b => b.topLevel).length === 2);
check('stage current backdrop resolved by name', stage.currentCostume === 1);
check('stage backdrop event present', Object.values(stage.blocks).some(b => b.opcode === 'event_whenbackdropswitchesto'));
check('player properties exported', player.x === 0 && player.y === -100 && player.size === 90 && player.direction === 45);
check('enemy property exported', enemy.visible === false);
check('block id prefixes are target-local',
  Object.keys(stage.blocks).every(id => id.indexOf('b_stage_') === 0) &&
  Object.keys(player.blocks).every(id => id.indexOf('b_sprite_1_Player_') === 0));

const assetProject = win.COMPILE.compile(win.PARSER.parseProgram([
  'stage',
  '    backdrop ExternalSky from "assets/sky.svg"',
  'sprite Player',
  '    costume ExternalPlayer from "assets/player.png"',
  '    when flag clicked',
  '        say [hi]',
].join('\n')).program);
const png1x1 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
  0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 248, 255, 31, 0,
  3, 3, 2, 0, 239, 191, 167, 219, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);
const resolved = win.SB3.attachAssets(assetProject, {
  resolveAsset(assetPath) {
    if (assetPath === 'assets/sky.svg') {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#fff"/></svg>';
    }
    if (assetPath === 'assets/player.png') return png1x1;
    return null;
  },
});
check('external assets attached', resolved.assets.length === 2);
check('stage external backdrop is svg', assetProject.targets[0].costumes[0].dataFormat === 'svg');
check('sprite external costume is png', assetProject.targets[1].costumes[0].dataFormat === 'png');
check('png center inferred', assetProject.targets[1].costumes[0].rotationCenterX === 24);
check('missing asset throws', (() => {
  try { win.SB3.attachAssets(win.COMPILE.compile(win.PARSER.parseProgram('sprite Missing\ncostume Bad from "missing.svg"').program)); }
  catch (e) { return /Missing asset resolver|Asset not found/.test(e.message); }
  return false;
})());

// ---- Clone blocks ----
const cloneSrc = [
  'sprite Shooter',
  '    when flag clicked',
  '        create clone of [myself v]',
  '        create clone of [Bullet v]',
  '',
  'sprite Bullet',
  '    when I start as a clone',
  '        move (10) steps',
  '        if on edge, bounce',
  '        delete this clone',
].join('\n');

const cloneResult = win.PARSER.parseProgram(cloneSrc);
check('clone parse no errors', cloneResult.errors.length === 0, JSON.stringify(cloneResult.errors));

const cloneProject = win.COMPILE.compile(cloneResult.program);
const shooterTarget = cloneProject.targets.find(t => t.name === 'Shooter');
const bulletTarget = cloneProject.targets.find(t => t.name === 'Bullet');
check('clone targets present', !!shooterTarget && !!bulletTarget);

const shooterBlocks = Object.values(shooterTarget.blocks);
const bulletBlocks = Object.values(bulletTarget.blocks);

const cloneOfBlock = shooterBlocks.find(b => b.opcode === 'control_create_clone_of');
check('create clone of block present', !!cloneOfBlock);

const cloneMenuBlock = cloneOfBlock && shooterTarget.blocks[cloneOfBlock.inputs.CLONE_OPTION[1]];
check('create clone of myself normalized',
  cloneMenuBlock && cloneMenuBlock.fields.CLONE_OPTION[0] === '_myself_');

const allCloneOfs = shooterBlocks.filter(b => b.opcode === 'control_create_clone_of');
check('create clone of other sprite present', allCloneOfs.length === 2);
const bulletMenu = allCloneOfs.map(b => shooterTarget.blocks[b.inputs.CLONE_OPTION[1]])
  .find(m => m && m.fields.CLONE_OPTION[0] === 'Bullet');
check('create clone of Bullet value', !!bulletMenu);

check('when I start as a clone hat present',
  bulletBlocks.some(b => b.opcode === 'control_start_as_clone' && b.topLevel));
check('delete this clone present',
  bulletBlocks.some(b => b.opcode === 'control_delete_this_clone'));

// ---- Custom procedures (My Blocks) ----
const procSrc = [
  'define jump (height) says [msg]',
  '    say [msg]',
  '    change y by (height)',
  '',
  'when flag clicked',
  '    jump (10) says [Hello!]',
].join('\n');

const proc = win.PARSER.parseProgram(procSrc);
check('custom proc parse no errors', proc.errors.length === 0, JSON.stringify(proc.errors));
const procSprite = proc.program.sprites[0];
check('custom proc scripts count', procSprite.scripts.length === 2);

const procProject = win.COMPILE.compile(proc.program);
const procTarget = procProject.targets[1];
const procBlocks = Object.values(procTarget.blocks);
const defBlock = procBlocks.find(b => b.opcode === 'procedures_definition');
check('custom proc definition emitted', !!defBlock);
if (defBlock) {
  const protoId = defBlock.inputs.custom_block && defBlock.inputs.custom_block[1];
  const protoBlock = procTarget.blocks[protoId];
  check('custom proc prototype emitted', !!protoBlock);
  if (protoBlock) {
    const mut = protoBlock.mutation;
    check('custom proc prototype proccode', mut && mut.proccode === 'jump %n says %s');
    check('custom proc prototype argumentids', mut && mut.argumentids === '["arg_height","arg_msg"]');
    check('custom proc prototype argumentnames', mut && mut.argumentnames === '["height","msg"]');
    check('custom proc prototype argumentdefaults', mut && mut.argumentdefaults === '["0",""]');
  }
}

const callBlock = procBlocks.find(b => b.opcode === 'procedures_call');
check('custom proc call emitted', !!callBlock);
if (callBlock) {
  check('custom proc call mutation proccode', callBlock.mutation && callBlock.mutation.proccode === 'jump %n says %s');
  check('custom proc call arg_height', callBlock.inputs.arg_height && callBlock.inputs.arg_height[1][1] === '10');
  check('custom proc call arg_msg', callBlock.inputs.arg_msg && callBlock.inputs.arg_msg[1][1] === 'Hello!');
}

const argReporter = procBlocks.find(b => b.opcode === 'argument_reporter_string_number');
check('custom proc arg reporter emitted', !!argReporter);
if (argReporter) {
  check('custom proc arg reporter field', argReporter.fields.VALUE && argReporter.fields.VALUE[0] === 'msg');
}

console.log(`${pass} PASS`);
