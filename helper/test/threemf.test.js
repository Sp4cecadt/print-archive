'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse3mf, parseSliceInfo } = require('../src/threemf');
const { buildSample3mf } = require('../src/sample3mf');
const { archiveJob } = require('../src/capture');
const { Store } = require('../src/store');
const { JobTracker, loadedFilament } = require('../src/tracker');
const { findStl } = require('../src/stl');
const { loadConfig } = require('../src/config');
const { filamentLabel, modelFromSerial } = require('../src/util');

const THUMB = fs.readFileSync(path.join(__dirname, '..', 'sample-assets', 'thumbs', 'clip.png'));
const sample = (o = {}) => buildSample3mf({
  name: 'Cable clip v2', includeMesh: true, thumbnail: THUMB, predictionSeconds: 1440,
  filaments: [{ type: 'PETG', color: '#00AE42', grams: 6.2, meters: 2.08, settingsId: 'Bambu PETG HF @BBL X1C' }],
  infill: '15%', pattern: 'gyroid', outerWallSpeed: 150, nozzleTemp: 220, bedTemp: 70, ...o,
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-test-'));

test('parses thumbnail, filament, time and settings from a sliced 3MF', () => {
  const r = parse3mf(sample());
  assert.equal(r.sliced, true);
  assert.deepEqual(r.gcodePlates, [1]);
  assert.equal(r.thumbnailEntry, 'Metadata/plate_1.png');
  assert.ok(r.thumbnail.equals(THUMB));
  assert.equal(r.predictionSeconds, 1440);
  assert.equal(r.filamentGrams, 6.2);
  assert.equal(r.filamentMeters, 2.08);
  assert.equal(r.filaments[0].type, 'PETG');
  assert.equal(r.settings.layerHeight, 0.2);
  assert.equal(r.settings.infillDensity, '15%');
  assert.equal(r.settings.infillPattern, 'gyroid');
  assert.equal(r.settings.supports, 'none');
  assert.equal(r.settings.speeds.outerWall, 150);
  assert.equal(r.settings.nozzleTemp, 220);
  assert.equal(r.settings.bedTemp, 70);
  assert.deepEqual(r.objects, ['Cable clip v2.stl']);
});

test('detects mesh geometry vs sliced-only 3MF', () => {
  assert.equal(parse3mf(sample({ includeMesh: true })).hasMesh, true);
  assert.equal(parse3mf(sample({ includeMesh: false })).hasMesh, false);
});

test('supports on, multi-filament totals and plate selection', () => {
  const buf = sample({ supports: 'tree(auto)', plate: 2, filaments: [
    { type: 'PLA', color: '#161616', grams: 10, meters: 3.3 }, { type: 'PLA', color: '#F5F5F5', grams: 2.5, meters: 0.8 }] });
  const r = parse3mf(buf);
  assert.equal(r.plate, 2);
  assert.equal(r.thumbnailEntry, 'Metadata/plate_2.png');
  assert.equal(r.settings.supports, 'tree(auto)');
  assert.equal(r.filaments.length, 2);
  assert.equal(r.filamentGrams, 12.5);
  assert.equal(r.filamentMeters, 4.1);
});

test('tolerates a 3MF without Bambu metadata (plain project file)', () => {
  const z = new AdmZip();
  z.addFile('3D/3dmodel.model', Buffer.from('<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object></resources></model>'));
  const r = parse3mf(z.toBuffer());
  assert.equal(r.sliced, false);
  assert.equal(r.hasMesh, true);
  assert.equal(r.settings, null);
  assert.equal(r.thumbnail, null);
  assert.equal(r.filamentGrams, undefined);
});

test('parseSliceInfo reads multiple plates', () => {
  const xml = '<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="60"/><filament id="1" type="PLA" color="#FF0000" used_m="1" used_g="3"/></plate><plate><metadata key="index" value="2"/><metadata key="prediction" value="120"/></plate></config>';
  const p = parseSliceInfo(xml);
  assert.equal(p.length, 2);
  assert.equal(p[1].predictionSeconds, 120);
  assert.equal(p[0].filaments[0].grams, 3);
});

test('archiveJob stores file, thumbnail, labels and links a matching STL', () => {
  const dir = tmp();
  const stlDir = path.join(dir, 'models', 'clips'); fs.mkdirSync(stlDir, { recursive: true });
  fs.writeFileSync(path.join(stlDir, 'Cable_Clip v2.STL'), 'solid x\nendsolid x\n');
  const config = loadConfig(null, { archiveDir: path.join(dir, 'archive'), stlWatchDir: path.join(dir, 'models') });
  const store = new Store(config.archiveDir);
  const now = Date.now();
  const rec = archiveJob({ store, config, buffer: sample(), job: { name: 'Cable clip v2', fileName: 'Cable clip v2.gcode.3mf', startedAt: now - 22 * 60000, finishedAt: now, status: 'finished', jobKey: 'k1' } });
  assert.equal(rec.label, 'stl');
  assert.equal(rec.stl.name, 'Cable_Clip v2.STL');
  assert.equal(rec.actualSeconds, 1320);
  assert.equal(rec.filamentLabel, 'PETG HF Green');
  assert.equal(rec.filamentShort, 'PETG Green');
  assert.ok(fs.existsSync(store.pathFor(rec, 'file')));
  assert.ok(fs.existsSync(store.pathFor(rec, 'thumb')));
  assert.ok(fs.existsSync(store.pathFor(rec, 'stl')));
  assert.ok(store.hasJobKey('k1'));
  // index survives reload
  assert.equal(new Store(config.archiveDir).all().length, 1);

  const sliced = archiveJob({ store, config, buffer: sample({ includeMesh: false, name: 'Other' }), job: { name: 'Other', status: 'failed', finishedAt: now } });
  assert.equal(sliced.label, 'sliced');
  assert.equal(sliced.status, 'failed');
  const nofile = archiveJob({ store, config, buffer: null, job: { name: 'Lost', finishedAt: now, copyError: 'FTPS timeout' } });
  assert.equal(nofile.fileUrl, undefined);
  assert.equal(nofile.copyError, 'FTPS timeout');
});

test('findStl ignores non-matching names', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'bracket.stl'), 'x');
  assert.equal(findStl(dir, ['Cable clip v2']), null);
});

