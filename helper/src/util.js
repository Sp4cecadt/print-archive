'use strict';
const SERIAL_MODELS = { '00M': 'X1C', '00W': 'X1', '03W': 'X1E', '01S': 'P1P', '01P': 'P1S', '030': 'A1 mini', '039': 'A1', '094': 'H2D' };
function modelFromSerial(serial) { return (serial && SERIAL_MODELS[String(serial).slice(0, 3).toUpperCase()]) || ''; }

const COLOURS = [
  ['Black', [20, 20, 20]], ['White', [245, 245, 245]], ['Grey', [128, 128, 128]], ['Green', [0, 174, 66]],
  ['Orange', [255, 122, 26]], ['Red', [220, 40, 40]], ['Blue', [30, 90, 220]], ['Yellow', [245, 210, 30]],
  ['Purple', [130, 60, 200]], ['Pink', [240, 120, 170]], ['Brown', [120, 80, 40]], ['Silver', [190, 190, 195]],
];
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || ''); if (!m) return null;
  const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colourName(hex) {
  const c = hexToRgb(hex); if (!c) return '';
  let best = null, bd = Infinity;
  for (const [name, r] of COLOURS) { const d = (c[0] - r[0]) ** 2 + (c[1] - r[1]) ** 2 + (c[2] - r[2]) ** 2; if (d < bd) { bd = d; best = name; } }
  return best;
}
function normHex(c) { const m = /^#?([0-9a-f]{6})/i.exec(c || ''); return m ? '#' + m[1].toUpperCase() : null; }

// "Bambu PETG HF @BBL X1C" -> "PETG HF"; "Generic PLA" -> "PLA"
function filamentProduct(settingsId, type) {
  if (!settingsId) return type || '';
  let s = String(settingsId).replace(/@.*$/, '').replace(/^(Bambu|Generic)\s+/i, '').trim();
  return s || type || '';
}
function filamentLabel(f, settingsId) {
  const prod = filamentProduct(settingsId, f && f.type);
  const col = colourName(f && f.color);
  return [prod, col].filter(Boolean).join(' ');
}

function slug(s) { return String(s).toLowerCase().replace(/\.gcode\.3mf$|\.3mf$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'print'; }
function baseName(fileName) { return String(fileName).replace(/^.*[\\/]/, '').replace(/\.gcode\.3mf$|\.3mf$/i, ''); }
function normKey(s) { return String(s).toLowerCase().replace(/\.(stl|3mf|obj|step)$/i, '').replace(/[^a-z0-9]/g, ''); }

module.exports = { modelFromSerial, colourName, normHex, filamentProduct, filamentLabel, slug, baseName, normKey };
