'use strict';
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { Store } = require('./store');
const { JobTracker, loadedFilament, amsTrays, ACTIVE } = require('./tracker');
const { archiveJob } = require('./capture');
const { BambuPrinter } = require('./bambu');
const { MockPrinter } = require('./mockprinter');
const { modelFromSerial, normHex } = require('./util');
const { parse3mf } = require('./threemf');
const VERSION = require('../package.json').version;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class ArchiveApp extends EventEmitter {
  constructor(config, { mock = false, log = (...a) => console.log(new Date().toISOString(), ...a) } = {}) {
    super();
    this.config = config; this.mock = mock; this.log = log;
    this.startedAt = new Date().toISOString();
    this.store = new Store(config.archiveDir);
    this.printer = mock
      ? new MockPrinter({ sdDir: path.join(config.archiveDir, '.mock-sd'), jobSeconds: config.mock.jobSeconds }, log)
      : new BambuPrinter(config.printer, log);
    this.tracker = new JobTracker({ isArchived: k => this.store.hasJobKey(k), captureOnStartIfFinished: config.capture.captureOnStartIfFinished });
    this.printer.on('report', m => this.tracker.handle(m));
    // After a reconnect (e.g. the Mac woke from sleep) treat the next report like a first one, so a job that
    // finished while we were away is still captured (deduped by job key).
    this.printer.on('connection', up => { if (up) this.tracker.seenFirst = false; this.log(`Printer ${up ? 'connected' : 'disconnected'}`); });
    this.tracker.on('jobStart', j => this.log(`Job started: ${j.name}`));
    this.tracker.on('jobEnd', j => this.onJobEnd(j).catch(e => this.log(`Capture error: ${e.stack || e}`)));
    this.captures = Promise.resolve();
    this.lastError = null;
  }
  start() { this.printer.start(); }
  stop() { this.printer.stop(); }

  async onJobEnd(job) {
    const c = this.config.capture;
    if (!c.autoArchive) { this.log(`Auto-archive off; skipping "${job.name}"`); return; }
    if (job.status === 'failed' && !c.archiveFailed) { this.log(`Skipping failed job "${job.name}"`); return; }
    if (this.store.hasJobKey(job.jobKey)) return;
    const run = async () => {
      let got = null, copyError = null;
      for (let attempt = 1; attempt <= 3 && !got; attempt++) {
        try { got = await this.printer.fetchJobFile(job); } catch (e) { copyError = e.message; this.log(`Copy attempt ${attempt} failed: ${e.message}`); if (attempt < 3) await sleep(this.mock ? 50 : 5000); }
      }
      const rec = archiveJob({
        store: this.store, config: this.config, log: this.log, buffer: got ? got.buffer : null,
        job: {
          ...job, fileName: got ? got.fileName : undefined, remotePath: got ? got.remotePath : undefined, remoteMtime: got ? got.mtime : undefined,
          copyError: got ? null : copyError,
          printer: { serial: this.printer.cfg.serial, model: this.printerModel(), name: this.printerName() },
        },
      });
      this.emit('captured', rec);
      return rec;
    };
    this.captures = this.captures.then(run, run);
    return this.captures;
  }

  printerModel() { return modelFromSerial(this.printer.cfg.serial) || (this.mock ? 'X1C' : ''); }
  printerName() { return this.config.printer.name || this.printerModel() || 'Printer'; }

  status() {
    const s = this.tracker.state;
    const last = this.store.last();
    const p = this.printer;
    const configured = this.mock || !!(this.config.printer.ip && this.config.printer.serial && this.config.printer.accessCode);
    return {
      app: 'print-archive', version: VERSION, mode: this.mock ? 'mock' : 'live',
      helper: {
        name: this.config.helperName, online: true, startedAt: this.startedAt,
        lastCapture: last ? { id: last.id, name: last.name, at: last.archivedAt } : null,
        archiveDir: this.config.archiveDir, stlWatchDir: this.config.stlWatchDir || null,
        tokenRequired: !!this.config.apiToken,
      },
      printer: {
        configured, connected: !!p.connected, name: this.printerName(), model: this.printerModel(),
        ip: p.cfg.ip || null, serial: p.cfg.serial || null, accessCodeSet: this.mock || !!this.config.printer.accessCode,
        firmware: p.firmware || null, state: s.gcode_state || (p.connected ? 'UNKNOWN' : 'OFFLINE'),
        percent: s.mc_percent ?? null, remainingMin: s.mc_remaining_time ?? null,
        job: this.tracker.current ? { name: this.tracker.current.name } : null,
        loaded: loadedFilament(s), ams: amsTrays(s),
        nozzleTemp: s.nozzle_temper ?? null, bedTemp: s.bed_temper ?? null,
      },
      capture: this.config.capture,
      count: this.store.data.prints.length,
    };
  }

  // Re-send an archived 3MF to the printer over LAN, then start it with the MQTT project_file command.
  async reprint(id, { plate, useAms } = {}) {
    const rec = this.store.get(id);
    if (!rec) throw httpError(404, 'Print not found');
    const file = this.store.pathFor(rec, 'file');
    if (!file) throw httpError(409, 'No 3MF archived for this print');
    if (!this.printer.connected) throw httpError(503, 'Printer not connected');
    const st = this.tracker.state.gcode_state;
    if (ACTIVE.has(st)) throw httpError(409, `Printer is busy (${st})`);
    const buf = fs.readFileSync(file);
    const meta = parse3mf(buf);
    const pl = plate || rec.plate || meta.plate || 1;
    if (!meta.gcodePlates.includes(pl)) throw httpError(422, `3MF has no sliced G-code for plate ${pl}; reslice in Bambu Studio first`);
    const remoteName = safeRemoteName(rec.fileName || `${rec.name}.gcode.3mf`);
    const remotePath = await this.printer.uploadFile(buf, remoteName, this.config.reprint.remoteDir);
    let amsMapping = [0], ams = false;
    if (useAms) {
      const trays = amsTrays(this.tracker.state);
      amsMapping = (rec.filaments || []).map(f => {
        const t = trays.find(t => t.type === f.type && normHex(t.color) === normHex(f.color)) || trays.find(t => t.type === f.type);
        return t ? t.index : -1;
      });
      ams = amsMapping.length > 0 && amsMapping.every(i => i >= 0);
      if (!ams) amsMapping = [0];
    }
    const md5Entry = meta.entries.includes(`Metadata/plate_${pl}.gcode.md5`) ? new (require('adm-zip'))(buf).getEntry(`Metadata/plate_${pl}.gcode.md5`).getData().toString().trim() : '';
    const sent = this.printer.startPrint({ remoteName, remotePath, plate: pl, subtaskName: rec.name, useAms: ams, amsMapping, md5: md5Entry, opts: this.config.reprint });
    this.log(`Reprint sent: ${rec.name} (plate ${pl}, use_ams=${ams})`);
    return { ok: true, remotePath, plate: pl, useAms: ams, amsMapping, command: { url: sent.url, param: sent.param } };
  }
}

function safeRemoteName(n) { return String(n).replace(/^.*[\\/]/, '').replace(/[^\w .()+-]/g, '_'); }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { ArchiveApp, httpError };
