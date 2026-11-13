'use strict';
// Real Bambu Lab printer in LAN mode: MQTT over TLS (8883) + implicit FTPS (990). No cloud.
const EventEmitter = require('events');
const { Readable, Writable } = require('stream');
const mqtt = require('mqtt');
const ftp = require('basic-ftp');

const USER = 'bblp';

class BambuPrinter extends EventEmitter {
  constructor(cfg, log = console.log) {
    super();
    this.cfg = cfg; // { ip, serial, accessCode, name }
    this.log = log;
    this.client = null;
    this.connected = false;
    this.firmware = null;
    this.seq = 1;
    this.lastMessageAt = null;
  }
  get reportTopic() { return `device/${this.cfg.serial}/report`; }
  get requestTopic() { return `device/${this.cfg.serial}/request`; }

  start() {
    const { ip, accessCode, serial } = this.cfg;
    if (!ip || !accessCode || !serial) { this.log('Printer not configured (ip/serial/accessCode); live capture disabled.'); return; }
    this.client = mqtt.connect(`mqtts://${ip}:${this.cfg.mqttPort || 8883}`, {
      username: USER, password: accessCode,
      clientId: `print-archive-${Math.random().toString(16).slice(2, 10)}`,
      rejectUnauthorized: false,       // printer uses a self-signed certificate
      reconnectPeriod: 5000, connectTimeout: 10000, keepalive: 30, protocolVersion: 4,
    });
    this.client.on('connect', () => {
      this.connected = true; this.emit('connection', true);
      this.log(`MQTT connected to ${ip}`);
      this.client.subscribe(this.reportTopic, err => {
        if (err) this.log(`Subscribe failed: ${err.message}`);
        this.pushall(); this.getVersion();
      });
    });
    this.client.on('message', (topic, payload) => {
      let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
      this.lastMessageAt = Date.now();
      if (msg.info && msg.info.command === 'get_version' && Array.isArray(msg.info.module)) {
        const ota = msg.info.module.find(m => m.name === 'ota');
        if (ota) this.firmware = ota.sw_ver;
      }
      this.emit('report', msg);
    });
    this.client.on('close', () => { if (this.connected) { this.connected = false; this.emit('connection', false); } });
    this.client.on('error', e => this.log(`MQTT error: ${e.message}`));
    // P1/A1 printers only send deltas; a periodic pushall keeps state complete. Not too often (P1 guidance).
    this.pushTimer = setInterval(() => this.pushall(), 10 * 60 * 1000);
  }
  stop() { clearInterval(this.pushTimer); if (this.client) this.client.end(true); }

  publish(obj) {
    if (!this.client || !this.connected) throw new Error('Printer not connected');
    this.client.publish(this.requestTopic, JSON.stringify(obj));
  }
  pushall() { try { this.publish({ pushing: { sequence_id: String(this.seq++), command: 'pushall', version: 1, push_target: 1 } }); } catch {} }
  getVersion() { try { this.publish({ info: { sequence_id: String(this.seq++), command: 'get_version' } }); } catch {} }

  async ftp(fn) {
    const c = new ftp.Client(30000);
    try {
      await c.access({ host: this.cfg.ip, port: this.cfg.ftpsPort || 990, user: USER, password: this.cfg.accessCode, secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
      return await fn(c);
    } finally { c.close(); }
  }

  // Locate and copy the sliced 3MF for a job off the printer's storage.
  async fetchJobFile(job) {
    return this.ftp(async c => {
      const name = job.name;
      const cands = [];
      const gf = String(job.gcodeFile || '').replace(/^(file:\/\/)?(\/mnt)?\/sdcard/, '').replace(/^ftp:\/\//, '');
      if (/\.3mf$/i.test(gf)) cands.push(gf.startsWith('/') ? gf : '/' + gf);
      for (const dir of ['/', '/cache/', '/model/']) for (const ext of ['.gcode.3mf', '.3mf']) cands.push(`${dir}${name}${ext}`);
      for (const p of cands) {
        try {
          const size = await c.size(p);
          const mtime = await c.lastMod(p).catch(() => null);
          const buffer = await download(c, p);
          return { buffer, remotePath: p, fileName: p.replace(/^.*\//, ''), size, mtime };
        } catch { /* try next */ }
      }
      // Fallback: newest .3mf in the usual folders whose name starts with the job name.
      let best = null;
      for (const dir of ['/', '/cache', '/model']) {
        let list = []; try { list = await c.list(dir); } catch { continue; }
        for (const f of list) {
          if (!f.isFile || !/\.3mf$/i.test(f.name)) continue;
          if (!f.name.toLowerCase().startsWith(String(name).toLowerCase())) continue;
          const t = f.modifiedAt ? f.modifiedAt.getTime() : 0;
          if (!best || t > best.t) best = { p: `${dir === '/' ? '' : dir}/${f.name}`, t, size: f.size };
        }
      }
      if (!best) throw new Error(`No 3MF found on printer for "${name}" (tried ${cands.join(', ')})`);
      const buffer = await download(c, best.p);
      return { buffer, remotePath: best.p, fileName: best.p.replace(/^.*\//, ''), size: best.size, mtime: best.t || null };
    });
  }

  async uploadFile(buffer, remoteName, remoteDir = '/') {
    const dir = remoteDir.endsWith('/') ? remoteDir : remoteDir + '/';
    const remotePath = dir + remoteName;
    await this.ftp(c => c.uploadFrom(Readable.from(buffer), remotePath));
    return remotePath;
  }

  // MQTT "project_file" command: print a 3MF already on the printer's storage.
  startPrint({ remoteName, remotePath, plate = 1, subtaskName, useAms = false, amsMapping = [0], md5 = '', opts = {} }) {
    const url = (opts.urlTemplate || 'ftp:///{file}').replace('{file}', encodeURI(remoteName)).replace('{path}', encodeURI(remotePath || '/' + remoteName));
    const cmd = {
      print: {
        sequence_id: String(this.seq++), command: 'project_file',
        param: `Metadata/plate_${plate}.gcode`,
        project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0',
        subtask_name: subtaskName || remoteName.replace(/\.gcode\.3mf$|\.3mf$/i, ''),
        url, md5,
        timelapse: !!opts.timelapse, bed_type: opts.bedType || 'auto', bed_levelling: opts.bedLevelling !== false,
        flow_cali: !!opts.flowCali, vibration_cali: !!opts.vibrationCali, layer_inspect: false,
        use_ams: !!useAms, ams_mapping: amsMapping,
      },
    };
    this.publish(cmd);
    return cmd.print;
  }

  async testConnection() {
    const out = { mqtt: this.connected, ftps: false, firmware: this.firmware, error: null };
    if (!this.cfg.ip || !this.cfg.accessCode || !this.cfg.serial) { out.error = 'Printer IP, serial and LAN access code are required'; return out; }
    try { await this.ftp(async c => { await c.list('/'); }); out.ftps = true; } catch (e) { out.error = `FTPS: ${e.message}`; }
    if (!this.connected) out.error = (out.error ? out.error + '; ' : '') + 'MQTT: not connected (check LAN mode, IP and access code)';
    return out;
  }
}

async function download(client, p) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _e, cb) { chunks.push(chunk); cb(); } });
  await client.downloadTo(sink, p);
  return Buffer.concat(chunks);
}

module.exports = { BambuPrinter };