test('JobTracker emits jobEnd on RUNNING -> FINISH and FAILED, merges P1-style deltas', () => {
  const t = new JobTracker();
  const ends = [];
  t.on('jobEnd', j => ends.push(j));
  t.handle({ print: { gcode_state: 'IDLE' } });
  t.handle({ print: { gcode_state: 'PREPARE', subtask_name: 'Benchy', gcode_file: 'Benchy.gcode.3mf', gcode_start_time: '1763000000', task_id: '7' } });
  t.handle({ print: { mc_percent: 50 } }); // delta with no state
  t.handle({ print: { gcode_state: 'RUNNING', mc_percent: 90 } });
  t.handle({ print: { gcode_state: 'FINISH', nozzle_temper: 200 } });
  t.handle({ print: { gcode_state: 'FINISH' } }); // repeat must not double-capture
  assert.equal(ends.length, 1);
  assert.equal(ends[0].name, 'Benchy');
  assert.equal(ends[0].status, 'finished');
  assert.equal(ends[0].startedAt, 1763000000 * 1000);
  t.handle({ print: { gcode_state: 'RUNNING', subtask_name: 'Latch', gcode_start_time: '1763001000' } });
  t.handle({ print: { gcode_state: 'FAILED', print_error: 50348044 } });
  assert.equal(ends.length, 2);
  assert.equal(ends[1].status, 'failed');
});

test('JobTracker late-captures a job that finished before the helper started, unless archived', () => {
  const t = new JobTracker({ isArchived: k => k === 'archived|Old|1' });
  const ends = []; t.on('jobEnd', j => ends.push(j));
  t.handle({ print: { gcode_state: 'FINISH', subtask_name: 'New', gcode_start_time: '2', task_id: 'x' } });
  assert.equal(ends.length, 1);
  const t2 = new JobTracker({ isArchived: k => k === 'archived|Old|1' });
  t2.on('jobEnd', j => ends.push(j));
  t2.handle({ print: { gcode_state: 'FINISH', subtask_name: 'Old', gcode_start_time: '1', task_id: 'archived' } });
  assert.equal(ends.length, 1);
});

test('loadedFilament reads AMS tray_now and external spool', () => {
  assert.deepEqual(loadedFilament({ ams: { tray_now: '5', ams: [{ id: '1', tray: [{ id: '1', tray_type: 'PETG', tray_color: '00AE42FF', tray_sub_brands: 'PETG HF' }] }] } }),
    { type: 'PETG', color: '#00AE42', name: 'PETG HF', source: 'AMS 2 slot 2' });
  assert.equal(loadedFilament({ ams: { tray_now: '254' }, vt_tray: { tray_type: 'PLA', tray_color: '161616FF' } }).source, 'External spool');
});

test('util helpers', () => {
  assert.equal(filamentLabel({ type: 'PLA', color: '#F5F5F5' }, 'Bambu PLA Basic @BBL X1C'), 'PLA Basic White');
  assert.equal(modelFromSerial('00M09A123456789'), 'X1C');
  assert.equal(modelFromSerial('01P00C123456789'), 'P1S');
});
