'use strict';
// Example prints used by mock mode and the GitHub Pages demo. All data is made up.
const F = {
  plaBlack: { type: 'PLA', color: '#161616', settingsId: 'Bambu PLA Basic @BBL X1C' },
  plaWhite: { type: 'PLA', color: '#F5F5F5', settingsId: 'Bambu PLA Basic @BBL X1C' },
  plaOrange: { type: 'PLA', color: '#FF7A1A', settingsId: 'Bambu PLA Basic @BBL X1C' },
  petgGreen: { type: 'PETG', color: '#00AE42', settingsId: 'Bambu PETG HF @BBL X1C' },
  petgBlack: { type: 'PETG', color: '#101010', settingsId: 'Bambu PETG HF @BBL X1C' },
};
const P = (name, thumb, when, actMin, estMin, fil, grams, label, extra = {}) => ({ name, thumb, when, actMin, estMin, fil, grams, label, ...extra });

module.exports = [
  P('Benchy', 'benchy', '2026-11-12T14:10', 68, 72, F.plaBlack, 18.4, 'mesh', { notes: 'Calibration after the nozzle swap. Hull lines clean.' }),
  P('Cable clip v2', 'clip', '2026-11-10T19:40', 22, 24, F.petgGreen, 6.2, 'stl', { infill: '15%', pattern: 'gyroid', speed: 150, nozzle: 220, bed: 70, walls: 4, notes: 'Fits the 8 mm cable on the workbench loom. Printed with 4 walls for strength. Reprint if the clip gap feels tight.' }),
  P('Pole tag holder', 'tag', '2026-11-08T10:05', 41, 39, F.plaBlack, 14.1, 'sliced', { supports: 'tree(auto)' }),
  P('Phone stand', 'stand', '2026-11-05T16:30', 93, 88, F.plaWhite, 32.0, 'mesh', { layer: 0.16 }),
  P('Enclosure latch', 'latch', '2026-11-03T21:15', 18, 35, F.petgGreen, 8.7, 'sliced', { status: 'failed', nozzle: 240, bed: 70, notes: 'Spaghetti at layer 30. Clean the plate before retrying.' }),
  P('Desk cable clip', 'clip', '2026-11-01T09:20', 26, 27, F.petgGreen, 7.4, 'mesh', { nozzle: 230, bed: 70 }),
  P('Tool hook', 'hook', '2026-10-28T12:00', 47, 50, F.plaOrange, 11.5, 'mesh'),
  P('Cable clip v1', 'clipv1', '2026-10-24T18:45', 21, 22, F.plaBlack, 5.9, 'stl'),
  P('Spool adapter', 'spool', '2026-10-20T08:30', 74, 70, F.petgBlack, 28.6, 'sliced', { nozzle: 245, bed: 70 }),
  P('Tablet stand', 'stand', '2026-10-17T15:10', 128, 121, F.plaWhite, 54.2, 'stl', { infill: '20%' }),
  P('Latch v1', 'latch', '2026-10-14T20:05', 33, 34, F.petgGreen, 9.8, 'sliced', { nozzle: 240, bed: 70 }),
  P('Headphone hook', 'hook', '2026-10-09T11:40', 66, 62, F.plaOrange, 24.3, 'mesh', { supports: 'normal(auto)' }),
  P('Calibration Benchy', 'benchy', '2026-10-04T13:25', 52, 55, F.plaBlack, 15.2, 'sliced', { speed: 250 }),
  P('Tag holder large', 'tag', '2026-09-29T17:50', 88, 85, F.plaBlack, 36.7, 'mesh'),
  P('Wall hook', 'hook', '2026-09-22T10:15', 39, 41, F.plaOrange, 12.8, 'stl'),
  P('Spool clip', 'clipv1', '2026-09-15T19:30', 15, 16, F.plaBlack, 3.4, 'mesh', { status: 'failed', notes: 'Cancelled: wrong plate.' }),
  P('Phone stand v1', 'stand', '2026-09-08T14:00', 101, 96, F.plaWhite, 35.1, 'sliced'),
  P('First Benchy', 'benchy', '2026-09-02T18:20', 49, 52, F.plaBlack, 15.0, 'mesh', { notes: 'First print on the X1C.' }),
];
