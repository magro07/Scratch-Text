// Wires the UI together: editor -> parse -> preview + errors -> download .sb3.

(function () {
'use strict';

// Costumes/backdrops are named placeholders here — this build authors logic
// only; you add the artwork in Scratch after importing the .sb3.
const SAMPLE = [
  '// Costumes and backdrops are named placeholders.',
  '// Add their artwork in Scratch after importing the .sb3.',
  'stage',
  '    backdrop Day',
  '    backdrop Night',
  '    when green flag clicked',
  '        switch backdrop to [Day v]',
  '    when backdrop switches to [Night v]',
  '        say [Night mode]',
  '',
  'character Player',
  '    costume PlayerFace',
  '    position x: (0) y: (-100)',
  '    when flag clicked',
  '        go to x: (0) y: (-100)',
  '        say [Hello!] for (2) seconds',
  '',
  'sprite Enemy',
  '    costume EnemyBlock',
  '    when flag clicked',
  '        show',
].join('\n');

const editor     = document.getElementById('editor');
const previewEl  = document.getElementById('preview');
const errorsEl   = document.getElementById('errors');
const errCountEl = document.getElementById('errCount');
const downloadBtn = document.getElementById('download');
const loadBtn    = document.getElementById('load');
const loadInput  = document.getElementById('loadFile');
const helpEl     = document.getElementById('help');
const toggleHelp = document.getElementById('toggleHelp');

editor.value = SAMPLE;

let currentProject = null;
// Asset bytes from a loaded .sb3, keyed by md5ext filename, so a decompiled
// project that references `from "<md5ext>"` can be re-exported with its
// original artwork intact.
let loadedAssets = {};

function render() {
  let parseResult;
  try {
    parseResult = PARSER.parseProgram(editor.value);
  } catch (e) {
    showErrors([{ line: 0, msg: 'Fatal parse error: ' + e.message }]);
    previewEl.textContent = '';
    downloadBtn.disabled = true;
    return;
  }

  const { program, errors, warnings } = parseResult;
  showErrors(errors, warnings);

  // Render scratchblocks preview from the source text directly.
  try {
    previewEl.innerHTML = '';
    const container = document.createElement('pre');
    container.className = 'blocks';
    container.textContent = editor.value;
    previewEl.appendChild(container);
    if (global_scratchblocks()) {
      window.scratchblocks.renderMatching('#preview pre.blocks', { style: 'scratch3', scale: 0.75 });
    }
  } catch (e) {
    previewEl.textContent = editor.value;
  }

  try {
    currentProject = COMPILE.compile(program);
    // Don't allow exporting a project that still has errors — e.g. an attempt to
    // draw or import a costume, which this build deliberately does not support.
    downloadBtn.disabled = errors.length > 0;
  } catch (e) {
    showErrors(errors.concat([{ line: 0, msg: 'Compile error: ' + e.message }]), warnings);
    currentProject = null;
    downloadBtn.disabled = true;
  }
}

function global_scratchblocks() { return typeof window.scratchblocks !== 'undefined'; }

function showErrors(errors, warnings) {
  errorsEl.innerHTML = '';
  errors = errors || [];
  warnings = warnings || [];

  if (errors.length === 0 && warnings.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'ok';
    ok.textContent = 'No problems.';
    errorsEl.appendChild(ok);
    errCountEl.textContent = '0';
    return;
  }

  errCountEl.textContent = warnings.length
    ? `${errors.length} (+${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
    : String(errors.length);

  const addRow = (item, cls) => {
    const row = document.createElement('div');
    row.className = cls;
    const loc = document.createElement('span');
    loc.className = 'loc';
    loc.textContent = item.line ? `line ${item.line}:` : '';
    row.appendChild(loc);
    row.appendChild(document.createTextNode(item.msg));
    errorsEl.appendChild(row);
  };
  for (const e of errors) addRow(e, 'err');
  for (const w of warnings) addRow(w, 'warn');
}

async function downloadSb3() {
  if (!currentProject) return;
  downloadBtn.disabled = true;
  const prev = downloadBtn.textContent;
  downloadBtn.textContent = 'Packaging...';
  try {
    const resolveAsset = async (path) => {
      if (Object.prototype.hasOwnProperty.call(loadedAssets, path)) return loadedAssets[path];
      // Fall back to fetching external asset references relative to the page.
      const url = (typeof document !== 'undefined' && document.baseURI)
        ? new URL(path, document.baseURI).href : path;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Asset not found: ' + path);
      return new Uint8Array(await resp.arrayBuffer());
    };
    const blob = await SB3.buildSb3(currentProject, { resolveAsset });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.sb3';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    alert('Build failed: ' + e.message);
  } finally {
    downloadBtn.textContent = prev;
    downloadBtn.disabled = false;
  }
}

async function loadSb3(file) {
  if (!file) return;
  const prev = loadBtn.textContent;
  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading...';
  try {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const projectFile = zip.file('project.json');
    if (!projectFile) throw new Error('No project.json found in this .sb3');
    const projectJson = JSON.parse(await projectFile.async('string'));

    // Stash every asset by its in-zip filename (the md5ext) so re-export can
    // write the original artwork back out unchanged.
    const assets = {};
    const entries = Object.keys(zip.files);
    for (const name of entries) {
      if (name === 'project.json' || zip.files[name].dir) continue;
      assets[name] = await zip.files[name].async('uint8array');
    }
    loadedAssets = assets;

    editor.value = DECOMPILE.decompile(projectJson);
    render();
  } catch (e) {
    showErrors([{ line: 0, msg: 'Load failed: ' + e.message }]);
  } finally {
    loadBtn.textContent = prev;
    loadBtn.disabled = false;
  }
}

function renderHelp() {
  const cats = [
    ['Hats', BLOCKS.HATS],
    ['Motion / Looks / Control / Variables', BLOCKS.STACKS.concat(BLOCKS.C_BLOCKS)],
    ['Reporters (use inside (round) slots)', BLOCKS.REPORTERS],
    ['Booleans (use inside <angle> slots)', BLOCKS.BOOLEANS],
  ];
  const parts = [];
  for (const [name, list] of cats) {
    parts.push(`<span class="cat">${name}</span><ul>`);
    for (const t of list) {
      parts.push(`<li>${escapeHtml(t.text)}</li>`);
    }
    parts.push('</ul>');
  }
  helpEl.innerHTML = parts.join('');
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

toggleHelp.addEventListener('click', () => {
  if (helpEl.hidden) {
    helpEl.hidden = false;
    toggleHelp.textContent = 'hide';
    renderHelp();
  } else {
    helpEl.hidden = true;
    toggleHelp.textContent = 'show';
  }
});

let debounceTimer = null;
editor.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, 150);
});

// Make Tab in the textarea indent by 4 spaces instead of changing focus.
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart, end = editor.selectionEnd;
    const v = editor.value;
    if (e.shiftKey) {
      // outdent
      const lineStart = v.lastIndexOf('\n', start - 1) + 1;
      if (v.slice(lineStart, lineStart + 4) === '    ') {
        editor.value = v.slice(0, lineStart) + v.slice(lineStart + 4);
        editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 4);
      }
    } else {
      editor.value = v.slice(0, start) + '    ' + v.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 4;
    }
    render();
  }
});

downloadBtn.addEventListener('click', downloadSb3);
loadBtn.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', () => {
  const file = loadInput.files && loadInput.files[0];
  loadSb3(file);
  loadInput.value = ''; // allow re-loading the same file
});

render();

})();
