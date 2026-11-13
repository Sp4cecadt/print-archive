'use strict';
// Parse a Bambu Studio / Orca sliced 3MF (".gcode.3mf") or project 3MF.
// Everything is read locally from the zip; nothing touches Bambu's cloud.
const AdmZip = require('adm-zip');

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
}
function decodeXml(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const first = v => (Array.isArray(v) ? v[0] : v);
const num = v => { const n = parseFloat(first(v)); return Number.isFinite(n) ? n : undefined; };

// Metadata/slice_info.config: per-plate prediction (s), weight (g) and filament use.
function parseSliceInfo(xml) {
  const plates = [];
  const plateRe = /<plate>([\s\S]*?)<\/plate>/g;
  let pm;
  while ((pm = plateRe.exec(xml))) {
    const body = pm[1];
    const meta = {};
    for (const t of body.match(/<metadata\b[^>]*\/?>/g) || []) {
      const k = attr(t, 'key'); if (k) meta[k] = attr(t, 'value');
    }
    const filaments = (body.match(/<filament\b[^>]*\/?>/g) || []).map(t => ({
      slot: parseInt(attr(t, 'id'), 10) || undefined,
      trayInfoIdx: attr(t, 'tray_info_idx'),
      type: attr(t, 'type'),
      color: attr(t, 'color'),
      meters: num(attr(t, 'used_m')),
      grams: num(attr(t, 'used_g')),
    }));
    const objects = (body.match(/<object\b[^>]*\/?>/g) || []).map(t => attr(t, 'name')).filter(Boolean);
    plates.push({
      index: parseInt(meta.index, 10) || plates.length + 1,
      predictionSeconds: num(meta.prediction),
      weightGrams: num(meta.weight),
      printerModelId: meta.printer_model_id,
      nozzleDiameter: num(meta.nozzle_diameters),
      filaments, objects,
    });
  }
  return plates;
}

const BED_TEMP_KEY = {
  'Cool Plate': 'cool_plate_temp', 'Engineering Plate': 'eng_plate_temp',
  'High Temp Plate': 'hot_plate_temp', 'Textured PEI Plate': 'textured_plate_temp',
  'Smooth PEI Plate': 'hot_plate_temp', 'Supertack Plate': 'supertack_plate_temp',
};

// Metadata/project_settings.config (JSON) -> short print settings summary.
function summariseSettings(ps) {
  if (!ps) return null;
  const bedType = first(ps.curr_bed_type);
  const bedKey = BED_TEMP_KEY[bedType] || 'hot_plate_temp';
  const supportOn = String(first(ps.enable_support)) === '1' || first(ps.enable_support) === true;
  return {
    printerModel: first(ps.printer_model),
    printerSettings: first(ps.printer_settings_id),
    printSettings: first(ps.print_settings_id),
    filamentSettings: Array.isArray(ps.filament_settings_id) ? ps.filament_settings_id : (ps.filament_settings_id ? [ps.filament_settings_id] : []),
    layerHeight: num(ps.layer_height),
    infillDensity: first(ps.sparse_infill_density),
    infillPattern: first(ps.sparse_infill_pattern),
    wallLoops: num(ps.wall_loops),
    supports: supportOn ? (first(ps.support_type) || 'on') : 'none',
    speeds: {
      outerWall: num(ps.outer_wall_speed),
      innerWall: num(ps.inner_wall_speed),
      infill: num(ps.sparse_infill_speed),
      travel: num(ps.travel_speed),
    },
    nozzleTemp: num(ps.nozzle_temperature),
    bedTemp: num(ps[bedKey]),
    bedType,
    filamentType: Array.isArray(ps.filament_type) ? ps.filament_type : (ps.filament_type ? [ps.filament_type] : []),
    filamentColour: Array.isArray(ps.filament_colour) ? ps.filament_colour : (ps.filament_colour ? [ps.filament_colour] : []),
  };
}

// True if any 3D/*.model part contains real triangle geometry (resliceable).
function hasMeshGeometry(zip) {
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !/^3D\/.*\.model$/i.test(e.entryName)) continue;
    const xml = e.getData().toString('utf8');
    if (/<(?:\w+:)?vertex\b/.test(xml) && /<(?:\w+:)?triangle\b/.test(xml)) return true;
  }
  return false;
}

function parse3mf(input, { plate } = {}) {
  const zip = new AdmZip(input);
  const names = zip.getEntries().map(e => e.entryName);
  const read = n => { const e = zip.getEntry(n); return e ? e.getData() : null; };

  const sliceXml = read('Metadata/slice_info.config');
  const plates = sliceXml ? parseSliceInfo(sliceXml.toString('utf8')) : [];
  let ps = null;
  const psBuf = read('Metadata/project_settings.config');
  if (psBuf) { try { ps = JSON.parse(psBuf.toString('utf8')); } catch { ps = null; } }

  const gcodePlates = names.map(n => /^Metadata\/plate_(\d+)\.gcode$/.exec(n)).filter(Boolean).map(m => parseInt(m[1], 10));
  const plateIndex = plate || (plates[0] && plates[0].index) || gcodePlates[0] || 1;
  const p = plates.find(x => x.index === plateIndex) || plates[0] || null;

  const thumbName = [`Metadata/plate_${plateIndex}.png`, 'Metadata/plate_1.png', 'Metadata/thumbnail.png', `Metadata/plate_${plateIndex}_small.png`]
    .find(n => names.includes(n));

  const settings = summariseSettings(ps);
  const filaments = (p && p.filaments) || [];
  const grams = filaments.reduce((a, f) => a + (f.grams || 0), 0) || (p && p.weightGrams) || undefined;
  const meters = filaments.reduce((a, f) => a + (f.meters || 0), 0) || undefined;

  return {
    entries: names,
    sliced: gcodePlates.length > 0,
    gcodePlates,
    plate: plateIndex,
    plates: plates.map(x => x.index),
    objects: (p && p.objects) || [],
    hasMesh: hasMeshGeometry(zip),
    thumbnailEntry: thumbName || null,
    thumbnail: thumbName ? read(thumbName) : null,
    predictionSeconds: p ? p.predictionSeconds : undefined,
    filaments,
    filamentGrams: grams !== undefined ? Math.round(grams * 100) / 100 : undefined,
    filamentMeters: meters !== undefined ? Math.round(meters * 100) / 100 : undefined,
    settings,
  };
}

module.exports = { parse3mf, parseSliceInfo, summariseSettings, hasMeshGeometry };
