// Block template registry. Each template describes a scratchblocks-style
// text pattern plus the Scratch 3 opcode and slot mapping it compiles to.
//
// Slot markers in `text`:
//   %n = num slot     -> requires (round) bracket, default shadow math_number
//   %s = any slot     -> accepts (round) or [square], default shadow text
//   %b = bool slot    -> requires <angle> bracket, no shadow
//   %v = variable     -> requires [name v] dropdown, written as field
//   %l = list         -> requires [name v] dropdown, written as field
//   %m = menu         -> requires [val v] dropdown, may be direct field, broadcast,
//                       or menu shadow block
//   %c = color        -> accepts [#rrggbb c] or [#rrggbb], default shadow color_picker
//   %i = list index   -> accepts (1) or [last v], default shadow math_positive_number
//
// Shapes:
//   hat | stack | cap | c | c-else | reporter | boolean
//
// Slot metadata (order matches `%` markers in text):
//   { type: 'num'|'str'|'bool'|'var'|'list'|'field'|'menu'|'broadcast'|
//            'broadcastField'|'color'|'index', name, menuOpcode?, default? }
//
// Menu notes:
//   type='field' stores the value directly in `fields` (e.g. STOP_OPTION).
//   type='menu' wraps it in a shadow block of `menuOpcode` with a single field.

