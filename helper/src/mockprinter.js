'use strict';
// Simulated printer for demo/mock mode: same interface as BambuPrinter, emits Bambu-shaped MQTT reports.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class MockPrinter extends EventEmitter {
  constructor({ sdDir, jobSeconds = 12, serial = '00M00A000000000', loaded } = {}, log = console.log) {
    super();
    this.sdDir = sdDir; fs.mkdirSync(sdDir, { recursive: true });
    this.jobSeconds = jobSeconds;
    this.log = log;
    this.connected = false;
    this.firmware = '01.09.00.00 (mock)';
    this.cfg = { ip: '127.0.0.1', serial, name: 'Mock X1C' };
    this.loaded = loaded || { tray_type: 'PLA', tray_color: '161616FF', tray_sub_brands: 'PLA Basic' };
    this.timers = [];
    this.lastStart = null;
  }
  start() {
    this.connected = true;
    setImmediate(() => {
      this.emit('connection', true);
      this.report({ gcode_state: 'IDLE', mc_percent: 0, nozzle_temper: 26, bed_temper: 24, vt_tray: { id: '254', ...this.loaded }, ams: { tray_now: '254', ams: [] } });
    });
  }
  stop() { this.timers.forEach(clearTimeout); this.connected = false; }
  report(print) { this.emit('report', { print: { command: 'push_status', ...print } }); }

  async fetchJobFile(job) {
    const name = [`${job.name}.gcode.3mf`, `${job.name}.3mf`].find(n => fs.existsSync(path.join(this.sdDir, n)));
    if (!name) throw new Error(`No 3MF found on mock SD card for "${job.name}"`);
    const p = path.join(this.sdDir, name);
    return { buffer: fs.readFileSync(p), remotePath: '/' + name, fileName: name, size: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs };
  }
  async uploadFile(buffer, remoteName) { fs.writeFileSync(path.join(this.sdDir, remoteName), buffer); return '/' + remoteName; }

  // Simulates PREPARE -> RUNNING (progress) -> FINISH/FAILED.
  startPrint({ remoteName, plate = 1, subtaskName, fail = false }) {
    const name = subtaskName || remoteName.replace(/\.gcode\.3mf$|\.3mf$/i, '');
    const start = Math.floor(Date.now() / 1000);
    const taskId = String(Date.now());
    this.lastStart = { name, plate, remoteName };
    const base = { subtask_name: name, gcode_file: remoteName, task_id: taskId, gcode_start_time: String(start), total_layer_num: 50 };
    const T = this.jobSeconds * 1000;
    const at = (ms, p) => this.timers.push(setTimeout(() => this.report(p), ms));
    at(10, { ...base, gcode_state: 'PREPARE', mc_percent: 0, nozzle_temper: 150, bed_temper: 50 });
    for (let i = 1; i <= 4; i++) at((T * i) / 5, { gcode_state: 'RUNNING', mc_percent: i * 20, layer_num: i * 10, mc_remaining_time: Math.round((T * (5 - i)) / 5 / 60000), nozzle_temper: 220, bed_temper: 55 });
    at(T, fail ? { gcode_state: 'FAILED', print_error: 50348044, mc_percent: 60 } : { gcode_state: 'FINISH', mc_percent: 100, layer_num: 50, nozzle_temper: 180, bed_temper: 52 });
    at(T + 1500, { gcode_state: 'FINISH', nozzle_temper: 60, bed_temper: 40 });
    return { url: `ftp:///${remoteName}`, param: `Metadata/plate_${plate}.gcode`, mock: true };
  }
  async testConnection() { return { mqtt: true, ftps: true, firmware: this.firmware, error: null, mock: true }; }
}
module.exports = { MockPrinter };
