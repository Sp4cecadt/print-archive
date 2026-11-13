'use strict';
// Local archive: <archiveDir>/index.json + <archiveDir>/<YYYY-MM>/<id>/{file.3mf, thumb.png, mesh.stl}
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.indexFile = path.join(dir, 'index.json');
    this.data = { version: 1, prints: [] };
    if (fs.existsSync(this.indexFile)) this.data = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
  }
  save() {
    const tmp = this.indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.indexFile);
  }
  all() { return this.data.prints.slice().sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '')); }
  get(id) { return this.data.prints.find(p => p.id === id) || null; }
  hasJobKey(key) { return !!key && this.data.prints.some(p => p.jobKey === key); }
  add(rec) { this.data.prints.push(rec); this.save(); return rec; }
  update(id, patch) {
    const p = this.get(id); if (!p) return null;
    Object.assign(p, patch, { updatedAt: new Date().toISOString() }); this.save(); return p;
  }
  pathFor(rec, kind) {
    const f = rec.files && rec.files[kind]; if (!f) return null;
    const full = path.join(this.dir, rec.relDir, f);
    return full.startsWith(this.dir) && fs.existsSync(full) ? full : null;
  }
  last() { return this.data.prints.slice().sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''))[0] || null; }
}
module.exports = { Store };
