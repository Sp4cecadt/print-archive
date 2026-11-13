'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  helperName: os.hostname().replace(/\.local$/, ''),
  host: '0.0.0.0',
  port: 8787,
  archiveDir: '~/Print Archive',
  stlWatchDir: '',
  webDir: path.join(__dirname, '..', '..', 'web'),
  apiToken: '',
  corsOrigin: '*',
  printer: { name: '', ip: '', serial: '', accessCode: '' },
  capture: { autoArchive: true, archiveFailed: true, keepThumbnails: true, captureOnStartIfFinished: true, copyStl: true },
  reprint: { remoteDir: '/', urlTemplate: 'ftp:///{file}', bedLevelling: true, timelapse: false, flowCali: false, vibrationCali: false, bedType: 'auto' },
  mock: { jobSeconds: 12 },
};

const expand = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
}

function loadConfig(file, overrides = {}) {
  let user = {};
  if (file && fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  let cfg = deepMerge(deepMerge(DEFAULTS, user), overrides);
  if (process.env.BAMBU_ACCESS_CODE) cfg.printer.accessCode = process.env.BAMBU_ACCESS_CODE;
  if (process.env.BAMBU_PRINTER_IP) cfg.printer.ip = process.env.BAMBU_PRINTER_IP;
  if (process.env.BAMBU_SERIAL) cfg.printer.serial = process.env.BAMBU_SERIAL;
  if (process.env.PRINT_ARCHIVE_PORT) cfg.port = parseInt(process.env.PRINT_ARCHIVE_PORT, 10);
  cfg.archiveDir = path.resolve(expand(cfg.archiveDir));
  cfg.stlWatchDir = cfg.stlWatchDir ? path.resolve(expand(cfg.stlWatchDir)) : '';
  cfg.webDir = path.resolve(expand(cfg.webDir));
  cfg._file = file || null;
  return cfg;
}

// Persist only user-editable keys back to the config file (never logs the access code).
function saveConfig(cfg) {
  if (!cfg._file) return false;
  let user = {};
  if (fs.existsSync(cfg._file)) user = JSON.parse(fs.readFileSync(cfg._file, 'utf8'));
  user.helperName = cfg.helperName;
  user.printer = { ...(user.printer || {}), ...cfg.printer };
  user.capture = { ...(user.capture || {}), ...cfg.capture };
  const tmp = cfg._file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(user, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, cfg._file);
  return true;
}

module.exports = { loadConfig, saveConfig, DEFAULTS, expand, deepMerge };
