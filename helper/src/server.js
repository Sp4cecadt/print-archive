'use strict';
// REST API + static PWA, LAN-only. No external services.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { saveConfig } = require('./config');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.3mf': 'model/3mf', '.stl': 'model/stl' };

function publicRecord(r) {
  const { relDir, files, jobKey, remotePath, ...rest } = r;
  const id = encodeURIComponent(r.id);
  return {
    ...rest,
    thumbUrl: files && files.thumb ? `api/prints/${id}/thumb` : null,
    fileUrl: files && files.file ? `api/prints/${id}/file` : null,
    stlUrl: files && files.stl ? `api/prints/${id}/stl` : null,
    archivePath: relDir,
  };
}

function createServer(app) {
  const cfg = app.config;
  const send = (res, status, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json', ...headers });
    res.end(isBuf ? body : JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  });
  const authOk = req => !cfg.apiToken || req.headers['x-archive-token'] === cfg.apiToken;
  const sendFile = (res, file, name, { download = false, cache = 'no-cache' } = {}) => {
    const st = fs.statSync(file);
    const h = { 'Content-Type': MIME[path.extname(name || file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache };
    if (download) h['Content-Disposition'] = `attachment; filename="${String(name).replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    res.writeHead(200, h); fs.createReadStream(file).pipe(res);
  };

  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Archive-Token');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    try {
      if (p.startsWith('/api/')) {
        const write = req.method !== 'GET';
        if (write && !authOk(req)) return send(res, 401, { error: 'Helper token required' });
        let m;
        if (p === '/api/status' && req.method === 'GET') return send(res, 200, app.status());
        if (p === '/api/prints' && req.method === 'GET') return send(res, 200, { prints: app.store.all().map(publicRecord) });
        if ((m = /^\/api\/prints\/([^/]+)$/.exec(p))) {
          const rec = app.store.get(m[1]); if (!rec) return send(res, 404, { error: 'Not found' });
          if (req.method === 'GET') return send(res, 200, publicRecord(rec));
          if (req.method === 'PATCH') {
            const b = await readBody(req);
            const patch = {};
            if (typeof b.notes === 'string') patch.notes = b.notes.slice(0, 10000);
            return send(res, 200, publicRecord(app.store.update(rec.id, patch)));
          }
        }
        if ((m = /^\/api\/prints\/([^/]+)\/(thumb|file|stl)$/.exec(p)) && req.method === 'GET') {
          const rec = app.store.get(m[1]); if (!rec) return send(res, 404, { error: 'Not found' });
          const file = app.store.pathFor(rec, m[2]); if (!file) return send(res, 404, { error: `No ${m[2]} archived` });
          if (m[2] === 'thumb') return sendFile(res, file, 'thumb.png', { cache: 'max-age=86400' });
          if (m[2] === 'file') return sendFile(res, file, rec.fileName || `${rec.name}.3mf`, { download: true });
          return sendFile(res, file, (rec.stl && rec.stl.name) || `${rec.name}.stl`, { download: true });
        }
        if ((m = /^\/api\/prints\/([^/]+)\/reprint$/.exec(p)) && req.method === 'POST') {
          const b = await readBody(req);
          return send(res, 200, await app.reprint(m[1], { plate: b.plate, useAms: b.useAms }));
        }
        if (p === '/api/printer/test' && req.method === 'POST') return send(res, 200, await app.printer.testConnection());
        if (p === '/api/config' && req.method === 'PATCH') {
          const b = await readBody(req);
          if (b.capture && typeof b.capture === 'object') for (const k of ['autoArchive', 'archiveFailed', 'keepThumbnails']) if (typeof b.capture[k] === 'boolean') cfg.capture[k] = b.capture[k];
          let restart = false;
          if (b.printer && typeof b.printer === 'object') for (const k of ['ip', 'serial', 'accessCode', 'name']) if (typeof b.printer[k] === 'string') { cfg.printer[k] = b.printer[k].trim(); restart = restart || k !== 'name'; }
          if (typeof b.helperName === 'string' && b.helperName.trim()) cfg.helperName = b.helperName.trim();
          const saved = saveConfig(cfg);
          if (restart && !app.mock) { app.printer.stop(); app.printer.cfg = cfg.printer; app.printer.start(); }
          return send(res, 200, { ok: true, saved, status: app.status() });
        }
        if (p === '/api/mock/simulate' && req.method === 'POST' && app.mock) {
          const b = await readBody(req);
          const rec = b.id ? app.store.get(b.id) : app.store.all()[0];
          if (!rec) return send(res, 404, { error: 'Nothing to simulate' });
          const buf = fs.readFileSync(app.store.pathFor(rec, 'file'));
          const name = b.name || `${rec.name}`;
          await app.printer.uploadFile(buf, `${name}.gcode.3mf`);
          return send(res, 200, app.printer.startPrint({ remoteName: `${name}.gcode.3mf`, subtaskName: name, fail: !!b.fail }));
        }
        return send(res, 404, { error: 'Unknown endpoint' });
      }
      // Static PWA
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      let rel = p === '/' ? '/index.html' : p;
      const file = path.join(cfg.webDir, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
      if (!file.startsWith(cfg.webDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'Not found' });
      const cache = /sw\.js$|version\.js$|index\.html$|\.webmanifest$/.test(file) ? 'no-cache' : 'max-age=300';
      return sendFile(res, file, path.basename(file), { cache });
    } catch (e) {
      if (!e.status) app.log(`API error: ${e.stack || e}`);
      return send(res, e.status || 500, { error: e.message });
    }
  });
}
module.exports = { createServer, publicRecord };
