#!/usr/bin/env node
'use strict';
// Builds the static demo dataset for the GitHub Pages copy: web/demo/{prints.json,thumbs/,files/}
process.env.TZ = process.env.TZ || 'Australia/Adelaide';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');
const { seedDemo } = require('../src/demo');
const { loadConfig } = require('../src/config');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-demo-'));
const config = loadConfig(null, { archiveDir: path.join(tmp, 'archive'), stlWatchDir: path.join(tmp, 'stl') });
const store = new Store(config.archiveDir);
seedDemo({ store, config });

const out = path.join(__dirname, '..', '..', 'web', 'demo');
fs.rmSync(out, { recursive: true, force: true });
for (const d of ['thumbs', 'files']) fs.mkdirSync(path.join(out, d), { recursive: true });
const prints = store.all().map((r, i) => {
  const id = `demo-${String(i + 1).padStart(2, '0')}`;
  const cp = (kind, dest) => { const f = store.pathFor(r, kind); if (!f) return null; fs.copyFileSync(f, path.join(out, dest)); return `demo/${dest}`; };
  const { relDir, files, jobKey, remotePath, ...rest } = r;
  return {
    ...rest, id,
    thumbUrl: cp('thumb', `thumbs/${id}.png`),
    fileUrl: cp('file', `files/${id}.3mf`),
    stlUrl: cp('stl', `files/${id}.stl`),
    archivePath: relDir.replace(/[^/]+$/, ''),
  };
});
const last = prints[0];
const status = {
  app: 'print-archive', version: require('../package.json').version, mode: 'demo',
  helper: { name: "Home MacBook Pro", online: true, startedAt: null, lastCapture: { id: last.id, name: last.name, at: last.finishedAt }, archiveDir: '/Users/you/Print Archive', stlWatchDir: '/Users/you/3D Models', tokenRequired: false },
  printer: {
    configured: true, connected: true, name: 'Studio X1C', model: 'X1C', ip: '192.168.1.64', serial: '00M00A000000000', accessCodeSet: true,
    firmware: '01.09.00.00', state: 'IDLE', percent: 0, remainingMin: null, job: null,
    loaded: { type: 'PLA', color: '#161616', name: 'PLA Basic', source: 'External spool' }, ams: [], nozzleTemp: 26, bedTemp: 24,
  },
  capture: config.capture,
  count: prints.length,
};
fs.writeFileSync(path.join(out, 'prints.json'), JSON.stringify({ generated: 'demo', status, prints }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Demo data: ${prints.length} prints -> ${out}`);
