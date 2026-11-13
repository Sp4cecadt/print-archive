// Usage: node shoot.js <baseUrl> <outPrefix> [--sim]
const puppeteer = require('puppeteer-core');
const [,, base, prefix, simFlag] = process.argv;
const sim = simFlag === '--sim' ? 'sim=1' : '';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.setViewport({ width: 440, height: 956, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  const go = async h => { await p.goto(`${base}?${sim}#${h}`, { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 400)); };
  await go('/dashboard'); await p.screenshot({ path: `${prefix}01-dashboard.png` });
  await go('/library'); await p.screenshot({ path: `${prefix}02-library.png` });
  const id = await p.evaluate(() => (window.PA.S.prints.find(x => x.name === 'Cable clip v2') || window.PA.S.prints[0]).id);
  await go('/print/' + encodeURIComponent(id)); await p.screenshot({ path: `${prefix}03-print-detail.png` });
  await p.evaluate(() => { const m = document.querySelector('#main'); m.scrollTop = m.scrollHeight; }); await new Promise(r => setTimeout(r, 300));
  await p.screenshot({ path: `${prefix}03b-print-detail-bottom.png` });
  await p.evaluate(() => { document.querySelector('#main').scrollTop = 0; });
  await p.click('[data-act="reprint"]'); await new Promise(r => setTimeout(r, 500));
  await p.screenshot({ path: `${prefix}05-reprint-confirm.png` });
  await go('/settings'); await p.screenshot({ path: `${prefix}04-settings.png` });
  await p.evaluate(() => { const m = document.querySelector('#main'); m.scrollTop = m.scrollHeight; }); await new Promise(r => setTimeout(r, 300));
  await p.screenshot({ path: `${prefix}04b-settings-bottom.png` });
  const info = await p.evaluate(async () => ({ mode: window.PA.S.mode, version: window.PA.version, prints: window.PA.S.prints.length, sw: (await navigator.serviceWorker.getRegistration()) ? 'registered' : 'none', caches: await caches.keys() }));
  console.log(JSON.stringify({ info, errors }));
  await b.close();
})();
