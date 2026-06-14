# Scratch Text User Guide

Scratch Text is a browser-based editor that turns plain text into a valid
Scratch 3 `.sb3` project. You write code in a Scratch-like text format, preview
the blocks, and download a project that can be opened in Scratch or TurboWarp.

The editor runs entirely in the browser. There is no build step.

## Quick Start

1. Open `index.html` in a modern browser.
2. Write or paste Scratch Text code into the editor pane on the left.
3. Check the block preview and the Problems panel on the right.
4. Click `Download .sb3`.
5. Open the downloaded file in Scratch:
   - Go to https://scratch.mit.edu/projects/editor/
   - Choose `File` -> `Load from your computer`
   - Select the downloaded `.sb3` file

Opening `index.html` directly in a browser is all you need — this build loads
no external files. If you would rather serve it over HTTP, run a small static
server from the project root:

```bash
cd Scratch-Text
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

## First Complete Example

```text
stage
    backdrop Day
    backdrop Night

    when green flag clicked
        switch backdrop to [Day v]

    when backdrop switches to [Night v]
        say [The Stage can run code too]

sprite Player
    costume Idle

    position x: (0) y: (-100)
    size (100)
    direction (90)
    visible true

    when flag clicked
        go to x: (0) y: (-100)
        say [Hello!] for (2) seconds

sprite Enemy
    costume Default

    when flag clicked
        show
```

This produces one Scratch Stage target with two backdrops and two sprite
targets, `Player` and `Enemy`. The `backdrop`/`costume` lines are named
placeholders — open the `.sb3` in Scratch to give them real artwork.

## The Editor Layout

The editor has four main areas:

- `Editor`: where you write Scratch Text source.
- `Preview`: a visual scratchblocks rendering of the source.
- `Problems`: parser and compiler errors with line numbers when available.
- `Supported blocks`: a generated list of block templates the compiler knows.

The preview is for reading the text as blocks. The final `.sb3` is produced by
the compiler, not by the preview.

## Basic Syntax Rules

Scratch Text is indentation-based. It does not use braces.

Good:

```text
when flag clicked
forever
    move (10) steps
    if on edge, bounce
end
```

Bad:

```text
when flag clicked {
  move 10 steps
}
```

Important syntax rules:

- Blank lines are allowed.
- Lines starting with `//` or `#` are comments.
- Indentation defines bodies for `forever`, `repeat`, `if`, costumes, and
  backdrops.
- Tabs count as 4 spaces.
- Most scripts should start with a hat block such as `when flag clicked`.
- A new hat block starts a new script.

## Brackets And Input Types

Bracket shape matters. The parser uses it to decide which Scratch input type to
generate.

| Source form | Meaning | Example |
| --- | --- | --- |
| `( ... )` | Number or reporter expression | `move (10) steps` |
| `[ ... ]` | Text/string literal | `say [hello]` |
| `[ ... v]` | Dropdown, variable, list, broadcast, menu | `set [score v] to (0)` |
| `[#rrggbb c]` | Color picker value | `set pen color to [#00ff00 c]` |
| `< ... >` | Boolean expression | `if <(score) > (10)> then` |

Numbers must be in parentheses. Write `move (10) steps`, not `move 10 steps`.

## Targets: Stage And Sprites

A Scratch project contains exactly one Stage and zero or more sprites.

In Scratch Text:

- `stage` selects the Stage target.
- `sprite Name`, `character Name`, and `char Name` select a sprite target.
- If you do not write a sprite header, the old shorthand still works and code
  goes into a default sprite named `Sprite1`.
- Reusing the same sprite name later appends more scripts or costumes to that
  existing sprite.

Example:

```text
character Cat
when flag clicked
say [I am Cat]

character Dog
when flag clicked
say [I am Dog]

character Cat
when [space v] key pressed
say [This is another Cat script]
```

This creates two sprite targets: `Cat` and `Dog`. `Cat` has two scripts.

