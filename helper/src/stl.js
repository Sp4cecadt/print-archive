'use strict';
const fs = require('fs');
const path = require('path');
const { normKey } = require('./util');

// Find an original mesh (STL, or 3MF/OBJ/STEP project) in the watch folder whose name matches the print.
function findStl(watchDir, candidates, maxDepth = 4) {
  if (!watchDir || !fs.existsSync(watchDir)) return null;
  const keys = new Set(candidates.filter(Boolean).map(normKey).filter(Boolean));
  if (!keys.size) return null;
  let best = null;
  const walk = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth) walk(full, depth + 1); continue; }
      if (!/\.stl$/i.test(e.name)) continue;
      if (keys.has(normKey(e.name))) {
        const st = fs.statSync(full);
        if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, name: e.name, size: st.size, mtimeMs: st.mtimeMs };
      }
    }
  };
  walk(watchDir, 0);
  return best;
}
module.exports = { findStl };
