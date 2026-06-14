# Scratch Text — Project Guide and Agent Handoff

A browser-based editor where a user writes scratchblocks-style text and gets
a real, runnable `.sb3` Scratch 3 project out. No server, no build step —
open `index.html` in any modern browser.

This document is both the user-facing explanation of the text format and the
technical handoff for future agents. Read it before editing.

---

## 1. What it does today

> **Scope note (this build):** the editor authors a project's *logic and
> structure* only. It does **not** create or import artwork — costumes and
> backdrops are named placeholders, and the user draws/uploads the real images
> in Scratch after importing the `.sb3`. The costume drawing DSL and `from "..."`
> imports shown in some examples below are **disabled** (see § 4.5).

**Input** — plaintext in scratchblocks-style syntax. A file can contain one
default sprite, explicit `stage` / `character` / `sprite` sections, Stage
backdrops, sprite costumes, and scripts on either the Stage or sprites:

```
character Cat
costume CatFace
    canvas (64) (64)
    circle (32) (32) (28) [#ffcc66 c]
    circle (22) (25) (4) [#000000 c]
    circle (42) (25) (4) [#000000 c]
    line (22) (43) (42) (43) [#000000 c] (3)

when flag clicked
say [Hello!] for (2) seconds
set [score v] to (0)
forever
    move (10) steps
    change [score v] by (1)
    if <(score) > (20)> then
        broadcast [win v]
    end
end

when [space v] key pressed
pen down
set pen color to [#00ff00 c]
move (20) steps
pen up

character Dog
costume DogFace
    canvas (64) (64)
    roundrect (14) (16) (36) (32) (8) [#9966ff c]
    circle (24) (28) (4) [#ffffff c]
    circle (40) (28) (4) [#ffffff c]

when I receive [win v]
say [Dog heard the message!]
```

**Output** — a valid `.sb3` (ZIP with `project.json` + assets) that loads
in scratch.mit.edu and TurboWarp. The Stage is a real Scratch target with
`isStage: true`; each `character` / `sprite` section becomes a sprite target.
`backdrop` sections become Stage costumes, and `costume` sections become
sprite costumes. A live preview on the right shows the source rendered through
the `scratchblocks` library.

**Coverage** — ~145 block templates spanning all of Motion, Looks, Sound,
Events, Control, Sensing, Operators, and Variables/Lists, plus the Pen and
Music extensions and custom blocks. Variables and lists can be **global
("for all sprites")** or **sprite-local ("for this sprite only")**. See
`src/blocks.js` for the full list, or click "Supported blocks → show" in the
app.

**Main purpose** — let AI write structured Scratch projects as text and
export them cleanly to Scratch. The syntax is intentionally strict so LLMs
can generate predictable output and the compiler can produce valid Scratch
JSON without guessing.

---

## 2. File layout

```
Scratch-Text/
├── index.html            # app shell, script load order matters
├── styles.css            # dark theme
├── vendor/
│   ├── jszip.min.js          # v3.10.1, sync loaded (required)
│   └── scratchblocks.min.js  # v3.6.2, used for the live preview
├── src/
│   ├── md5.js            # RFC 1321 MD5 (needed for asset hashes)
│   ├── blocks.js         # block template registry
│   ├── parser.js         # text -> AST (tokenizer + template matcher)
│   ├── compile.js        # AST -> Scratch 3 project.json
│   ├── decompile.js      # project.json -> Scratch Text (reverse of compile)
│   ├── sb3.js            # project.json + default assets -> .sb3 Blob
│   └── app.js            # UI wiring (editor, preview, download, load .sb3)
├── test/
│   ├── smoke.html        # 105 parser/compiler assertions
│   ├── smoke.js          # Node parser/compiler/asset smoke test (29 checks)
│   ├── build.html        # 27 sb3-packaging assertions
│   ├── decompile.html    # 39 decompiler round-trip + golden assertions
│   └── decompile_zip.html# 7 async text->sb3->reload->decompile assertions
└── AGENT.md              # this file
```

**Script load order in `index.html`** (load-time globals; they attach to
`window`): `jszip` → `scratchblocks` → `md5` → `blocks` → `parser` →
`compile` → `decompile` → `sb3` → `app`. Changing this order breaks the app.

Each `src/*.js` uses the pattern `(function (global) { ... })(window);` and
exposes a single namespace: `MD5`, `BLOCKS`, `PARSER`, `COMPILE`, `DECOMPILE`,
`SB3`. Keep this style — no ES modules, no build step.

---

## 3. Data flow

