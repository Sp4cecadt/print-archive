'use strict';
// Turns the printer's MQTT report stream into "job finished/failed" events.
const EventEmitter = require('events');

const ACTIVE = new Set(['PREPARE', 'RUNNING', 'PAUSE', 'SLICING']);
const DONE = { FINISH: 'finished', FAILED: 'failed' };

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepMerge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

class JobTracker extends EventEmitter {
  constructor({ isArchived = () => false, captureOnStartIfFinished = true } = {}) {
    super();
    this.state = {};      // merged "print" object (P1/A1 send deltas, X1 sends full reports)
    this.current = null;  // job in progress
    this.lastGcodeState = null;
    this.isArchived = isArchived;
    this.captureOnStartIfFinished = captureOnStartIfFinished;
    this.seenFirst = false;
  }

  jobFromState(s) {
    const startSec = parseInt(s.gcode_start_time, 10);
    const name = s.subtask_name || (s.gcode_file ? String(s.gcode_file).replace(/^.*\//, '').replace(/\.gcode\.3mf$|\.3mf$|\.gcode$/i, '') : 'Untitled');
    return {
      name,
      gcodeFile: s.gcode_file || '',
      taskId: s.task_id || '',
      subtaskId: s.subtask_id || '',
      startedAt: Number.isFinite(startSec) && startSec > 0 ? startSec * 1000 : Date.now(),
      plate: plateFromGcodeFile(s.gcode_file),
      jobKey: `${s.task_id || ''}|${name}|${s.gcode_start_time || ''}`,
    };
  }

  handle(msg) {
    if (!msg || !msg.print) return;
    deepMerge(this.state, msg.print);
    const s = this.state;
    const gs = s.gcode_state;
    if (!gs) return;
    const prev = this.lastGcodeState;
    this.lastGcodeState = gs;
    const first = !this.seenFirst; this.seenFirst = true;

    if (ACTIVE.has(gs)) {
      const j = this.jobFromState(s);
      if (!this.current || (this.current.jobKey !== j.jobKey && s.subtask_name)) {
        this.current = j; this.emit('jobStart', j);
      }
      return;
    }
    if (DONE[gs] && gs !== prev) {
      let job = this.current;
      if (!job && first && this.captureOnStartIfFinished) {
        const j = this.jobFromState(s);
        if (!this.isArchived(j.jobKey)) job = { ...j, lateCapture: true };
      }
      this.current = null;
      if (!job) return;
      this.emit('jobEnd', {
        ...job,
        status: DONE[gs],
        finishedAt: job.lateCapture ? null : Date.now(),
        failReason: gs === 'FAILED' ? (s.print_error ? `Printer error ${s.print_error}` : 'Failed or cancelled') : null,
        finalTemps: { nozzle: s.nozzle_temper, bed: s.bed_temper, chamber: s.chamber_temper },
        layers: { done: s.layer_num, total: s.total_layer_num },
      });
    } else if (gs === 'IDLE') {
      this.current = null;
    }
  }
}

function plateFromGcodeFile(f) {
  const m = /plate_(\d+)\.gcode/i.exec(f || ''); return m ? parseInt(m[1], 10) : 1;
}

// Loaded filament from the merged report (AMS tray_now, or the external spool vt_tray).
function loadedFilament(s) {
  const ams = s.ams || {};
  const now = ams.tray_now;
  const fmt = (t, source) => t && t.tray_type ? {
    type: t.tray_type, color: t.tray_color ? '#' + String(t.tray_color).slice(0, 6).toUpperCase() : null,
    name: t.tray_sub_brands || t.tray_type, source,
  } : null;
  if (now !== undefined && now !== '255' && now !== '254') {
    const n = parseInt(now, 10);
    const unit = (ams.ams || []).find(a => parseInt(a.id, 10) === Math.floor(n / 4));
    const tray = unit && (unit.tray || []).find(t => parseInt(t.id, 10) === n % 4);
    const f = fmt(tray, `AMS ${Math.floor(n / 4) + 1} slot ${(n % 4) + 1}`);
    if (f) return f;
  }
  return fmt(s.vt_tray, 'External spool');
}

function amsTrays(s) {
  const out = [];
  for (const a of ((s.ams || {}).ams || [])) for (const t of (a.tray || [])) {
    if (t.tray_type) out.push({ index: parseInt(a.id, 10) * 4 + parseInt(t.id, 10), type: t.tray_type, color: t.tray_color ? '#' + String(t.tray_color).slice(0, 6).toUpperCase() : null });
  }
  return out;
}

module.exports = { JobTracker, loadedFilament, amsTrays, deepMerge, ACTIVE };