## Stage Code And Backdrops

The Stage is a real Scratch target. Code under `stage` is exported into the
Stage target's `blocks` object.

Backdrops are not separate code objects in Scratch. They are costumes of the
Stage.

```text
stage
    backdrop Blue
    backdrop Red

    current backdrop [Blue v]

    when green flag clicked
        switch backdrop to [Blue v]

    when backdrop switches to [Red v]
        say [Red backdrop is active]
```

Use `when backdrop switches to [name v]` when a specific backdrop should trigger
code.

If you do not define any Stage or backdrop, the compiler still creates a valid
default Stage with a white backdrop.

## Sprite Properties

You can set common sprite properties inside a sprite section.

```text
sprite Player
    position x: (0) y: (-100)
    size (90)
    direction (45)
    visible true
    draggable false
    rotation style [left-right]
    current costume [Idle v]
```

Supported sprite property lines:

| Property | Example |
| --- | --- |
| Position | `position x: (0) y: (-100)` |
| Size | `size (100)` |
| Direction | `direction (90)` |
| Visibility | `visible true` |
| Draggable | `draggable false` |
| Rotation style | `rotation style [left-right]` |
| Layer order | `layerOrder (2)` |
| Current costume | `current costume [Idle v]` |

If multiple sprites do not specify positions, the compiler staggers them
horizontally so they do not all start in the exact same spot.

## Costumes And Backdrops

**This build does not create or import artwork.** It authors a project's
*logic and structure* — scripts, sprites, variables, lists, broadcasts — and
leaves the **graphics to you**: you draw or upload them in Scratch (or
TurboWarp) after importing the `.sb3`.

So a `costume` or `backdrop` line is just a **named placeholder**:

```text
sprite Player
    costume Idle
    costume Hurt

stage
    backdrop Day
    backdrop Night
```

This gives `Player` two costumes named `Idle` and `Hurt`, and the Stage two
backdrops named `Day` and `Night`. Each starts as a small default placeholder
image. Open the project in Scratch and draw or upload the real artwork for each
named costume — the names are what your scripts (`switch costume to [Idle v]`,
`next costume`, …) refer to.

What is deliberately **not** supported in this build:

- **Drawing costumes in text** with shape lines (`canvas`, `circle`, `rect`,
  `line`, `text`, `polygon`, …). These are rejected with an error.
- **Importing image files** with `costume Name from "file.svg"` or
  `backdrop Name from "file.png"`. Also rejected with an error.

Defaults:

- A sprite with **no `costume` line** gets a default placeholder costume.
- A Stage with no `backdrop` gets a default backdrop.
- A `costume`/`backdrop` you name is exported as that placeholder until you
  replace its artwork in Scratch.

## Scripts And Blocks

A script usually starts with a hat block:

```text
when flag clicked
say [Hello]
```

Supported green flag spellings:

```text
when flag clicked
when green flag clicked
when greenFlag
```

Multiple scripts on one target:

```text
sprite Player
    when flag clicked
        say [green flag]

    when [space v] key pressed
        say [space]

    when I receive [start v]
        say [broadcast received]
```

Control blocks use indentation and `end`:

```text
when flag clicked
forever
    move (10) steps
    if <touching [edge v]?> then
        turn cw (15) degrees
    end
end
```

If/else:

```text
when flag clicked
if <(score) > (10)> then
    say [winning]
else
    say [keep going]
end
```

See the `Supported blocks` panel in the editor for the exact block templates
available in this build.

## Variables, Lists, And Broadcasts

Variables are created when you use variable dropdown slots.

```text
when flag clicked
set [score v] to (0)
change [score v] by (1)
say (score)
```

Lists are created when you use list slots.

```text
when flag clicked
add [apple] to [items v]
delete [last v] of [items v]
say (length of [items v])
```

Broadcasts are created when you broadcast or receive a message.

```text
sprite Button
    when this sprite clicked
        broadcast [start v]

sprite Player
    when I receive [start v]
        say [Starting!]
```