```
  editor <textarea>
      │
      ▼  on input (debounced 150ms)
  PARSER.parseProgram(text)
      │   returns { program, errors, warnings }
      │   (warnings = advisory diagnostics, e.g. off-canvas costume shapes;
      │    they do not block compile/download)
      │
      ├─▶ scratchblocks.renderMatching(preview)   [live SVG preview]
      │
      └─▶ COMPILE.compile(program) -> projectJson
              │
              ▼  on "Download .sb3"
          SB3.buildSb3(projectJson)
              │   attachAssetsAsync() mutates costumes in place for
              │   the stage and every sprite, resolves inline or external
              │   SVG/PNG assets, hashes bytes, names files as <md5>.<ext>
              ▼
          JSZip Blob ─▶ `<a download>` click ─▶ project.sb3
```

The AST is a plain JS structure (see the comment at the top of
`src/parser.js`). The compiler walks it and emits the exact shape Scratch's
VM expects (see § 5 below).

Current AST shape:

```js
Program = {
  stage: Stage,             // Stage target, with scripts and backdrops
  scripts: Script[],        // legacy/default Sprite1 scripts
  sprites: Sprite[],        // explicit/default Scratch sprite targets
  variables: Set<string>,   // global Stage variables
  lists: Set<string>,       // global Stage lists
  broadcasts: Set<string>,  // global Stage broadcasts
}

Stage = {
  name: 'Stage',
  scripts: Script[],
  backdrops: Costume[],
  currentCostume?: number,
  currentCostumeName?: string,
}

Sprite = {
  name: string,
  scripts: Script[],
  costumes: Costume[],
  x?: number,
  y?: number,
  size?: number,
  direction?: number,
  visible?: boolean,
}

Script = {
  hat: Block | null,
  body: Block[],
}

Block = {
  template,
  args: Arg[],
  substack?: Block[],
  substack2?: Block[],
}

Costume = {
  name: string,
  sourcePath?: string,      // for `from "asset.svg/png"`
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  shapes: CostumeShape[],
}
```

Module responsibilities:

| File | Responsibility |
| --- | --- |
| `src/blocks.js` | Source block templates and Scratch opcode/slot metadata |
| `src/parser.js` | Text tokenization, indentation parsing, AST creation, costume DSL parsing |
| `src/compile.js` | AST to Scratch `project.json` targets/blocks/fields/inputs and SVG costume rendering |
| `src/decompile.js` | `project.json` back to Scratch Text (reverse registry, block-chain walk, slot/arg reversal) |
| `src/sb3.js` | Resolve/attach costumes and backdrops, hash asset bytes, build ZIP Blob |
| `src/app.js` | Editor, preview, problem list, and Download button wiring |

---

## 4. Text language reference

The source language is deliberately close to scratchblocks, with a few
project-level additions for sprites and costumes.

### 4.1  Character and sprite sections

Use `character Name`, `sprite Name`, or `char Name` at the top level to
select the Scratch sprite that following scripts and costumes belong to:

```
character Player
when flag clicked
say [I am the player]

character Enemy
when flag clicked
say [I am another sprite]
```

Rules:

- If there are no character headers, all scripts compile into one sprite
  named `Sprite1`.
- `Sprite1` is the default sprite name. A `character Sprite1` section
  appends to the same default sprite.
- Repeating a character name later appends more scripts/costumes to the
  existing Scratch target instead of creating a duplicate.
- Each sprite gets its own `blocks` dict in `project.json`; global variables,
  lists, and broadcasts still live on the Stage.
- The compiler gives multiple sprites staggered default `x` positions so they
  do not all spawn in the exact same place.

Use `stage` to select the Scratch Stage target. Scripts below it compile to
`targets[0].blocks`; backdrops below it compile to `targets[0].costumes`:

```
stage
    backdrop Day
        canvas (480) (360)
        rect (0) (0) (480) (360) [#88ccff c]
    backdrop Night from "assets/night.svg"
    current backdrop [Day v]

    when green flag clicked
        switch backdrop to [Day v]

    when backdrop switches to [Night v]
        say [Stage script]
```

Stage notes:

- There is exactly one Stage target named `Stage`.
- Backdrops are Stage costumes, not separate code objects.
- Code that should react to a backdrop uses `when backdrop switches to [name v]`.
- `costume Name` inside a `stage` section is treated as a backdrop alias.
- If no Stage section/backdrop is provided, export still includes a valid
  default white backdrop.

Sprite target properties can be set with small metadata lines under a sprite:

```
sprite Player
    position x: (0) y: (-100)
    size (90)
    direction (45)
    visible true
    draggable false
    rotation style [left-right]
```

### 4.2  Multiple scripts on one character

Every hat block starts a separate script on the current character:

```
character Player
when flag clicked
say [green flag script]

when [space v] key pressed
say [space script]

when I receive [go v]
say [broadcast script]
```

Headless stacks are also supported for quick experiments, but real Scratch
projects should normally use hats so runtime events start the script.

### 4.3  Slots and brackets

The parser uses bracket shape to know what kind of Scratch input to emit:

