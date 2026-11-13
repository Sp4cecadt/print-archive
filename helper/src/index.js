#!/usr/bin/env node
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig } = require('./config');
const { ArchiveApp } = require('./app');
const { createServer } = require('./server');
const { seedDemo } = require('./demo');

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const mock = process.argv.includes('--mock');
const cfgFile = arg('--config') || process.env.PRINT_ARCHIVE_CONFIG || path.join(__dirname, '..', 'config.json');
const overrides = {};
if (arg('--port')) overrides.port = parseInt(arg('--port'), 10);
if (arg('--archive')) overrides.archiveDir = arg('--archive');
if (mock && !arg('--archive')) overrides.archiveDir = path.join(os.tmpdir(), 'print-archive-mock');
if (mock) { overrides.helperName = overrides.helperName || 'Mock helper'; overrides.stlWatchDir = path.join(overrides.archiveDir || os.tmpdir(), '..', 'print-archive-mock-stl'); }

const config = loadConfig(fs.existsSync(cfgFile) ? cfgFile : null, overrides);
if (mock) config.helperName = loadConfig(null).helperName + ' (mock)';
const app = new ArchiveApp(config, { mock });
if (mock && app.store.data.prints.length === 0) { seedDemo({ store: app.store, config }); app.log(`Mock: seeded ${app.store.data.prints.length} demo prints in ${config.archiveDir}`); }
app.start();
const server = createServer(app);
server.listen(config.port, config.host, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  app.log(`Print Archive helper ${mock ? '(MOCK MODE) ' : ''}listening on port ${config.port}`);
  app.log(`Open on your iPhone (same Wi-Fi): http://${os.hostname().replace(/\.local$/, '')}.local:${config.port}/ ${lan.map(a => `or http://${a}:${config.port}/`).join(' ')}`);
  app.log(`Archive folder: ${config.archiveDir}`);
});
const shutdown = () => { app.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