By default variables and lists are **global ("for all sprites")** and stored on
the Stage. Broadcast names are always global.

A sprite can declare a **sprite-local ("for this sprite only")** variable or
list with a declaration line in its section:

```text
sprite Hero
    local variable [health]
    local list [inventory]

    when flag clicked
        set [health v] to (100)
        add [sword] to [inventory v]
        set [score v] to (0)
```

Here `health` and `inventory` belong to `Hero` only, while `score` is global. A
sprite-local name can even shadow a global of the same name used by another
sprite, exactly like Scratch.

## Common Block Examples

Motion:

```text
move (10) steps
turn cw (15) degrees
turn ccw (15) degrees
go to x: (0) y: (0)
glide (1) secs to x: (100) y: (50)
point in direction (90)
if on edge, bounce
```

Looks:

```text
say [Hello] for (2) seconds
say [Hello]
think [Hmm] for (2) seconds
show
hide
switch costume to [Idle v]
switch backdrop to [Night v]
next costume
next backdrop
set size to (100)
change size by (10)
```

Events:

```text
when flag clicked
when [space v] key pressed
when this sprite clicked
when backdrop switches to [Night v]
when I receive [start v]
broadcast [start v]
broadcast [done v] and wait
```

Control:

```text
wait (1) seconds
repeat (10)
    move (10) steps
end
forever
    move (10) steps
end
if <mouse down?> then
    say [clicked]
end
stop [all v]
```

Clones:

```text
sprite Shooter
    when flag clicked
        create clone of [myself v]
        create clone of [Bullet v]

sprite Bullet
    when I start as a clone
        move (10) steps
        if on edge, bounce
        delete this clone
```

`create clone of [myself v]` creates a clone of the current sprite.
`create clone of [SpriteName v]` creates a clone of another named sprite.
Each clone runs its own `when I start as a clone` script.
`delete this clone` removes the clone that is currently running the script.

Operators and sensing:

```text
if <(score) > (10)> then
    say [high score]
end

say ((x position) + (10))
say (pick random (1) to (10))
if <key [space v] pressed?> then
    say [space]
end
```

Pen extension:

```text
when flag clicked
erase all
pen down
set pen color to [#00ff00 c]
set pen size to (3)
move (100) steps
pen up
```

Using a Pen block automatically adds the Scratch Pen extension to the exported
project.

Music extension:

```text
when flag clicked
set instrument to [2 v]
set tempo to (120)
play drum [1 v] for (0.25) beats
rest for (0.5) beats
play note (60) for (0.25) beats
change tempo by (20)
say (tempo)
```

`drum` and `instrument` are dropdowns that take a number (`[1 v]` … `[18 v]`
for drums, `[1 v]` … `[21 v]` for instruments). Using any Music block adds the
Scratch Music extension to the exported project.

Sound (a built-in category, no extension needed):

```text
when flag clicked
start sound [Meow v]
play sound [Pop v] until done
set volume to (80)
change volume by (-10)
stop all sounds
say (volume)
```

The sound dropdown names a sound that must exist in the project. Sound assets
cannot be imported yet, so these blocks reference sounds by name but no audio is
bundled. The two sound-effect blocks (`change/set [pitch v] effect`) are not
available because their text collides with the Looks effect blocks.

## Backwards-Compatible Single-Sprite Projects

Old simple files still work. This creates one Stage and one default sprite
named `Sprite1`.

```text
when flag clicked
say [Hello, Scratch!] for (2) seconds
move (10) steps
```

You only need target headers when you want Stage code, custom backdrops, named
sprites, multiple sprites, or target metadata.

## Loading An Existing `.sb3`

Click `Load .sb3` and pick a Scratch 3 project file. The editor decompiles its
`project.json` back into Scratch Text and replaces the editor contents, so you
can read and edit an existing project as text.

- Scripts, custom blocks (`define`), variables, lists, and broadcasts are
  recovered.
