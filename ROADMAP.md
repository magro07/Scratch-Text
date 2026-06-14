# Roadmap

Where Scratch Text stands today and what is still planned. The authoritative,
always-current list of recognized blocks is the **Supported blocks** panel
inside the editor — this page is the higher-level picture.

Legend: ✅ works · ⚠️ works with limits · 🚧 planned / not yet

## ✅ Works today

**Core pipeline**
- Plain text → valid Scratch 3 `.sb3`, entirely in the browser, no build step.
- Live `scratchblocks` preview and a Problems panel with line numbers.
- Load an existing `.sb3` and decompile it back to text (see below).

**Project structure**
- One Stage plus any number of `sprite` / `character` targets.
- Stage backdrops and per-sprite costumes.
- Sprite metadata: position, size, direction, visibility, draggable,
  rotation style, layer order, current costume.
- Backwards-compatible single-sprite projects (no headers needed).

**Blocks**
- Motion, Looks, Events, Control, Sensing, Operators.
- Variables and lists — global by default, opt-in `local variable` /
  `local list` (sprite-only).
- Broadcasts (send / receive / "and wait").
- Clones (`create clone of`, `when I start as a clone`, `delete this clone`).
- Variable & list **monitors** (stage watchers via `show`/`hide variable`).
- **Custom blocks / "My Blocks"** — `define …` and call sites, including
  `define warp …` ("run without screen refresh").
- **Pen** extension and **Music** extension.
- **Sound** (built-in category): start/play/stop, volume, `volume` reporter.

**Costumes & assets**
- Text shape DSL: `canvas`, `rect`, `roundrect`, `circle`, `ellipse`, `line`,
  `text`, `polygon`, rotation `center`.
- Reference external `svg` / `png` / `jpg` / `jpeg` / `bmp` / `gif` via
  `from "file.ext"`; assets are hashed and bundled into the `.sb3`.

**Decompile (`.sb3` → text)**
- Recovers scripts, custom blocks, variables, lists, and broadcasts.
- Imported artwork is preserved across load → edit → download unchanged.
- Unknown opcodes degrade to a `// unknown: <opcode>` comment instead of being
  dropped.

## ⚠️ Works, with limits

- **Sound assets**: sound blocks reference sounds by name, but no audio can be
  imported/bundled yet. The two sound-*effect* blocks
  (`change/set [pitch v] effect`) are intentionally omitted — their text
  collides with the Looks effect blocks and the grammar can't disambiguate them.
- **Decompiling DSL-drawn costumes**: costumes originally authored with the
  shape DSL come back as a bare `costume Name` (the drawn shapes are not
  recoverable from the rendered SVG). Imported image assets *are* preserved.
- **Dropdown casing**: menu/field values are stored verbatim, so some
  upper-case Scratch values (e.g. `PITCH`, `LOUDNESS`, `YEAR`) round-trip fine
  but may not match Scratch's exact casing on import.
- **`set size to (100) %`**: drop the trailing `%` — it isn't parsed yet.
- **Error messages** cite template text ("Cannot parse reporter") rather than
  slot meaning ("expected a number").
- **Preview** renders the source text, not the compiled AST, so a parse error
  can still produce a clean-looking preview.

## 🚧 Planned / not yet

- **Run the project in the editor** — embed `scratch-vm` / renderer / audio so
  you can hit ▶ without exporting. Today: export to scratch.mit.edu or
  TurboWarp to run. *(Highest-impact next step.)*
- **Audio import** — bundle sound files into the `.sb3`, plus the omitted
  sound-effect blocks.
- **Image asset import** — drag-and-drop SVG/PNG/JPG and an "Assets" panel
  listing the current sprite's costumes.
- **Visual costume editor** — an in-app paint surface (the text DSL covers
  simple sprites today).
- **More extensions** — Video Sensing, Translate, Text-to-Speech,
  Makey Makey, and hardware blocks. *(Pen and Music are already supported.)*
- **Block comments** in both directions.
- **Field-casing normalization** per block, to match Scratch exactly on import.
- **Slot-aware error messages** and a larger automated test set.

---

Contributions and issues welcome. See [`AGENT.md`](AGENT.md) for the engine
internals and where to make each kind of change.
