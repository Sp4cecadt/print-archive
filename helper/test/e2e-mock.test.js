'use strict';
// End-to-end: helper in mock mode -> simulated MQTT job -> capture -> REST API -> notes -> download -> reprint.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { loadConfig } = require('../src/config');
const { ArchiveApp } = require('../src/app');
const { createServer } = require('../src/server');
const { seedDemo } = require('../src/demo');

const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } throw new Error('timeout'); };

async function startHelper(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-e2e-'));
  const cfgFile = path.join(dir, 'config.json');
  fs.writeFileSync(cfgFile, '{}');
  const config = loadConfig(cfgFile, { archiveDir: path.join(dir, 'archive'), stlWatchDir: path.join(dir, 'stl'), mock: { jobSeconds: 0.6 }, ...extra });
  const app = new ArchiveApp(config, { mock: true, log: () => {} });
  seedDemo({ store: app.store, config });
  app.start();
  const server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } }); return { status: r.status, body: await r.json() }; };
  return { app, server, base, j, dir, cfgFile, close: () => { app.stop(); server.close(); } };
}

test('mock helper: capture, browse, notes, download, reprint', async () => {
  const h = await startHelper();
  try {
    const st = await h.j('/api/status');
    assert.equal(st.body.app, 'print-archive');
    assert.equal(st.body.mode, 'mock');
    assert.equal(st.body.printer.connected, true);
    assert.equal(st.body.printer.state, 'IDLE');
    assert.equal(st.body.printer.loaded.type, 'PLA');

    const list = (await h.j('/api/prints')).body.prints;
    assert.equal(list.length, 18);
    assert.equal(list[0].name, 'Benchy');                     // newest first
    const labels = new Set(list.map(p => p.label));
    assert.deepEqual([...labels].sort(), ['mesh', 'sliced', 'stl']);
    assert.ok(list.some(p => p.status === 'failed'));

    // Simulate a new job finishing on the printer (MQTT PREPARE -> RUNNING -> FINISH)
    const clip = list.find(p => p.name === 'Cable clip v2');
    const sim = await h.j('/api/mock/simulate', { method: 'POST', body: JSON.stringify({ id: clip.id, name: 'Cable clip v3' }) });
    assert.equal(sim.status, 200);
    const busy = await waitFor(async () => { const s = (await h.j('/api/status')).body; return ['PREPARE', 'RUNNING'].includes(s.printer.state) && s; });
    assert.ok(busy);
    const rb = await h.j(`/api/prints/${encodeURIComponent(clip.id)}/reprint`, { method: 'POST', body: '{}' });
    assert.equal(rb.status, 409, 'reprint must be refused while printing');
    const captured = await waitFor(async () => (await h.j('/api/prints')).body.prints.find(p => p.name === 'Cable clip v3'));
    assert.equal(captured.status, 'finished');
    assert.equal(captured.label, 'stl');          // matched via the 3MF's object name (Cable clip v2.stl)
    assert.equal(captured.stl.name, 'Cable clip v2.stl');
    assert.equal(captured.filamentGrams, 6.2);
    assert.equal(captured.settings.infillPattern, 'gyroid');
    assert.ok(captured.actualSeconds >= 0);
    assert.equal((await h.j('/api/status')).body.helper.lastCapture.name, 'Cable clip v3');

    // Failed job is archived with Failed flag
    await h.j('/api/mock/simulate', { method: 'POST', body: JSON.stringify({ id: clip.id, name: 'Broken latch', fail: true }) });
    const failed = await waitFor(async () => (await h.j('/api/prints')).body.prints.find(p => p.name === 'Broken latch'));
    assert.equal(failed.status, 'failed');

    // Notes persist
    const n = await h.j(`/api/prints/${encodeURIComponent(captured.id)}`, { method: 'PATCH', body: JSON.stringify({ notes: 'Looks great' }) });
    assert.equal(n.body.notes, 'Looks great');
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.app.config.archiveDir, 'index.json'), 'utf8')).prints.find(p => p.id === captured.id).notes, 'Looks great');

    // Downloads
    const f = await fetch(h.base + '/' + captured.fileUrl);
    assert.equal(f.status, 200);
    assert.match(f.headers.get('content-disposition'), /attachment; filename="Cable clip v3.gcode.3mf"/);
    const zip = new AdmZip(Buffer.from(await f.arrayBuffer()));
    assert.ok(zip.getEntry('Metadata/plate_1.gcode'));
    const t = await fetch(h.base + '/' + captured.thumbUrl);
    assert.equal(t.headers.get('content-type'), 'image/png');
    const stlRec = list.find(p => p.label === 'stl');
    assert.equal((await fetch(h.base + '/' + stlRec.stlUrl)).status, 200);
    assert.equal(f.headers.get('access-control-allow-origin'), '*');

    // Reprint: uploads to mock SD and starts the job, which is captured again on finish
    await waitFor(async () => (await h.j('/api/status')).body.printer.state === 'FINISH');
    const rp = await h.j(`/api/prints/${encodeURIComponent(stlRec.id)}/reprint`, { method: 'POST', body: JSON.stringify({ plate: 1 }) });
    assert.equal(rp.status, 200, JSON.stringify(rp.body));
    assert.equal(rp.body.ok, true);
    assert.equal(rp.body.command.param, 'Metadata/plate_1.gcode');
    assert.ok(fs.existsSync(path.join(h.app.config.archiveDir, '.mock-sd', `${stlRec.name}.gcode.3mf`)));
    const again = await waitFor(async () => (await h.j('/api/prints')).body.prints.filter(p => p.name === stlRec.name).length === 2);
    assert.ok(again);

    // Config toggles persist to config.json
    const c = await h.j('/api/config', { method: 'PATCH', body: JSON.stringify({ capture: { archiveFailed: false } }) });
    assert.equal(c.body.status.capture.archiveFailed, false);
    assert.equal(JSON.parse(fs.readFileSync(h.cfgFile, 'utf8')).capture.archiveFailed, false);

    // Static PWA is served by the helper
    const idx = await fetch(h.base + '/');
    assert.match(await idx.text(), /apple-touch-icon/);
    assert.equal((await fetch(h.base + '/sw.js')).status, 200);
    assert.equal((await fetch(h.base + '/../package.json')).status, 404);
  } finally { h.close(); }
});

test('apiToken protects write endpoints', async () => {
  const h = await startHelper({ apiToken: 'secret' });
  try {
    const id = (await h.j('/api/prints')).body.prints[0].id;
    assert.equal((await h.j(`/api/prints/${id}`, { method: 'PATCH', body: '{"notes":"x"}' })).status, 401);
    assert.equal((await h.j(`/api/prints/${id}`, { method: 'PATCH', body: '{"notes":"x"}', headers: { 'X-Archive-Token': 'secret' } })).status, 200);
  } finally { h.close(); }
});