| Source shape | Meaning | Example |
| --- | --- | --- |
| `( ... )` | number slot or reporter expression | `move (10) steps` |
| `[ ... ]` | string literal | `say [hello]` |
| `[ ... v]` | dropdown, variable, list, broadcast, or menu | `set [score v] to (0)` |
| `[#rrggbb c]` | color picker literal | `touching color [#ff0000 c]?` |
| `< ... >` | boolean expression | `if <(score) > (10)> then` |

Numbers must stay in parentheses. The parser intentionally does not rewrite
`move 10 steps` into `move (10) steps`.

### 4.4  Variables, lists, and broadcasts

Variables are introduced by variable dropdown slots, e.g. `[score v]`.
Lists are introduced by list slots in list blocks, e.g. `[items v]`.
Broadcast messages are introduced by broadcast slots, e.g. `[win v]`.

By default these are **global ("for all sprites")**:

- Global variables compile to `stage.variables`.
- Global lists compile to `stage.lists`.
- Broadcast messages compile to `stage.broadcasts` (always global).

A sprite can declare a **sprite-local ("for this sprite only")** variable or
list with a declaration line under its section:

```
sprite Hero
    local variable [health]
    local list [inventory]
    when flag clicked
        set [health v] to (100)     # resolves to Hero's LOCAL health
        set [score v] to (0)        # resolves to the GLOBAL score on the Stage
```

Scoping rules (see `resolveVarId` / `resolveListId` in `src/compile.js`):

- A name declared `local` in a sprite resolves to that sprite's own
  `variables`/`lists` dict for references **inside that sprite**.
- The same name used in another sprite (that did not declare it local)
  resolves to a separate global on the Stage — so a local can shadow a global
  of the same name, exactly like Scratch.
- A name never declared local is global. Globals are not pre-declared if the
  name is local somewhere; genuine global references still create one lazily.

IDs are deterministic from display names (globals: `sanitizeVarId`; locals:
`sanitizeLocalVarId`, namespaced by the sprite prefix so a local and a
same-named global never collide), so the same source produces the same IDs
across compiles. The decompiler re-emits each sprite-local as a
`local variable [name]` / `local list [name]` line.

### 4.5  Costume design syntax — DISABLED in this build

> **This build cannot create or import artwork.** `parseCostumeLike` in
> `src/parser.js` now rejects both the drawing DSL below and `from "..."`
> imports with an error, so a `costume`/`backdrop` is only a *named
> placeholder*; the user adds the real image in Scratch after importing the
> `.sb3`. The shape-rendering machinery (`addCostumeShape`, `validateCostume`,
> `renderCostumeSvg`, the asset fetch in `sb3.js`) is **retained but
> unreachable**. To re-enable artwork, remove the two `errors.push(...)` guards
> in `parseCostumeLike` and restore the shape-collecting loop. The rest of this
> section documents that (currently dormant) machinery.

A `costume Name` section under a character defines a vector SVG costume for
that sprite:

```
character Player
costume PlayerFace
    canvas (64) (64)
    circle (32) (32) (28) [#4c97ff c]
    circle (22) (25) (4) [#ffffff c]
    circle (42) (25) (4) [#ffffff c]
    line (22) (43) (42) (43) [#ffffff c] (3)
```

Shape lines are indented under the costume. Supported shape lines:

| Shape | Syntax |
| --- | --- |
| Canvas size | `canvas (width) (height)` |
| Rotation center | `center (x) (y)` |
| Circle | `circle (cx) (cy) (r) [#color c]` |
| Ellipse | `ellipse (cx) (cy) (rx) (ry) [#color c]` |
| Rectangle | `rect (x) (y) (width) (height) [#color c]` |
| Rounded rectangle | `roundrect (x) (y) (width) (height) (radius) [#color c]` |
| Line | `line (x1) (y1) (x2) (y2) [#color c] (width)` |
| Text | `text [label] (x) (y) (fontSize) [#color c]` |
| Polygon | `polygon [x,y x,y x,y] [#color c]` |

Costume notes:

- **Coordinates are SVG coordinates measured from the costume's top-left** —
  `(0,0)` is the top-left, x grows right, y grows down, the centre is
  `(w/2, h/2)`. They are NOT Scratch stage coordinates (centred, negatives
  allowed). The #1 mistake an LLM makes here is drawing at `(0,0)` or with
  negative numbers, which piles everything into the top-left corner.
  `validateCostume` in `src/parser.js` emits **warnings** (severity
  `'warning'`, returned in `parseProgram(...).warnings`, shown in the app's
  Problems panel) when a shape is off-canvas or uses negative coordinates, so
  an AI iterating on the source gets a clear nudge to fix it.
- A costume declared with **no shapes and no `from "..."`** renders a visible
  default placeholder (blue dot for sprites, white fill for backdrops) instead
  of a blank SVG, and also produces a warning. See the empty-shape branch in
  `renderCostumeSvg` (`src/compile.js`).
