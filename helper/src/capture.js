'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse3mf } = require('./threemf');
const { findStl } = require('./stl');
const { slug, baseName, filamentLabel, normHex, colourName } = require('./util');

const pad = n => String(n).padStart(2, '0');

/**
 * Archive one finished (or failed) job.
 * job: { name, fileName, remotePath, remoteMtime, startedAt, finishedAt, status, plate, jobKey, printer:{serial,model,name}, finalTemps }
 * buffer: the 3MF bytes copied from the printer (may be null if the copy failed; the record is still kept).
 */
function archiveJob({ store, config, job, buffer, log = () => {} }) {
  const finished = new Date(job.finishedAt || Date.now());
  const id = `${finished.getFullYear()}${pad(finished.getMonth() + 1)}${pad(finished.getDate())}-${pad(finished.getHours())}${pad(finished.getMinutes())}${pad(finished.getSeconds())}-${slug(job.name || job.fileName)}`
    + '-' + crypto.randomBytes(2).toString('hex');
  const relDir = path.join(`${finished.getFullYear()}-${pad(finished.getMonth() + 1)}`, id);
  const absDir = path.join(store.dir, relDir);
  fs.mkdirSync(absDir, { recursive: true });

  let meta = null, parseError = null;
  const files = {};
  const fileName = job.fileName || `${job.name}.gcode.3mf`;
  if (buffer) {
    fs.writeFileSync(path.join(absDir, 'file.3mf'), buffer);
    files.file = 'file.3mf';
    try { meta = parse3mf(buffer, { plate: job.plate }); } catch (e) { parseError = e.message; log(`3MF parse failed: ${e.message}`); }
    if (meta && meta.thumbnail && config.capture.keepThumbnails !== false) {
      fs.writeFileSync(path.join(absDir, 'thumb.png'), meta.thumbnail);
      files.thumb = 'thumb.png';
    }
  }

  const name = job.name || baseName(fileName);
  let stl = null;
  if (config.stlWatchDir) {
    const found = findStl(config.stlWatchDir, [name, baseName(fileName), ...((meta && meta.objects) || [])]);
    if (found) {
      stl = { name: found.name, size: found.size, sourcePath: found.path };
      if (config.capture.copyStl !== false) {
        fs.copyFileSync(found.path, path.join(absDir, 'mesh.stl'));
        files.stl = 'mesh.stl';
      }
    }
  }

  const s = meta && meta.settings;
  const fil = (meta && meta.filaments) || [];
  const settingsIds = (s && s.filamentSettings) || [];
  const filaments = fil.map((f, i) => ({
    ...f,
    color: normHex(f.color) || normHex((s && s.filamentColour[i]) || ''),
    label: filamentLabel(f, settingsIds[(f.slot || i + 1) - 1] || settingsIds[i]),
  }));
  const primary = filaments.slice().sort((a, b) => (b.grams || 0) - (a.grams || 0))[0] || null;

  const started = job.startedAt ? new Date(job.startedAt) : null;
  const actualSeconds = started ? Math.max(0, Math.round((finished - started) / 1000)) : undefined;
  const hasMesh = !!(meta && meta.hasMesh);
  const label = stl ? 'stl' : hasMesh ? 'mesh' : 'sliced';

  const rec = {
    id, relDir, files,
    jobKey: job.jobKey || null,
    name,
    fileName,
    fileSize: buffer ? buffer.length : null,
    fileCreated: job.remoteMtime ? new Date(job.remoteMtime).toISOString() : (started ? started.toISOString() : null),
    remotePath: job.remotePath || null,
    archivedAt: new Date().toISOString(),
    startedAt: started ? started.toISOString() : null,
    finishedAt: finished.toISOString(),
    status: job.status === 'failed' ? 'failed' : 'finished',
    failReason: job.failReason || null,
    label, hasMesh,
    stl: stl ? { name: stl.name, size: stl.size } : null,
    plate: (meta && meta.plate) || job.plate || 1,
    sliced: meta ? meta.sliced : null,
    predictionSeconds: meta ? meta.predictionSeconds : undefined,
    actualSeconds,
    filaments,
    filamentGrams: meta ? meta.filamentGrams : undefined,
    filamentMeters: meta ? meta.filamentMeters : undefined,
    filamentLabel: primary ? primary.label : '',
    filamentType: primary ? primary.type : '',
    filamentShort: primary ? [primary.type, colourName(primary.color)].filter(Boolean).join(' ') : '',
    filamentColor: primary ? primary.color : null,
    settings: s ? {
      layerHeight: s.layerHeight, infillDensity: s.infillDensity, infillPattern: s.infillPattern, wallLoops: s.wallLoops,
      supports: s.supports, speeds: s.speeds, nozzleTemp: s.nozzleTemp, bedTemp: s.bedTemp, bedType: s.bedType,
      printSettings: s.printSettings, printerModel: s.printerModel,
    } : null,
    finalTemps: job.finalTemps || null,
    printer: job.printer || null,
    notes: '',
    parseError,
    copyError: job.copyError || null,
  };
  store.add(rec);
  log(`Archived ${rec.status} job "${rec.name}" -> ${relDir} (${rec.label})`);
  return rec;
}

module.exports = { archiveJob };