- Costumes and backdrops come back as **names only** (`costume Name`). Because
  this build cannot import images, the original artwork is **not** carried over
  — if you re-export, the costumes are placeholders again and you re-add the art
  in Scratch.
- Blocks this build does not know are emitted as a `// unknown: <opcode>`
  comment instead of being dropped silently.

So loading a `.sb3` is for reading and editing its **scripts and structure** as
text, not for round-tripping its artwork.

## Export Details

When you click `Download .sb3`, the compiler builds:

```json
{
  "targets": [
    { "isStage": true, "name": "Stage", "...": "..." },
    { "isStage": false, "name": "Player", "...": "..." },
    { "isStage": false, "name": "Enemy", "...": "..." }
  ],
  "monitors": [],
  "extensions": [],
  "meta": { "...": "..." }
}
```

Important export rules:

- The Stage is always the first target.
- Stage scripts go into the Stage target's `blocks`.
- Sprite scripts go into that sprite target's `blocks`.
- Backdrops go into the Stage target's `costumes`.
- Sprite costumes go into that sprite target's `costumes`.
- Asset files are included in the zip and referenced by MD5-based filenames.

## Troubleshooting

`Unknown block`

The line does not match any supported block template. Open `Supported blocks`
and compare the exact wording and bracket shapes.

`Expected (number)`

You probably wrote a number without parentheses.

Bad:

```text
move 10 steps
```

Good:

```text
move (10) steps
```

`Missing "end"`

A control block such as `forever`, `repeat`, or `if` was not closed.

```text
if <mouse down?> then
    say [down]
end
```

`... is disabled in this build`

You tried to draw a costume with shape lines (`canvas`, `circle`, `rect`, …) or
import one with `from "..."`. This build does neither — write just
`costume Name` / `backdrop Name` and add the artwork in Scratch after importing
the `.sb3`.

Preview looks odd, but Problems says no errors

The preview is rendered by the scratchblocks library from the source text. The
actual `.sb3` is generated by the compiler. If the Problems panel says there
are no issues, export and load the `.sb3` in Scratch for the final behavior.

## Current Limitations

Not every Scratch feature is supported yet. See [`ROADMAP.md`](ROADMAP.md) for
the full picture of what works, what is limited, and what is planned.

Currently missing or limited:

- **Creating or importing artwork.** By design, this build authors logic and
  structure only: costumes/backdrops are named placeholders, and you draw or
  upload the real images in Scratch after importing the `.sb3`. Drawing in text
  (`canvas`/`circle`/`rect`/…) and image import (`from "..."`) are rejected.
- Importing sound assets (sound blocks exist but no audio can be bundled), and
  the two sound-effect blocks (`change/set [pitch v] effect`).
- Running the project inside the editor (export to Scratch/TurboWarp to run).
- Some Scratch extensions such as Translate, Video Sensing, and
  Text-to-Speech. (Pen and Music are supported.)
- Block comments.
- Decompiling a `.sb3` recovers scripts, structure, variables, lists, and
  broadcasts, but costumes come back as a bare `costume Name` (artwork is not
  carried over).

The best way to check current block support is the `Supported blocks` panel in
the editor.

## Testing The Editor

The repository includes smoke tests for parser, compiler, and packaging paths.

Syntax checks:

```bash
node --check src/blocks.js
node --check src/parser.js
node --check src/compile.js
node --check src/sb3.js
node --check src/app.js
```

Node smoke test:

```bash
node test/smoke.js
```

Browser smoke tests:

```bash
# run from the repository root
firefox --headless --no-remote --profile /tmp/ff-smoke-profile \
  --window-size 1100,2200 --screenshot /tmp/smoke.png \
  "file://$PWD/test/smoke.html"

firefox --headless --no-remote --profile /tmp/ff-build-profile \
  --window-size 1100,1300 --screenshot /tmp/build.png \
  "file://$PWD/test/build.html"
```