- `canvas` defaults to `48 x 48` if omitted.
- `center` defaults to the canvas center if omitted.
- Each costume compiles to an SVG string, then `sb3.js` hashes the SVG bytes
  and writes it as `<md5>.svg` in the `.sb3` ZIP.
- External SVG/PNG assets can be referenced with
  `costume Idle from "assets/player_idle.svg"` or
  `backdrop Sky from "assets/sky.png"`. Browser export fetches paths relative
  to `index.html`; tests can pass a synchronous `resolveAsset` function to
  `SB3.attachAssets`.
- If a sprite has no costume section, it receives the built-in blue default
  dot costume.
- The live scratchblocks preview renders source text, not costume artwork.
  The artwork appears after exporting/importing the `.sb3`.

### 4.5b  Custom blocks: "run without screen refresh" (warp)

Prefix a definition with `warp` (or `atomic`) to compile it as a
run-without-screen-refresh custom block — essential for tight physics /
collision loops that must finish inside one frame:

```
define warp resolve collision
    repeat until <not <touching [Level v] ?>>
        change y by (1)
    end
```

The flag rides in the prototype mutation (`warp: "true"`); the decompiler
re-emits it as `define warp ...`. See the `warp` round-trip in
`test/decompile.html`.

### 4.5c  Variable monitors

`COMPILE.compile` emits a hidden monitor for every global variable
(`data_variable`) and list (`data_listcontents`) into `project.monitors`, so
the `show variable [x v]` / `hide variable [x v]` (and list) blocks toggle a
real on-stage readout. They stack top-left by default. This is how a HUD
(score/lives) is shown — there is no positioned-monitor syntax yet.

### 4.6  Blocks

All block templates live in `src/blocks.js`. The registry describes:

- The source text pattern, e.g. `move %n steps`.
- The Scratch opcode, e.g. `motion_movesteps`.
- Slot metadata, e.g. numeric input `STEPS`.
- Whether a dropdown is a direct field or a separate menu shadow block.
- Whether the block requires an extension, e.g. `extension: 'pen'`.

The UI's "Supported blocks" panel is generated from this registry.

### 4.7  Comments and indentation

Blank lines are ignored. Lines beginning with `//` or `#` are comments.
Indentation is meaningful for c-block bodies (`forever`, `repeat`, `if`)
and for costume shape lines. Tabs count as 4 spaces.

---

## 5. Scratch 3 project.json — the parts you must know

This is the #1 thing a future agent will get wrong if they don't read it.

A project is:

```json
{
  "targets": [Stage, Sprite1, ...],
  "monitors": [],
  "extensions": [],
  "meta": { "semver": "3.0.0", "vm": "0.2.0", "agent": "..." }
}
```

Each **target** has: `isStage`, `name`, `variables`, `lists`, `broadcasts`,
`blocks`, `comments`, `currentCostume`, `costumes`, `sounds`, `volume`,
`layerOrder` + stage-only (`tempo`, `videoTransparency`, `videoState`,
`textToSpeechLanguage`) or sprite-only (`visible`, `x`, `y`, `size`,
`direction`, `draggable`, `rotationStyle`).

A **block** looks like:

```json
{
  "opcode": "motion_movesteps",
  "next": "nextId" | null,
  "parent": "parentId" | null,
  "inputs": { "STEPS": [...] },
  "fields": { },
  "shadow": false,
  "topLevel": false,
  "x": 0, "y": 0            // only when topLevel === true
}
```

**Input encoding** is the tricky part. Each input is an array:

| Shape | Meaning |
| --- | --- |
| `[1, primitive]`           | shadow only (literal) |
| `[1, "shadowBlockId"]`     | shadow is a separate block (menus!) |
| `[2, "blockId"]`           | non-shadow block reference (bool, SUBSTACK) |
| `[3, "blockId", primitive]` | block reference with shadow fallback |
| `[3, [12, name, id], prim]` | variable reporter inlined as primitive |

**Primitive type codes** (first element of the inline array):

| Code | Name | Shape |
| --- | --- | --- |
| 4 | `math_number` | `[4, "10"]` |
| 5 | `math_positive_number` | `[5, "10"]` |
| 6 | `math_whole_number` | `[6, "10"]` |
| 7 | `math_integer` | `[7, "10"]` |
| 8 | `math_angle` | `[8, "90"]` |
| 9 | `color_picker` | `[9, "#ff0000"]` |
| 10 | `text` | `[10, "hello"]` |
| 11 | `broadcast` | `[11, "name", "id"]` |
| 12 | `variable` | `[12, "name", "id"]` |
| 13 | `list` | `[13, "name", "id"]` |

**Field encoding** — fields are simpler:

| Field | Value |
| --- | --- |
| Simple menu (e.g. `KEY_OPTION`) | `["space", null]` |
| Variable | `["varName", "varId"]` |
| Broadcast | `["bcastName", "bcastId"]` |
| List | `["listName", "listId"]` |

