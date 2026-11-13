'use strict';
// Seeds an archive with the demo catalog by running the real capture pipeline on generated 3MFs.
const fs = require('fs');
const path = require('path');
const { buildSample3mf } = require('./sample3mf');
const { archiveJob } = require('./capture');
const catalog = require('./demo-catalog');

const THUMBS = path.join(__dirname, '..', 'sample-assets', 'thumbs');
const metersFor = (g, type) => +(g / (type === 'PETG' ? 2.98 : 3.0)).toFixed(2); // ~1.75 mm filament

function sampleFor(d) {
  return buildSample3mf({
    name: d.name, includeMesh: d.label !== 'sliced',
    thumbnail: fs.readFileSync(path.join(THUMBS, `${d.thumb}.png`)),
    predictionSeconds: d.estMin * 60,
    filaments: [{ ...d.fil, grams: d.grams, meters: metersFor(d.grams, d.fil.type) }],
    layerHeight: d.layer || 0.2, infill: d.infill || '15%', pattern: d.pattern || 'grid', supports: d.supports || 'none',
    walls: d.walls || 2, outerWallSpeed: d.speed || 200, nozzleTemp: d.nozzle || 220, bedTemp: d.bed || 55, gcodeKb: 24,
  });
}

function seedDemo({ store, config, log = () => {} }) {
  if (config.stlWatchDir) fs.mkdirSync(config.stlWatchDir, { recursive: true });
  const out = [];
  for (const d of catalog.slice().reverse()) {
    if (d.label === 'stl' && config.stlWatchDir) {
      fs.writeFileSync(path.join(config.stlWatchDir, `${d.name}.stl`), `solid ${d.name}\nendsolid ${d.name}\n`);
    }
    const finished = new Date(d.when);
    const started = new Date(finished - d.actMin * 60000);
    const rec = archiveJob({
      store, config, log,
      buffer: sampleFor(d),
      job: {
        name: d.name, fileName: `${d.name}.gcode.3mf`, remotePath: `/${d.name}.gcode.3mf`,
        remoteMtime: started.getTime() - 4 * 60000, startedAt: started.getTime(), finishedAt: finished.getTime(),
        status: d.status || 'finished', failReason: d.status === 'failed' ? 'Failed or cancelled' : null,
        jobKey: `demo|${d.name}|${d.when}`, plate: 1,
        printer: { serial: '00M00A000000000', model: 'X1C', name: 'Studio X1C' },
      },
    });
    if (d.notes) store.update(rec.id, { notes: d.notes });
    out.push(rec);
  }
  return out;
}
module.exports = { seedDemo, sampleFor };