(function (global) {
'use strict';

const T = {
  HATS: [
    { shape: 'hat', text: 'when flag clicked',        opcode: 'event_whenflagclicked',    slots: [] },
    { shape: 'hat', text: 'when green flag clicked',  opcode: 'event_whenflagclicked',    slots: [] },
    { shape: 'hat', text: 'when greenFlag',           opcode: 'event_whenflagclicked',    slots: [] },
    { shape: 'hat', text: 'when %m key pressed',      opcode: 'event_whenkeypressed',
      slots: [{ type: 'field', name: 'KEY_OPTION', default: 'space' }] },
    { shape: 'hat', text: 'when this sprite clicked', opcode: 'event_whenthisspriteclicked', slots: [] },
    { shape: 'hat', text: 'when backdrop switches to %m', opcode: 'event_whenbackdropswitchesto',
      slots: [{ type: 'field', name: 'BACKDROP', default: 'backdrop1' }] },
    { shape: 'hat', text: 'when I receive %m', opcode: 'event_whenbroadcastreceived',
      slots: [{ type: 'broadcastField', name: 'BROADCAST_OPTION', default: 'message1' }] },
    { shape: 'hat', text: 'when I start as a clone', opcode: 'control_start_as_clone', slots: [] },
    { shape: 'hat', text: 'when %m > %n',           opcode: 'event_whengreaterthan',
      slots: [
        { type: 'field', name: 'WHENGREATERTHANMENU', default: 'loudness' },
        { type: 'num', name: 'VALUE', default: '10' },
      ] },
  ],

  STACKS: [
    // Motion
    { shape: 'stack', text: 'move %n steps',                         opcode: 'motion_movesteps',
      slots: [{ type: 'num', name: 'STEPS', default: '10' }] },
    { shape: 'stack', text: 'turn cw %n degrees',                    opcode: 'motion_turnright',
      slots: [{ type: 'num', name: 'DEGREES', default: '15' }] },
    { shape: 'stack', text: 'turn right %n degrees',                 opcode: 'motion_turnright',
      slots: [{ type: 'num', name: 'DEGREES', default: '15' }] },
    { shape: 'stack', text: 'turn ccw %n degrees',                   opcode: 'motion_turnleft',
      slots: [{ type: 'num', name: 'DEGREES', default: '15' }] },
    { shape: 'stack', text: 'turn left %n degrees',                  opcode: 'motion_turnleft',
      slots: [{ type: 'num', name: 'DEGREES', default: '15' }] },
    { shape: 'stack', text: 'go to x: %n y: %n',                     opcode: 'motion_gotoxy',
      slots: [{ type: 'num', name: 'X', default: '0' }, { type: 'num', name: 'Y', default: '0' }] },
    { shape: 'stack', text: 'glide %n secs to x: %n y: %n',          opcode: 'motion_glidesecstoxy',
      slots: [
        { type: 'num', name: 'SECS', default: '1' },
        { type: 'num', name: 'X', default: '0' },
        { type: 'num', name: 'Y', default: '0' },
      ] },
    { shape: 'stack', text: 'go to %m',                             opcode: 'motion_goto',
      slots: [{ type: 'menu', name: 'TO', menuOpcode: 'motion_goto_menu', default: '_random_' }] },
    { shape: 'stack', text: 'glide %n secs to %m',                  opcode: 'motion_glideto',
      slots: [
        { type: 'num', name: 'SECS', default: '1' },
        { type: 'menu', name: 'TO', menuOpcode: 'motion_glideto_menu', default: '_random_' },
      ] },
    { shape: 'stack', text: 'point in direction %n',                 opcode: 'motion_pointindirection',
      slots: [{ type: 'num', name: 'DIRECTION', default: '90', primitive: 'angle' }] },
    { shape: 'stack', text: 'point towards %m',                      opcode: 'motion_pointtowards',
      slots: [{ type: 'menu', name: 'TOWARDS', menuOpcode: 'motion_pointtowards_menu', default: '_mouse_' }] },
    { shape: 'stack', text: 'change x by %n',                        opcode: 'motion_changexby',
      slots: [{ type: 'num', name: 'DX', default: '10' }] },
    { shape: 'stack', text: 'set x to %n',                           opcode: 'motion_setx',
      slots: [{ type: 'num', name: 'X', default: '0' }] },
    { shape: 'stack', text: 'change y by %n',                        opcode: 'motion_changeyby',
      slots: [{ type: 'num', name: 'DY', default: '10' }] },
    { shape: 'stack', text: 'set y to %n',                           opcode: 'motion_sety',
      slots: [{ type: 'num', name: 'Y', default: '0' }] },
    { shape: 'stack', text: 'if on edge, bounce',                    opcode: 'motion_ifonedgebounce', slots: [] },
    { shape: 'stack', text: 'set rotation style %m',                 opcode: 'motion_setrotationstyle',
      slots: [{ type: 'field', name: 'STYLE', default: 'all around' }] },

    // Looks
    { shape: 'stack', text: 'say %s for %n seconds',                 opcode: 'looks_sayforsecs',
      slots: [{ type: 'str', name: 'MESSAGE', default: 'Hello!' }, { type: 'num', name: 'SECS', default: '2' }] },
    { shape: 'stack', text: 'say %s',                                opcode: 'looks_say',
      slots: [{ type: 'str', name: 'MESSAGE', default: 'Hello!' }] },
    { shape: 'stack', text: 'think %s for %n seconds',               opcode: 'looks_thinkforsecs',
      slots: [{ type: 'str', name: 'MESSAGE', default: 'Hmm...' }, { type: 'num', name: 'SECS', default: '2' }] },
    { shape: 'stack', text: 'think %s',                              opcode: 'looks_think',
      slots: [{ type: 'str', name: 'MESSAGE', default: 'Hmm...' }] },
    { shape: 'stack', text: 'show',                                  opcode: 'looks_show', slots: [] },
    { shape: 'stack', text: 'hide',                                  opcode: 'looks_hide', slots: [] },
    { shape: 'stack', text: 'switch costume to %m',                  opcode: 'looks_switchcostumeto',
      slots: [{ type: 'menu', name: 'COSTUME', menuOpcode: 'looks_costume', default: 'costume1' }] },
    { shape: 'stack', text: 'switch backdrop to %m',                 opcode: 'looks_switchbackdropto',
      slots: [{ type: 'menu', name: 'BACKDROP', menuOpcode: 'looks_backdrops', default: 'backdrop1' }] },
    { shape: 'stack', text: 'switch backdrop to %m and wait',        opcode: 'looks_switchbackdroptoandwait',
      slots: [{ type: 'menu', name: 'BACKDROP', menuOpcode: 'looks_backdrops', default: 'backdrop1' }] },
    { shape: 'stack', text: 'next backdrop',                         opcode: 'looks_nextbackdrop', slots: [] },
    { shape: 'stack', text: 'previous backdrop',                     opcode: 'looks_switchbackdropto', slots: [],
      fixedInputs: { BACKDROP: { type: 'menu', menuOpcode: 'looks_backdrops', fieldName: 'BACKDROP', value: 'previous backdrop' } } },
    { shape: 'stack', text: 'change size by %n',                     opcode: 'looks_changesizeby',
      slots: [{ type: 'num', name: 'CHANGE', default: '10' }] },
    { shape: 'stack', text: 'set size to %n',                        opcode: 'looks_setsizeto',
      slots: [{ type: 'num', name: 'SIZE', default: '100' }] },
    { shape: 'stack', text: 'change %m effect by %n',                opcode: 'looks_changeeffectby',
      slots: [
        { type: 'field', name: 'EFFECT', default: 'color' },
        { type: 'num', name: 'CHANGE', default: '25' },
      ] },
    { shape: 'stack', text: 'set %m effect to %n',                   opcode: 'looks_seteffectto',
      slots: [
        { type: 'field', name: 'EFFECT', default: 'color' },
        { type: 'num', name: 'VALUE', default: '0' },
      ] },
    { shape: 'stack', text: 'clear graphic effects',                 opcode: 'looks_cleargraphiceffects', slots: [] },
    { shape: 'stack', text: 'next costume',                          opcode: 'looks_nextcostume', slots: [] },
    { shape: 'stack', text: 'go to %m layer',                        opcode: 'looks_gotofrontback',
      slots: [{ type: 'field', name: 'FRONT_BACK', default: 'front' }] },
    { shape: 'stack', text: 'go %m %n layers',                       opcode: 'looks_goforwardbackwardlayers',
      slots: [
        { type: 'field', name: 'FORWARD_BACKWARD', default: 'forward' },
        { type: 'num', name: 'NUM', default: '1' },
      ] },

    // Control
    { shape: 'stack', text: 'wait %n seconds',                       opcode: 'control_wait',
      slots: [{ type: 'num', name: 'DURATION', default: '1' }] },
    { shape: 'stack', text: 'wait %n secs',                          opcode: 'control_wait',
      slots: [{ type: 'num', name: 'DURATION', default: '1' }] },
    { shape: 'stack', text: 'wait until %b',                         opcode: 'control_wait_until',
      slots: [{ type: 'bool', name: 'CONDITION' }] },
    { shape: 'stack', text: 'stop %m',                               opcode: 'control_stop',
      slots: [{ type: 'field', name: 'STOP_OPTION', default: 'all' }] },
    { shape: 'stack', text: 'create clone of %m',                    opcode: 'control_create_clone_of',
      slots: [{ type: 'menu', name: 'CLONE_OPTION', menuOpcode: 'control_create_clone_of_menu', default: '_myself_' }] },
    { shape: 'stack', text: 'delete this clone',                     opcode: 'control_delete_this_clone', slots: [] },

    // Events
    { shape: 'stack', text: 'broadcast %m',                          opcode: 'event_broadcast',
      slots: [{ type: 'broadcast', name: 'BROADCAST_INPUT', default: 'message1' }] },
    { shape: 'stack', text: 'broadcast %m and wait',                 opcode: 'event_broadcastandwait',
      slots: [{ type: 'broadcast', name: 'BROADCAST_INPUT', default: 'message1' }] },

    // Sensing
    { shape: 'stack', text: 'reset timer',                           opcode: 'sensing_resettimer', slots: [] },
    { shape: 'stack', text: 'ask %s and wait',                       opcode: 'sensing_askandwait',
      slots: [{ type: 'str', name: 'QUESTION', default: 'What is your name?' }] },

    // Variables
    { shape: 'stack', text: 'set %v to %s',                          opcode: 'data_setvariableto',
      slots: [{ type: 'var', name: 'VARIABLE' }, { type: 'str', name: 'VALUE', default: '0' }] },
    { shape: 'stack', text: 'change %v by %n',                       opcode: 'data_changevariableby',
      slots: [{ type: 'var', name: 'VARIABLE' }, { type: 'num', name: 'VALUE', default: '1' }] },
    { shape: 'stack', text: 'show variable %v',                      opcode: 'data_showvariable',
      slots: [{ type: 'var', name: 'VARIABLE' }] },
    { shape: 'stack', text: 'hide variable %v',                      opcode: 'data_hidevariable',
      slots: [{ type: 'var', name: 'VARIABLE' }] },

    // Lists
    { shape: 'stack', text: 'add %s to %l',                          opcode: 'data_addtolist',
      slots: [{ type: 'str', name: 'ITEM', default: 'thing' }, { type: 'list', name: 'LIST' }] },
    { shape: 'stack', text: 'delete %i of %l',                       opcode: 'data_deleteoflist',
      slots: [{ type: 'index', name: 'INDEX', default: '1' }, { type: 'list', name: 'LIST' }] },
    { shape: 'stack', text: 'delete all of %l',                      opcode: 'data_deletealloflist',
      slots: [{ type: 'list', name: 'LIST' }] },
    { shape: 'stack', text: 'insert %s at %i of %l',                 opcode: 'data_insertatlist',
      slots: [
        { type: 'str', name: 'ITEM', default: 'thing' },
        { type: 'index', name: 'INDEX', default: '1' },
        { type: 'list', name: 'LIST' },
      ] },
    { shape: 'stack', text: 'replace item %i of %l with %s',         opcode: 'data_replaceitemoflist',
      slots: [
        { type: 'index', name: 'INDEX', default: '1' },
        { type: 'list', name: 'LIST' },
        { type: 'str', name: 'ITEM', default: 'thing' },
      ] },
    { shape: 'stack', text: 'show list %l',                          opcode: 'data_showlist',
      slots: [{ type: 'list', name: 'LIST' }] },
    { shape: 'stack', text: 'hide list %l',                          opcode: 'data_hidelist',
      slots: [{ type: 'list', name: 'LIST' }] },

    // Pen extension (Scratch's drawing / paint blocks)
    { shape: 'stack', text: 'erase all',                              opcode: 'pen_clear', extension: 'pen', slots: [] },
    { shape: 'stack', text: 'clear',                                  opcode: 'pen_clear', extension: 'pen', slots: [] },
    { shape: 'stack', text: 'stamp',                                  opcode: 'pen_stamp', extension: 'pen', slots: [] },
    { shape: 'stack', text: 'pen down',                               opcode: 'pen_penDown', extension: 'pen', slots: [] },
    { shape: 'stack', text: 'pen up',                                 opcode: 'pen_penUp', extension: 'pen', slots: [] },
    { shape: 'stack', text: 'set pen color to %c',                    opcode: 'pen_setPenColorToColor', extension: 'pen',
      slots: [{ type: 'color', name: 'COLOR', default: '#0fbd8c' }] },
    { shape: 'stack', text: 'change pen %m by %n',                    opcode: 'pen_changePenColorParamBy', extension: 'pen',
      slots: [
        { type: 'field', name: 'COLOR_PARAM', default: 'color' },
        { type: 'num', name: 'VALUE', default: '10' },
      ] },
    { shape: 'stack', text: 'set pen %m to %n',                       opcode: 'pen_setPenColorParamTo', extension: 'pen',
      slots: [
        { type: 'field', name: 'COLOR_PARAM', default: 'color' },
        { type: 'num', name: 'VALUE', default: '50' },
      ] },
    { shape: 'stack', text: 'change pen size by %n',                  opcode: 'pen_changePenSizeBy', extension: 'pen',
      slots: [{ type: 'num', name: 'SIZE', default: '1' }] },
    { shape: 'stack', text: 'set pen size to %n',                     opcode: 'pen_setPenSizeTo', extension: 'pen',
      slots: [{ type: 'num', name: 'SIZE', default: '1' }] },
    { shape: 'stack', text: 'change pen color by %n',                 opcode: 'pen_changePenHueBy', extension: 'pen',
      slots: [{ type: 'num', name: 'HUE', default: '10' }] },
    { shape: 'stack', text: 'set pen color to %n',                    opcode: 'pen_setPenHueToNumber', extension: 'pen',
      slots: [{ type: 'num', name: 'HUE', default: '50' }] },
    { shape: 'stack', text: 'change pen shade by %n',                 opcode: 'pen_changePenShadeBy', extension: 'pen',
      slots: [{ type: 'num', name: 'SHADE', default: '10' }] },
    { shape: 'stack', text: 'set pen shade to %n',                    opcode: 'pen_setPenShadeToNumber', extension: 'pen',
      slots: [{ type: 'num', name: 'SHADE', default: '50' }] },

    // Music extension. DRUM and INSTRUMENT are menu shadow blocks whose field
    // holds a numeric string (e.g. "1"); NOTE/BEATS/TEMPO are plain numbers.
    { shape: 'stack', text: 'play drum %m for %n beats',             opcode: 'music_playDrumForBeats', extension: 'music',
      slots: [
        { type: 'menu', name: 'DRUM', menuOpcode: 'music_menu_DRUM', default: '1' },
        { type: 'num', name: 'BEATS', default: '0.25' },
      ] },
    { shape: 'stack', text: 'rest for %n beats',                     opcode: 'music_restForBeats', extension: 'music',
      slots: [{ type: 'num', name: 'BEATS', default: '0.25' }] },
    { shape: 'stack', text: 'play note %n for %n beats',             opcode: 'music_playNoteForBeats', extension: 'music',
      slots: [
        { type: 'num', name: 'NOTE', default: '60' },
        { type: 'num', name: 'BEATS', default: '0.25' },
      ] },
    { shape: 'stack', text: 'set instrument to %m',                  opcode: 'music_setInstrument', extension: 'music',
      slots: [{ type: 'menu', name: 'INSTRUMENT', menuOpcode: 'music_menu_INSTRUMENT', default: '1' }] },
    { shape: 'stack', text: 'set tempo to %n',                       opcode: 'music_setTempo', extension: 'music',
      slots: [{ type: 'num', name: 'TEMPO', default: '60' }] },
    { shape: 'stack', text: 'change tempo by %n',                    opcode: 'music_changeTempo', extension: 'music',
      slots: [{ type: 'num', name: 'TEMPO', default: '20' }] },

    // Sound (a built-in category, not an extension). The sound-effect blocks
    // (`change/set [pitch v] effect`) are intentionally omitted: their text is
    // identical to the Looks effect blocks and can only be told apart by the
    // effect name, which this grammar does not disambiguate.
    { shape: 'stack', text: 'start sound %m',                        opcode: 'sound_play',
      slots: [{ type: 'menu', name: 'SOUND_MENU', menuOpcode: 'sound_sounds_menu', default: 'Meow' }] },
    { shape: 'stack', text: 'play sound %m until done',              opcode: 'sound_playuntildone',
      slots: [{ type: 'menu', name: 'SOUND_MENU', menuOpcode: 'sound_sounds_menu', default: 'Meow' }] },
    { shape: 'stack', text: 'stop all sounds',                       opcode: 'sound_stopallsounds', slots: [] },
    { shape: 'stack', text: 'clear sound effects',                   opcode: 'sound_cleareffects', slots: [] },
    { shape: 'stack', text: 'change volume by %n',                   opcode: 'sound_changevolumeby',
      slots: [{ type: 'num', name: 'VOLUME', default: '-10' }] },
    { shape: 'stack', text: 'set volume to %n',                      opcode: 'sound_setvolumeto',
      slots: [{ type: 'num', name: 'VOLUME', default: '100' }] },

    // Sensing: set drag mode.
    { shape: 'stack', text: 'set drag mode %m',                      opcode: 'sensing_setdragmode',
      slots: [{ type: 'field', name: 'DRAG_MODE', default: 'draggable' }] },
  ],

  C_BLOCKS: [
    { shape: 'c',      text: 'forever',          opcode: 'control_forever',      slots: [], substack: 'SUBSTACK' },
    { shape: 'c',      text: 'repeat %n',        opcode: 'control_repeat',
      slots: [{ type: 'num', name: 'TIMES', default: '10' }], substack: 'SUBSTACK' },
    { shape: 'c',      text: 'repeat until %b',  opcode: 'control_repeat_until',
      slots: [{ type: 'bool', name: 'CONDITION' }], substack: 'SUBSTACK' },
    { shape: 'c',      text: 'if %b then',       opcode: 'control_if',
      slots: [{ type: 'bool', name: 'CONDITION' }], substack: 'SUBSTACK',
      canElse: true, elseOpcode: 'control_if_else', elseSubstack: 'SUBSTACK2' },
  ],

  CAPS: [
    // forever is a cap in Scratch terms (no next block), handled as c
  ],

  REPORTERS: [
    { shape: 'reporter', text: '%n + %n', opcode: 'operator_add',
      slots: [{ type: 'num', name: 'NUM1', default: '' }, { type: 'num', name: 'NUM2', default: '' }] },
    { shape: 'reporter', text: '%n - %n', opcode: 'operator_subtract',
      slots: [{ type: 'num', name: 'NUM1', default: '' }, { type: 'num', name: 'NUM2', default: '' }] },
    { shape: 'reporter', text: '%n * %n', opcode: 'operator_multiply',
      slots: [{ type: 'num', name: 'NUM1', default: '' }, { type: 'num', name: 'NUM2', default: '' }] },
    { shape: 'reporter', text: '%n / %n', opcode: 'operator_divide',
      slots: [{ type: 'num', name: 'NUM1', default: '' }, { type: 'num', name: 'NUM2', default: '' }] },
    { shape: 'reporter', text: 'pick random %n to %n', opcode: 'operator_random',
      slots: [{ type: 'num', name: 'FROM', default: '1' }, { type: 'num', name: 'TO', default: '10' }] },
    { shape: 'reporter', text: '%n mod %n', opcode: 'operator_mod',
      slots: [{ type: 'num', name: 'NUM1', default: '' }, { type: 'num', name: 'NUM2', default: '' }] },
    { shape: 'reporter', text: 'round %n', opcode: 'operator_round',
      slots: [{ type: 'num', name: 'NUM', default: '' }] },
    { shape: 'reporter', text: 'join %s %s', opcode: 'operator_join',
      slots: [{ type: 'str', name: 'STRING1', default: 'apple ' }, { type: 'str', name: 'STRING2', default: 'banana' }] },
    { shape: 'reporter', text: 'letter %n of %s', opcode: 'operator_letter_of',
      slots: [{ type: 'num', name: 'LETTER', default: '1', primitive: 'whole' }, { type: 'str', name: 'STRING', default: 'apple' }] },
    { shape: 'reporter', text: 'length of %s', opcode: 'operator_length',
      slots: [{ type: 'str', name: 'STRING', default: 'apple' }] },
    { shape: 'reporter', text: '%m of %n', opcode: 'operator_mathop',
      slots: [{ type: 'field', name: 'OPERATOR', default: 'abs' }, { type: 'num', name: 'NUM', default: '9' }] },

    { shape: 'reporter', text: 'x position',  opcode: 'motion_xposition',  slots: [] },
    { shape: 'reporter', text: 'y position',  opcode: 'motion_yposition',  slots: [] },
    { shape: 'reporter', text: 'direction',   opcode: 'motion_direction',  slots: [] },
    { shape: 'reporter', text: 'size',        opcode: 'looks_size',        slots: [] },
    { shape: 'reporter', text: 'tempo',       opcode: 'music_getTempo',    extension: 'music', slots: [] },
    { shape: 'reporter', text: 'timer',       opcode: 'sensing_timer',     slots: [] },
    { shape: 'reporter', text: 'mouse x',     opcode: 'sensing_mousex',    slots: [] },
    { shape: 'reporter', text: 'mouse y',     opcode: 'sensing_mousey',    slots: [] },
    { shape: 'reporter', text: 'answer',      opcode: 'sensing_answer',    slots: [] },
    { shape: 'reporter', text: 'distance to %m', opcode: 'sensing_distanceto',
      slots: [{ type: 'menu', name: 'DISTANCETOMENU', menuOpcode: 'sensing_distancetomenu', default: '_mouse_' }] },
    { shape: 'reporter', text: 'username',    opcode: 'sensing_username',  slots: [] },
    { shape: 'reporter', text: 'loudness',    opcode: 'sensing_loudness',  slots: [] },
    { shape: 'reporter', text: 'volume',      opcode: 'sound_volume',      slots: [] },
    { shape: 'reporter', text: 'current %m',  opcode: 'sensing_current',
      slots: [{ type: 'field', name: 'CURRENTMENU', default: 'year' }] },
    { shape: 'reporter', text: 'days since 2000', opcode: 'sensing_dayssince2000', slots: [] },
    { shape: 'reporter', text: '%m of %m', opcode: 'sensing_of',
      slots: [
        { type: 'field', name: 'PROPERTY', default: 'x position' },
        { type: 'menu', name: 'OBJECT', menuOpcode: 'sensing_of_object_menu', default: '_stage_' },
      ] },

    { shape: 'reporter', text: 'costume %m', opcode: 'looks_costumenumbername',
      slots: [{ type: 'field', name: 'NUMBER_NAME', default: 'number' }] },
    { shape: 'reporter', text: 'backdrop %m', opcode: 'looks_backdropnumbername',
      slots: [{ type: 'field', name: 'NUMBER_NAME', default: 'number' }] },

    { shape: 'reporter', text: 'item %i of %l', opcode: 'data_itemoflist',
      slots: [{ type: 'index', name: 'INDEX', default: '1' }, { type: 'list', name: 'LIST' }] },
    { shape: 'reporter', text: 'item # of %s in %l', opcode: 'data_itemnumoflist',
      slots: [{ type: 'str', name: 'ITEM', default: 'thing' }, { type: 'list', name: 'LIST' }] },
    { shape: 'reporter', text: 'length of %l', opcode: 'data_lengthoflist',
      slots: [{ type: 'list', name: 'LIST' }] },
  ],

  BOOLEANS: [
    { shape: 'boolean', text: '%n > %n', opcode: 'operator_gt',
      slots: [{ type: 'num', name: 'OPERAND1', default: '' }, { type: 'num', name: 'OPERAND2', default: '50' }] },
    { shape: 'boolean', text: '%n < %n', opcode: 'operator_lt',
      slots: [{ type: 'num', name: 'OPERAND1', default: '' }, { type: 'num', name: 'OPERAND2', default: '50' }] },
    { shape: 'boolean', text: '%n = %n', opcode: 'operator_equals',
      slots: [{ type: 'num', name: 'OPERAND1', default: '' }, { type: 'num', name: 'OPERAND2', default: '50' }] },
    { shape: 'boolean', text: '%b and %b', opcode: 'operator_and',
      slots: [{ type: 'bool', name: 'OPERAND1' }, { type: 'bool', name: 'OPERAND2' }] },
    { shape: 'boolean', text: '%b or %b', opcode: 'operator_or',
      slots: [{ type: 'bool', name: 'OPERAND1' }, { type: 'bool', name: 'OPERAND2' }] },
    { shape: 'boolean', text: 'not %b', opcode: 'operator_not',
      slots: [{ type: 'bool', name: 'OPERAND' }] },
    { shape: 'boolean', text: '%s contains %s ?', opcode: 'operator_contains',
      slots: [{ type: 'str', name: 'STRING1', default: 'apple' }, { type: 'str', name: 'STRING2', default: 'a' }] },
    { shape: 'boolean', text: 'mouse down?', opcode: 'sensing_mousedown', slots: [] },
    { shape: 'boolean', text: 'key %m pressed?', opcode: 'sensing_keypressed',
      slots: [{ type: 'menu', name: 'KEY_OPTION', menuOpcode: 'sensing_keyoptions', default: 'space' }] },
    { shape: 'boolean', text: 'touching %m ?', opcode: 'sensing_touchingobject',
      slots: [{ type: 'menu', name: 'TOUCHINGOBJECTMENU', menuOpcode: 'sensing_touchingobjectmenu', default: '_mouse_' }] },
    { shape: 'boolean', text: 'touching color %c ?', opcode: 'sensing_touchingcolor',
      slots: [{ type: 'color', name: 'COLOR', default: '#4c97ff' }] },
    { shape: 'boolean', text: 'color %c is touching %c ?', opcode: 'sensing_coloristouchingcolor',
      slots: [{ type: 'color', name: 'COLOR', default: '#4c97ff' }, { type: 'color', name: 'COLOR2', default: '#ffffff' }] },
    { shape: 'boolean', text: '%l contains %s ?', opcode: 'data_listcontainsitem',
      slots: [{ type: 'list', name: 'LIST' }, { type: 'str', name: 'ITEM', default: 'thing' }] },
  ],
};

// Flatten all stack-level templates for parser convenience.
T.STATEMENTS = [].concat(T.HATS, T.STACKS, T.C_BLOCKS, T.CAPS);

// Sort longer-first by number of template tokens to reduce false matches.
function tokenCount(text) {
  return text.split(/\s+/).length;
}
function sortByLength(list) { list.sort((a, b) => tokenCount(b.text) - tokenCount(a.text)); }

sortByLength(T.STATEMENTS);
sortByLength(T.REPORTERS);
sortByLength(T.BOOLEANS);

global.BLOCKS = T;

})(window);