**Menu shadow blocks** — some dropdowns (e.g. `sensing_keyoptions` for
`sensing_keypressed`) are *not* direct fields. They're a separate block
with `shadow: true` referenced as `[1, "menuBlockId"]`. See
`emitArg`/`case 'menu'` in `src/compile.js` for how this is done.

**Variables and lists** live on a target's `variables` / `lists` dict:

```json
"variables": {
  "varId": ["displayName", 0],
  "cloudVarId": ["displayName", 0, true]
},
"lists": {
  "listId": ["displayName", ["item1", "item2"]]
}
```

We put all variables on the Stage (global). IDs are deterministic per name
via `sanitizeVarId(name)` in `src/compile.js`.

**Broadcasts** live on the Stage's `broadcasts` dict:

```json
"broadcasts": {
  "bcastId": "bcastName"
}
```

**Costumes** on a target:

```json
{
  "name": "costume1",
  "dataFormat": "svg" | "png" | "jpg" | "bmp" | "gif",
  "assetId": "<md5 of file bytes>",
  "md5ext": "<md5>.<ext>",
  "rotationCenterX": 0,
  "rotationCenterY": 0,
  "bitmapResolution": 1          // for raster formats
}
```

The `md5ext` is *also* the filename inside the ZIP. Scratch doesn't verify
the hash matches — but Scratch's own tools assume it does. Always use real
MD5s: `MD5.md5Bytes(Uint8Array)` returns a 32-char hex digest.

---

## 6. Parser rules that bite

Document these clearly because they are not obvious:

- `(...)` is a **round** slot (numbers, numeric reporters).
- `[...]` is a **square** slot. `[val v]` (trailing ` v`) marks it as a
  **dropdown**; `[text]` is a plain string; `[#ff0000 c]` is a color
  picker literal.
- `character Name` or `sprite Name` starts a Scratch sprite section.
  Everything below it belongs to that sprite until the next sprite header.
  Multiple hats under one header become multiple scripts on that character.
  Repeating the same character name later appends more scripts to that
  existing sprite.
- `stage` starts the Stage target. Stage code goes into the Stage target's
  `blocks` dict. `backdrop Name` under the Stage adds a Stage costume.
- `costume Name` under a character starts a vector costume. Indented shape
  lines become SVG assets on export. Supported shape lines: `canvas (w) (h)`,
  `center (x) (y)`, `circle (cx) (cy) (r) [#color c]`, `ellipse (cx) (cy)
  (rx) (ry) [#color c]`, `rect (x) (y) (w) (h) [#color c]`, `roundrect (x)
  (y) (w) (h) (r) [#color c]`, `line (x1) (y1) (x2) (y2) [#color c]
  (width)`, `text [label] (x) (y) (size) [#color c]`, and `polygon
  [x,y x,y ...] [#color c]`.
- `<...>` is an **angle** slot (booleans). Ambiguity with operators is
  resolved by whitespace: an opener `<` is immediately followed by a
  non-space character; a closer `>` is immediately preceded by one.
  `<(x) < (y)>` works: the outer `<` / `>` are tight, the inner ones are
  space-padded and therefore operators. See `isBoolOpener` /
  `isBoolCloser` in `src/parser.js`.
- **Indentation** is significant but lenient: any deeper indent is "inside"
  a c-block; `end` closes the c-block, `else` switches to the second
  branch. Tabs count as 4 spaces.
- A new **hat** at the top level terminates the previous script.
- Lines starting with `//` or `#` are comments.
- `:`, `,`, `?` are **word characters**, not separators — `go to x:`,
  `if on edge,`, and `mouse down?` work because of this.
- Template matching is length-first (longest template tried first; see the
  `sortByLength` call at the bottom of `src/blocks.js`). Needed so
  `say %s for %n seconds` matches before `say %s`.

---

## 7. How to develop and test

Use quick JS syntax checks plus browser smoke pages. The app itself is still
plain browser JavaScript; Node is only used here as a convenient local syntax
and export-path check, not as a build step.

Run syntax checks after JS edits:

```bash
node --check src/blocks.js
node --check src/parser.js
node --check src/compile.js
node --check src/sb3.js
node --check src/app.js
```

Run the browser suite:

```bash
# Use dedicated profiles so you don't steal the user's main Firefox window.
mkdir -p /tmp/ff-smoke-profile /tmp/ff-build-profile /tmp/ff-app-profile
firefox --headless --no-remote --profile /tmp/ff-smoke-profile \
  --window-size 1100,2000 --screenshot /tmp/smoke.png \
  "file://$PWD/test/smoke.html"
firefox --headless --no-remote --profile /tmp/ff-build-profile \
  --window-size 1100,950 --screenshot /tmp/build.png \
  "file://$PWD/test/build.html"
firefox --headless --no-remote --profile /tmp/ff-app-profile \
  --window-size 1600,1000 --screenshot /tmp/app.png \
  "file://$PWD/index.html"
```

