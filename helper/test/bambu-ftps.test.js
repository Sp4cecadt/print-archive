'use strict';
// Exercises the real BambuPrinter FTPS code (implicit TLS, user bblp) against a local FTPS server imitating the printer's storage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');
const { FtpSrv } = require('ftp-srv');
const { BambuPrinter } = require('../src/bambu');
const { buildSample3mf } = require('../src/sample3mf');

test('BambuPrinter FTPS: finds and downloads the job 3MF, uploads for reprint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-sd-'));
  fs.mkdirSync(path.join(root, 'cache'));
  const buf = buildSample3mf({ name: 'Benchy', includeMesh: false });
  fs.writeFileSync(path.join(root, 'cache', 'Benchy.gcode.3mf'), buf);
  const pems = selfsigned.generate([{ name: 'commonName', value: 'printer' }], { days: 1, keySize: 2048 });
  const port = 21000 + Math.floor(Math.random() * 2000);
  const srv = new FtpSrv({ url: `ftps://127.0.0.1:${port}`, pasv_url: '127.0.0.1', pasv_min: port + 1, pasv_max: port + 50, tls: { key: pems.private, cert: pems.cert }, anonymous: false, log: { info() {}, debug() {}, trace() {}, warn() {}, error() {}, child() { return this; } } });
  srv.on('login', ({ username, password }, resolve, reject) => (username === 'bblp' && password === '12345678' ? resolve({ root }) : reject(new Error('bad login'))));
  await srv.listen();
  const printer = new BambuPrinter({ ip: '127.0.0.1', serial: 'S', accessCode: '12345678', ftpsPort: port }, () => {});
  try {
    const got = await printer.fetchJobFile({ name: 'Benchy', gcodeFile: '/data/Metadata/plate_1.gcode' });
    assert.equal(got.remotePath, '/cache/Benchy.gcode.3mf');
    assert.ok(got.buffer.equals(buf));
    const remote = await printer.uploadFile(buf, 'Reprint.gcode.3mf', '/');
    assert.equal(remote, '/Reprint.gcode.3mf');
    assert.ok(fs.readFileSync(path.join(root, 'Reprint.gcode.3mf')).equals(buf));
    await assert.rejects(printer.fetchJobFile({ name: 'Missing' }), /No 3MF found/);
  } finally { await srv.close(); }
});
