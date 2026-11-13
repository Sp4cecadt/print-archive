'use strict';
// Exercises the real BambuPrinter MQTT client against a local TLS broker that imitates a printer in LAN mode.
const test = require('node:test');
const assert = require('node:assert');
const tls = require('tls');
const selfsigned = require('selfsigned');
const { BambuPrinter } = require('../src/bambu');
const { JobTracker } = require('../src/tracker');

test('BambuPrinter: TLS login as bblp, subscribes, pushall, tracks a job, sends project_file', async () => {
  const aedes = require('aedes')({
    authenticate: (client, user, pass, cb) => cb(null, user === 'bblp' && String(pass) === '12345678'),
  });
  const pems = selfsigned.generate([{ name: 'commonName', value: '00M00A000000000' }], { days: 1, keySize: 2048 });
  const server = tls.createServer({ key: pems.private, cert: pems.cert }, aedes.handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const requests = [];
  aedes.on('publish', (packet, client) => { if (client && packet.topic === 'device/00M00A000000000/request') requests.push(JSON.parse(packet.payload.toString())); });
  const subscribed = new Promise(r => aedes.on('subscribe', subs => { if (subs.some(s => s.topic === 'device/00M00A000000000/report')) r(); }));

  const printer = new BambuPrinter({ ip: '127.0.0.1', serial: '00M00A000000000', accessCode: '12345678', mqttPort: port }, () => {});
  const tracker = new JobTracker();
  printer.on('report', m => tracker.handle(m));
  const ends = []; tracker.on('jobEnd', j => ends.push(j));
  try {
    printer.start();
    await subscribed;
    await new Promise(r => setTimeout(r, 200));
    assert.ok(printer.connected);
    assert.ok(requests.some(r => r.pushing && r.pushing.command === 'pushall'), 'pushall sent');
    assert.ok(requests.some(r => r.info && r.info.command === 'get_version'), 'get_version sent');
    const pub = obj => new Promise(r => aedes.publish({ topic: 'device/00M00A000000000/report', payload: Buffer.from(JSON.stringify(obj)), qos: 0, retain: false }, r));
    await pub({ info: { command: 'get_version', module: [{ name: 'ota', sw_ver: '01.09.00.00' }] } });
    await pub({ print: { gcode_state: 'RUNNING', subtask_name: 'Benchy', gcode_file: 'Benchy.gcode.3mf', gcode_start_time: '1763000000' } });
    await pub({ print: { gcode_state: 'FINISH' } });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(printer.firmware, '01.09.00.00');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].name, 'Benchy');
    const cmd = printer.startPrint({ remoteName: 'Benchy.gcode.3mf', plate: 1, subtaskName: 'Benchy', opts: { urlTemplate: 'ftp:///{file}' } });
    await new Promise(r => setTimeout(r, 200));
    const sent = requests.find(r => r.print && r.print.command === 'project_file');
    assert.ok(sent, 'project_file published');
    assert.equal(sent.print.url, 'ftp:///Benchy.gcode.3mf');
    assert.equal(sent.print.param, 'Metadata/plate_1.gcode');
    assert.equal(sent.print.use_ams, false);
    assert.equal(cmd.subtask_name, 'Benchy');
  } finally {
    printer.stop(); server.close(); aedes.close();
  }
});

test('BambuPrinter rejects a wrong access code (no connection)', async () => {
  const aedes = require('aedes')({ authenticate: (c, u, p, cb) => cb(null, false) });
  const pems = selfsigned.generate([{ name: 'commonName', value: 'x' }], { days: 1, keySize: 2048 });
  const server = tls.createServer({ key: pems.private, cert: pems.cert }, aedes.handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const printer = new BambuPrinter({ ip: '127.0.0.1', serial: 'S', accessCode: 'wrong', mqttPort: server.address().port }, () => {});
  try { printer.start(); await new Promise(r => setTimeout(r, 600)); assert.equal(printer.connected, false); }
  finally { printer.stop(); server.close(); aedes.close(); }
});
