// Bundles a project.json object plus referenced costume/backdrop assets into
// a valid .sb3 (a ZIP with project.json at the root and asset files named
// <md5>.<ext>).

(function (global) {
'use strict';

// Stage backdrop. 480 x 360 plain white SVG.
const STAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">' +
  '<rect width="480" height="360" fill="#ffffff"/></svg>';

// Sprite costume. A friendly blue dot.
const SPRITE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
  '<circle cx="24" cy="24" r="22" fill="#4c97ff" stroke="#3373cc" stroke-width="2"/>' +
  '<circle cx="18" cy="20" r="2.5" fill="#ffffff"/>' +
  '<circle cx="30" cy="20" r="2.5" fill="#ffffff"/>' +
  '<path d="M16 30 Q24 36 32 30" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round"/>' +
  '</svg>';

const SUPPORTED_FORMATS = {
  svg: 'svg',
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  bmp: 'bmp',
  gif: 'gif',
};

function strBytes(s) { return new TextEncoder().encode(s); }

function bytesToString(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(s));
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return strBytes(data);
  throw new Error('Asset resolver must return a string, Uint8Array, or ArrayBuffer');
}

function normalizeDataFormat(format, path) {
  const raw = (format || extensionFromPath(path) || '').toLowerCase();
  const normalized = SUPPORTED_FORMATS[raw];
  if (!normalized) {
    throw new Error(`Unsupported asset format "${raw || '(none)'}" for "${path || 'inline asset'}"`);
  }
  return normalized;
}

function extensionFromPath(path) {
  const m = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}

function addAsset(assetMap, bytes, dataFormat) {
  const hash = MD5.md5Bytes(bytes);
  const name = hash + '.' + dataFormat;
  if (!assetMap.has(name)) assetMap.set(name, { name, data: bytes });
  return { hash, name };
}

function parsePngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < png.length; i++) {
    if (bytes[i] !== png[i]) return null;
  }
  const width = ((bytes[16] << 24) >>> 0) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19];
  const height = ((bytes[20] << 24) >>> 0) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23];
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseSvgSize(bytes) {
  let text = '';
  try { text = bytesToString(bytes).slice(0, 4096); }
  catch (e) { return null; }
  const num = value => {
    const m = /^[-+]?\d+(?:\.\d+)?/.exec(value || '');
    return m ? Number(m[0]) : null;
  };
  const widthMatch = /\bwidth=["']([^"']+)["']/i.exec(text);
  const heightMatch = /\bheight=["']([^"']+)["']/i.exec(text);
  const width = widthMatch ? num(widthMatch[1]) : null;
  const height = heightMatch ? num(heightMatch[1]) : null;
  if (width && height) return { width, height };
  const viewBox = /\bviewBox=["']\s*[-+]?\d+(?:\.\d+)?\s+[-+]?\d+(?:\.\d+)?\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*["']/i.exec(text);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  return null;
}

function inferImageSize(bytes, dataFormat) {
  if (dataFormat === 'png') return parsePngSize(bytes);
  if (dataFormat === 'svg') return parseSvgSize(bytes);
  return null;
}

function defaultCostumeSpec(isStage) {
  return isStage
    ? { name: 'backdrop1', svg: STAGE_SVG, dataFormat: 'svg', rotationCenterX: 240, rotationCenterY: 180 }
    : { name: 'costume1', svg: SPRITE_SVG, dataFormat: 'svg', rotationCenterX: 24, rotationCenterY: 24 };
}

function getCostumeSpecs(target) {
  return target._scratchTextCostumes && target._scratchTextCostumes.length > 0
    ? target._scratchTextCostumes
    : [defaultCostumeSpec(!!target.isStage)];
}

function defaultCenter(isStage) {
  return isStage ? { x: 240, y: 180 } : { x: 24, y: 24 };
}

function finishCostumeRecord(spec, index, bytes, dataFormat, asset, isStage) {
  const center = defaultCenter(isStage);
  const size = inferImageSize(bytes, dataFormat);
  const fallbackX = size ? size.width / 2 : center.x;
  const fallbackY = size ? size.height / 2 : center.y;
  const record = {
    name: spec.name || (isStage ? `backdrop${index + 1}` : `costume${index + 1}`),
    dataFormat,
    assetId: asset.hash,
    md5ext: asset.name,
    rotationCenterX: spec.rotationCenterX !== undefined ? spec.rotationCenterX : fallbackX,
    rotationCenterY: spec.rotationCenterY !== undefined ? spec.rotationCenterY : fallbackY,
  };
  if (dataFormat !== 'svg') {
    record.bitmapResolution = spec.bitmapResolution || 1;
  }
  return record;
}

function resolveInlineAsset(spec) {
  if (spec.svg !== undefined) return { bytes: strBytes(spec.svg), dataFormat: 'svg' };
  if (spec.bytes !== undefined) return { bytes: toBytes(spec.bytes), dataFormat: normalizeDataFormat(spec.dataFormat, spec.path) };
  return null;
}

function materializeCostumeSync(spec, index, isStage, assetMap, resolveAsset) {
  const inline = resolveInlineAsset(spec);
  let bytes, dataFormat;
  if (inline) {
    bytes = inline.bytes;
    dataFormat = inline.dataFormat;
  } else if (spec.path) {
    dataFormat = normalizeDataFormat(spec.dataFormat, spec.path);
    if (!resolveAsset) throw new Error(`Missing asset resolver for "${spec.path}"`);
    const resolved = resolveAsset(spec.path, spec);
    if (resolved === undefined || resolved === null) throw new Error(`Asset not found: ${spec.path}`);
    if (resolved && typeof resolved.then === 'function') {
      throw new Error(`Asset resolver for "${spec.path}" returned a Promise; use attachAssetsAsync/buildSb3 instead`);
    }
    bytes = toBytes(resolved);
  } else {
    throw new Error(`Costume "${spec.name || index + 1}" has no SVG, bytes, or asset path`);
  }
  const asset = addAsset(assetMap, bytes, dataFormat);
  return finishCostumeRecord(spec, index, bytes, dataFormat, asset, isStage);
}

async function defaultFetchAsset(path) {
  if (typeof fetch !== 'function') throw new Error(`No fetch implementation available for asset "${path}"`);
  const url = (typeof document !== 'undefined' && document.baseURI)
    ? new URL(path, document.baseURI).href
    : path;
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new Error(`Asset not found: ${path}`);
  }
  if (!response.ok) throw new Error(`Asset not found: ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function materializeCostumeAsync(spec, index, isStage, assetMap, resolveAsset) {
  const inline = resolveInlineAsset(spec);
  let bytes, dataFormat;
  if (inline) {
    bytes = inline.bytes;
    dataFormat = inline.dataFormat;
  } else if (spec.path) {
    dataFormat = normalizeDataFormat(spec.dataFormat, spec.path);
    const resolved = await resolveAsset(spec.path, spec);
    if (resolved === undefined || resolved === null) throw new Error(`Asset not found: ${spec.path}`);
    bytes = toBytes(resolved);
  } else {
    throw new Error(`Costume "${spec.name || index + 1}" has no SVG, bytes, or asset path`);
  }
  const asset = addAsset(assetMap, bytes, dataFormat);
  return finishCostumeRecord(spec, index, bytes, dataFormat, asset, isStage);
}

function normalizeCurrentCostume(target) {
  if (!target.costumes || target.costumes.length === 0) {
    target.currentCostume = 0;
    return;
  }
  const idx = Number(target.currentCostume);
  target.currentCostume = Number.isInteger(idx) && idx >= 0 && idx < target.costumes.length ? idx : 0;
}

function attachAssets(projectJson, options) {
  const assetMap = new Map();
  const resolveAsset = options && options.resolveAsset;
  for (const target of projectJson.targets || []) {
    const specs = getCostumeSpecs(target);
    target.costumes = specs.map((spec, i) =>
      materializeCostumeSync(spec, i, !!target.isStage, assetMap, resolveAsset));
    normalizeCurrentCostume(target);
  }
  return {
    projectJson,
    assets: Array.from(assetMap.values()),
  };
}

async function attachAssetsAsync(projectJson, options) {
  const assetMap = new Map();
  const resolveAsset = options && (options.resolveAsset || options.fetchAsset) || defaultFetchAsset;
  for (const target of projectJson.targets || []) {
    const specs = getCostumeSpecs(target);
    const costumes = [];
    for (let i = 0; i < specs.length; i++) {
      costumes.push(await materializeCostumeAsync(specs[i], i, !!target.isStage, assetMap, resolveAsset));
    }
    target.costumes = costumes;
    normalizeCurrentCostume(target);
  }
  return {
    projectJson,
    assets: Array.from(assetMap.values()),
  };
}

async function buildSb3(projectJson, options) {
  const { assets } = await attachAssetsAsync(projectJson, options);
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(projectJson));
  for (const a of assets) zip.file(a.name, a.data);
  return await zip.generateAsync({ type: 'blob', mimeType: 'application/x.scratch.sb3' });
}

global.SB3 = { buildSb3, attachAssets, attachAssetsAsync, STAGE_SVG, SPRITE_SVG };

})(window);
