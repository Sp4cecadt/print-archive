const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 256, height: 256 });
  const dir = path.join(__dirname, '../web/thumbs');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(dir, f), 'utf8').replace('<svg ', '<svg width="256" height="256" ');
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await p.screenshot({ path: path.join(__dirname, '../helper/sample-assets/thumbs', f.replace('.svg', '.png')), omitBackground: true });
  }
  await b.close();
})();