Why this works: the page runs everything **synchronously** on load and
paints results before the screenshot fires. Async code (like
`JSZip.generateAsync`) will be clipped — keep tests sync.

The current expected browser totals are:

- `test/smoke.html`: `128 PASS, 0 FAIL`
- `test/build.html`: `27 PASS, 0 FAIL`
- `test/decompile.html`: `83 PASS, 0 FAIL`
- `test/decompile_zip.html`: `7 PASS, 0 FAIL` (async — needs the page to settle
  before snapshot; with headless Chromium/Edge use `--virtual-time-budget`)
- `index.html`: preview renders and Problems says `No problems.`

Note: this repo has no Node available in the default shell. The browser suites
were validated with headless Edge/Chromium, e.g.:

```
msedge --headless=new --disable-gpu --dump-dom \
  "file://.../test/decompile.html"            # sync pages
msedge --headless=new --disable-gpu --virtual-time-budget=8000 --dump-dom \
  "file://.../test/decompile_zip.html"        # async pages
```

The `#out` div holds the `=== N PASS, M FAIL ===` summary in the dumped DOM.

When adding functionality, also add assertions to `test/smoke.html` or
`test/build.html`. The pattern is `check(name, cond, detail)`; failed
checks are visibly prefixed `FAIL`.

For async `.sb3` packaging checks, load the browser globals in Node and call
`SB3.buildSb3(project)`. Existing chat history has examples. This catches the
path used by the Download button.

---

## 8. Scope — what's next

Rough priority order. Each section lists what's needed, where it goes, and
the gotchas I've already identified.

### 8.1  Core block coverage

The first block-coverage pass is complete. `src/blocks.js` now includes the
previously listed core looks, motion, sensing, operator, broadcast, list,
clone templates, plus Scratch's Pen and Music extensions. `src/parser.js`
supports `%l`, `%c`, and `%i` slots, and `src/compile.js` emits Stage `lists` /
`broadcasts`, color picker primitives, broadcast primitives,
positive-number list indexes, menu shadow normalization for `_mouse_`,
`_random_`, `_stage_`, and `_myself_`, and extension IDs such as `pen` and
`music`.

The **Music** extension lives at the end of `STACKS` (`music_*`,
`extension: 'music'`) plus the `tempo` reporter (`music_getTempo`). `DRUM`
and `INSTRUMENT` are `menu` slots (shadow blocks `music_menu_DRUM` /
`music_menu_INSTRUMENT` whose field holds a numeric string); `NOTE`, `BEATS`,
and `TEMPO` are plain `num` slots. They decompile for free because the reverse
registry in `decompile.js` is derived from `blocks.js` — see the `music`
round-trip in `test/decompile.html`.

**When adding any new block, add a decompiler round-trip for it too.** As long
as the block uses existing slot types (`num`, `str`, `bool`, `menu`, `field`,
`var`, `list`, `color`, `index`, `broadcast`), `decompile.js` handles it with
no code change — but assert it with a `roundTrip(...)` case so a future slot
type or special menu can't silently break the reverse direction.

The **Sound** category is covered (`sound_*`, no extension id — Sound is
built-in): `start sound`, `play … until done`, `stop all sounds`,
`clear sound effects`, `change/set volume`, and the `volume` reporter. The two
sound-*effect* blocks (`change/set [pitch v] effect`) are intentionally
omitted because their text is identical to the Looks effect blocks and this
grammar can't disambiguate them by effect name. Also added: the
`when [loudness v] > (n)` hat (`event_whengreaterthan`), `set drag mode`
(`sensing_setdragmode`), and the `current [year v]` reporter
(`sensing_current`).

Remaining block-coverage work is the other extensions (video sensing,
translate, text-to-speech, Makey Makey, hardware). When adding more dropdown
blocks, keep checking whether Scratch expects a direct field or a separate menu
shadow — and add a decompiler round-trip (see §8.1 note above).

Known fidelity gap: menu/field values are stored verbatim, so dropdowns whose
Scratch value is upper-case (e.g. the sound effect `PITCH`, the loudness/timer
hat `LOUDNESS`/`TIMER`, the `current` unit `YEAR`) round-trip fine but may not
match Scratch's exact casing on import into scratch.mit.edu. Normalizing field
casing per block is a future cleanup.

### 8.2  Custom procedures ("My Blocks") — hardest

Scratch encodes custom blocks with a **prototype** block and a
**definition** hat. Example for a block `jump (height) says [msg]`:

- `procedures_definition` (hat) with `custom_block` input pointing to:
- `procedures_prototype` (shadow) with a **mutation** that carries the
  proccode and argument list encoded as JSON strings.
- Each call site is a `procedures_call` block with the same proccode in
  its mutation and inputs matching the declared args.
- Arg reporters inside the body are `argument_reporter_string_number` or
  `argument_reporter_boolean` with field `VALUE` = arg name.

The mutation dict has these fields:

```json
"mutation": {
  "tagName": "mutation",
  "children": [],
  "proccode": "jump %n says %s",
  "argumentids": "[\"idA\",\"idB\"]",
  "argumentnames": "[\"height\",\"msg\"]",
  "argumentdefaults": "[\"1\",\"\"]",
  "warp": "false"
}
```

Yes, the inner values are JSON-as-strings inside a JSON doc. Scratch's
fault, not ours. Proposed surface syntax:

```
define jump (height) says [msg]
    say [msg]
    change y by (height)
```

Then `jump (5) says [hi]` as a call.

### 8.3  Open `.sb3` files (reverse direction) — IMPLEMENTED

Loading and decompiling is done. `src/decompile.js` (`DECOMPILE.decompile`)
turns a `project.json` back into Scratch Text, and `app.js` wires a
"Load .sb3" button.

What it does:

1. **Load** — `app.js` `loadSb3()` reads the file, `JSZip.loadAsync`,
   parses `project.json`, and stashes every other zip entry in
   `loadedAssets` keyed by its `md5ext` filename.
2. **Decompiler** — `decompile.js` builds a reverse registry (opcode →
   canonical template; first template per opcode in `blocks.js` order wins),
   walks each target's top-level block chains, and substitutes slot values
   back into the template text. Nested reporters/booleans/c-blocks expand
   inline with indentation. Menu shadows reverse to friendly names via
   `MENU_REVERSE` (the inverse of compile's `SPECIAL_MENU_VALUES`).
   Custom procedures rebuild `define …` / call lines from the prototype
   mutation. Unknown opcodes degrade to a `// unknown: <opcode>` comment.
3. **Assets** — costumes/backdrops are emitted as
   `costume Name from "<md5ext>"`. On re-export, `app.js` passes a
   `resolveAsset` that returns the stashed bytes (falling back to `fetch`
   for genuine external paths), so imported artwork survives the
   load → edit → download round trip unchanged.

Gotchas already handled (see the round-trip tests in `test/decompile.html`):

- A `define` hat's body must be **indented** (parser uses `indent + 1`),
  unlike ordinary hats whose body sits at the same indent.
- `current costume`/`current backdrop` are emitted by **name**
  (`[Name v]`), not the numeric form, because the numeric form is a 0-based
  index and collides with the compiler's name resolution.
- Scripts are emitted in `(x, y)` layout order so re-compilation reproduces
  the same block-id ordering.

Known limitation: costume **artwork authored as the shape DSL** cannot be
recovered (the shapes are gone once rendered to SVG). Text-authored costumes
decompile to a bare `costume Name` (art is lost on re-export unless an
imported asset was present). Reconstructing the shape DSL from arbitrary SVG
is out of scope. Sprite layout *is* representable today via the
`position`/`size`/`direction`/… metadata lines, so no header-comment channel
is needed.

### 8.4  Multi-target Stage / sprites / backdrops

Stage, sprite, character, and backdrop headers are implemented:

```
stage
    backdrop Sky
    when backdrop switches to [Sky v]
        ...

character Cat
    when flag clicked
    ...
    when [space v] key pressed
    ...

sprite Dog
    when flag clicked
    ...
```

Parser: recognises `stage`, `character <name>`, `sprite <name>`, and
`char <name>` as target declarations. Scripts below attach to that target
until the next target header, and repeated sprite names append to the same
target. Compiler emits one Stage target and one Scratch target per sprite,
each with its own `blocks` dict and deterministic block IDs.

Scenes as a concept don't exist in Scratch — multiple backdrops on the
Stage + `switch backdrop to` is the idiom. Surface it as
`backdrop <name>` headers that add entries to `stage.costumes`.

### 8.5  Costumes and asset handling

Text-authored vector costumes are implemented with `costume Name` sections
under `character` / `sprite` sections and `backdrop Name` sections under
`stage`. The compiler stores rendered or referenced assets as non-enumerable
`_scratchTextCostumes` metadata on targets, and `src/sb3.js` hashes those
bytes into real Scratch costume assets. If a sprite has no designed costume,
it still gets the default blue dot.

External SVG/PNG source paths are implemented via
`costume Name from "filename.svg"` and `backdrop Name from "filename.png"`.
`buildSb3()` resolves them asynchronously with `fetch`; `attachAssets()` can
resolve them synchronously when tests pass `resolveAsset`.

Still missing: drag-and-drop/imported image assets and a GUI costume editor.

Next asset work:

1. An "Assets" panel listing the current sprite's costumes.
2. Drag-and-drop SVG/PNG/JPG onto the panel → read as `ArrayBuffer`,
   hash with MD5, store in the asset map, add a `costume <name>` entry
   to the current sprite's `costumes` array.
3. First costume is `currentCostume: 0` by default unless `current costume`
   or `current backdrop` selects a named asset.

The current text shape DSL is enough for AI-authored simple sprites. A real
in-app paint editor would be a separate UI feature.

### 8.6  Run the project in-editor

Load `scratch-vm` + `scratch-render` + `scratch-audio` and wire them to
a `<canvas>`. Roughly:

1. Vendor `scratch-vm` (big — ~1.5 MB minified). Consider pulling from
   TurboWarp's bundle; they ship a standalone `scaffolding` package
   (`@turbowarp/scaffolding`) that bundles VM + renderer + audio + UI
   into one embed. Easiest path.
2. On "Run ▶": `COMPILE.compile(program)` → serialize → feed to
   `vm.loadProject(zipBlob)` → `vm.greenFlag()`.
3. A "Stop" button calls `vm.stopAll()`.

Failure modes: some opcodes the user writes may not be implemented in
scratch-vm or may need extension blocks enabled — show VM errors in the
Problems panel. Test with a sample that uses every implemented block.

**Nice-to-have** once this exists: reactive re-run on edit (debounced
~500ms) instead of a manual button.

---

## 9. Design decisions I made

Document these so a future agent doesn't undo them thinking they're bugs.

1. **Strict scratchblocks syntax, not loose.** Numbers must be in parens
   (`move (10) steps`, not `move 10 steps`). This keeps the grammar
   unambiguous and lets LLMs generate valid text without coaching. Don't
   add "forgiving" rewrites.

2. **Global by default, opt-in local.** Variables/lists are global on the
   Stage unless a sprite declares them with `local variable [name]` /
   `local list [name]`, which puts them on that sprite's own dict. This was the
   `local` keyword anticipated here; see § 4.4 for the scoping rules. Do not
   make variables auto-local.

3. **Deterministic IDs.** Variable IDs are derived from the name
   (`sanitizeVarId`) rather than random. Block IDs are per-compile
   random (`makeIdGen`) — this is fine because block IDs don't need to
   survive across compiles. Broadcast / list IDs should follow the
   variable pattern.

4. **Input shadow type follows the slot's declared type.** A `num` slot
   uses `math_number (4)`; a `str` slot uses `text (10)`. Scratch is
   tolerant of mismatches at runtime, so don't special-case unless you
   see real in-VM breakage.

5. **Menus — `field` vs `menu`.** Some dropdowns (like
   `event_whenkeypressed.KEY_OPTION`) are direct fields on the parent
   block. Others (like `sensing_keypressed.KEY_OPTION`) require a shadow
   menu block with its own opcode. The slot meta distinguishes:
   `type: 'field'` → direct, `type: 'menu'` + `menuOpcode` → shadow
   block. When adding a new dropdown, check scratch-vm's block
   definitions to pick the right one. Wrong choice = load error in
   scratch.mit.edu.

6. **No ES modules, no build step.** Keep it working from `file://`.
   If you want `import`/`export` later, commit to serving via a static
   server and make that the documented run path.

7. **Template order matters.** Longer templates come first so
   `say %s for %n seconds` wins over `say %s`. The `sortByLength` at
   the bottom of `blocks.js` enforces it — leave it there.

---

## 10. Known rough edges

- The `%` suffix in `set size to (100) %` isn't handled; write without
  the trailing `%`. Fix: treat `%` as a word token that can follow a
  slot marker in the template.
- Error messages cite template text, not slot meaning ("Cannot parse
  reporter" rather than "expected a number"). Improve when adding the
  bigger test set.
- The live `scratchblocks` preview renders the *source text*, not the
  AST. Means a parse error can still produce a nice preview — which is
  sometimes confusing. Consider rendering from the compiled AST instead
  when possible.
- Default stage and fallback sprite SVGs are baked into `src/sb3.js`.
  Text-authored sprite costumes override the fallback dot. Imported image
  assets still need a persistent asset store.

---

## 11. Quick reference — where to make which change

| You want to... | File | Function |
| --- | --- | --- |
| Add a new block | `src/blocks.js` | append to the right category array |
| Fix a parsing edge case | `src/parser.js` | `tokenizeLine`, `findClose`, `parseArg` |
| Change project.json shape | `src/compile.js` | `compile`, `emitArg` |
| Fix decompiler output (.sb3 → text) | `src/decompile.js` | `fillTemplate`, `renderSlot`, `emitTarget` |
| Add asset handling | `src/sb3.js` | `attachAssets`, `buildSb3` |
| Change UI | `index.html`, `styles.css`, `src/app.js` |  |
| Add a test | `test/smoke.html` or `test/build.html` | `check(name, cond, detail)` |

**Canonical reference** for Scratch 3's format is the
[`scratch-vm`](https://github.com/scratchfoundation/scratch-vm) source,
specifically `src/serialization/sb3.js` and the per-category block
definitions under `src/blocks/`. When in doubt about an opcode's inputs,
fields, or menu blocks, read that code — don't guess.
