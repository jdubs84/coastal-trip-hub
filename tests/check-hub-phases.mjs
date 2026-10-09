/**
 * Time-override check for the hub hero.
 * Serves the repo, opens Chrome, and checks four Eastern Time states:
 * morning before leaving, the drive itself, after arrival, and the last day.
 *
 *   node tests/check-hub-phases.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shotDir = process.env.HUB_SHOT_DIR || '/opt/cursor/artifacts/screenshots';
const port = Number(process.env.HUB_PORT || 8766);
const debugPort = Number(process.env.HUB_DEBUG_PORT || 9334);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(404);
      res.end(String(err && err.code || 'missing'));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function startChrome() {
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/chrome-hub-phase-5010',
    '--remote-debugging-port=' + debugPort,
    'about:blank'
  ], { stdio: 'ignore' });
  return chrome;
}

async function waitForChrome() {
  const deadline = Date.now() + 15000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + debugPort + '/json/version');
      if (res.ok) return;
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome did not open a debug port: ' + last);
}

class Page {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.next = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
  }
  send(method, params) {
    const id = this.next++;
    const body = JSON.stringify({ id, method, params: params || {} });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(body);
    });
  }
  async open(url) {
    await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await this.send('Page.navigate', { url });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await this.send('Runtime.evaluate', {
        expression: 'document.getElementById("now") && document.getElementById("now").dataset.phase || ""',
        returnByValue: true
      });
      const phase = result.result && result.result.value;
      if (phase) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('page did not paint a phase for ' + url);
  }
  async snapshot() {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => {
        const text = (id) => {
          const el = document.getElementById(id);
          return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
        };
        const pill = document.getElementById('nextDrivePill');
        const now = document.getElementById('now');
        const pillBox = pill.getBoundingClientRect();
        const nowBox = now.getBoundingClientRect();
        const y = window.scrollY;
        const place = (sel) => {
          const node = document.querySelector(sel);
          if (!node) return { open: false, earlier: false };
          const el = node.closest('details') || node;
          return { open: !!el.open, earlier: !!el.closest('details.earlier-fold') };
        };
        const drives = document.getElementById('drives');
        const driveBox = drives ? drives.getBoundingClientRect() : { top: 0, bottom: 0 };
        const liveDrives = [...document.querySelectorAll('#drives .drive-grid > details.drive-fold')].map(el => el.getAttribute('data-until'));
        const driveSum = document.querySelector('#drives .earlier-fold > summary');
        const lodgeSum = document.querySelector('#lodging > details.earlier-fold > summary');
        return {
          phase: now.dataset.phase || '',
          kicker: text('nowKicker'),
          title: text('nowTitle'),
          time: text('nowTime'),
          meta: text('nowMeta'),
          next: text('nowNext'),
          status: text('dayStatus'),
          pill: pill.hidden ? '' : text('nextDrivePill'),
          nextHidden: !!(document.getElementById('nowNext') && document.getElementById('nowNext').hidden),
          bottom: Math.ceil(Math.max(nowBox.bottom, pillBox.bottom) + y + 16),
          dayTop: Math.floor((document.getElementById('dayof') || now).getBoundingClientRect().top + y),
          drivesTop: Math.floor(driveBox.top + y),
          drivesBottom: Math.ceil(driveBox.bottom + y + 8),
          liveDrives: liveDrives,
          driveEarlier: driveSum ? driveSum.textContent.replace(/\\s+/g, ' ').trim() : '',
          lodgeEarlier: lodgeSum ? lodgeSum.textContent.replace(/\\s+/g, ' ').trim() : '',
          hammocks: place('#hammocks-arrival'),
          hammocksTodo: place('#hammocks-todo'),
          frisco: place('#frisco-arrival'),
          friscoTodo: place('#frisco-todo'),
          corolla: place('#corolla-arrival'),
          meals: (function () {
            const row = [...document.querySelectorAll('#dayCardGrid .dayof-item')].find(el => /^meals$/i.test(((el.querySelector('.k') || {}).textContent || '').trim()));
            return row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
          })(),
          food: (function () {
            const read = (date) => {
              const block = document.querySelector('.food-day[data-dates~="' + date + '"]');
              const fold = block && block.closest('details.food-fold');
              if (!block || !fold) return { earlier: false, open: false, visible: '', leg: '' };
              return {
                earlier: !!fold.closest('details.earlier-fold'),
                open: !!fold.open,
                visible: [...block.querySelectorAll(':scope > ul > li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
                leg: (fold.querySelector('details.leg-fold') ? 'collapsed' : '')
              };
            };
            return { thu: read('2026-10-08'), fri: read('2026-10-09'), sun: read('2026-10-11') };
          })()
        };
      })()`,
      returnByValue: true
    });
    return result.result.value;
  }
  async shoot(filename, clip) {
    const region = typeof clip === 'number'
      ? { x: 0, y: 0, width: 390, height: clip, scale: 1 }
      : clip;
    const shot = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: region
    });
    const path = join(shotDir, filename);
    await writeFile(path, Buffer.from(shot.data, 'base64'));
    return path;
  }
  close() {
    this.ws.close();
  }
}

function assertCase(name, snap, checks) {
  const problems = [];
  checks.forEach(([label, ok]) => {
    if (!ok) problems.push(label);
  });
  if (problems.length) {
    throw new Error(name + ' failed: ' + problems.join('; ') + '\n' + JSON.stringify(snap, null, 2));
  }
  console.log('ok ' + name + ' · ' + snap.phase + ' · ' + snap.kicker + ' · ' + snap.time + ' · ' + (snap.pill || '(no next drive)'));
}

async function main() {
  await mkdir(shotDir, { recursive: true });
  const server = await startServer();
  const chrome = startChrome();
  let page;
  try {
    await waitForChrome();
    const created = await fetch('http://127.0.0.1:' + debugPort + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
    const target = await created.json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.ready();
    const base = 'http://127.0.0.1:' + port + '/index.html';

    await page.open(base + '?date=2026-10-08&time=08:00');
    let snap = await page.snapshot();
    assertCase('morning before leaving', snap, [
      ['phase before', snap.phase === 'before'],
      ['drive day kicker', /drive day/i.test(snap.kicker)],
      ['leave by 10:35', /leave by ~10:35 AM/i.test(snap.time)],
      ['today still next', /10\/8/.test(snap.pill) && /Frisco/i.test(snap.pill)],
      ['status is the drive', /drive day/i.test(snap.status)],
      ['thursday drive still live', snap.liveDrives.indexOf('2026-10-08') !== -1],
      ['three earlier drives', snap.driveEarlier === 'Earlier · 3 drives'],
      ['four finished stays', snap.lodgeEarlier === 'Earlier · 4 finished stays'],
      ['hammocks still open', snap.hammocks.open && snap.hammocks.earlier === false]
    ]);
    const beforePath = await page.shoot('before-leaving-390.png', Math.max(snap.bottom, 640));

    await page.open(base + '?date=2026-10-08&time=12:00');
    snap = await page.snapshot();
    assertCase('during the drive', snap, [
      ['phase enroute', snap.phase === 'enroute'],
      ['on the road', /on the road/i.test(snap.kicker) && /on the road/i.test(snap.time)],
      ['leave-by is no longer the lead', !/leave by/i.test(snap.time)],
      ['this drive is still next', /10\/8/.test(snap.pill) && /Hammocks/i.test(snap.pill)]
    ]);

    await page.open(base + '?date=2026-10-08&time=21:00');
    snap = await page.snapshot();
    assertCase('after arrival', snap, [
      ['phase arrived', snap.phase === 'arrived'],
      ['stay named once', snap.title === 'Frisco stay' && snap.time !== 'Frisco stay' && !/Frisco stay/.test(snap.meta) && !/Frisco stay/.test(snap.kicker)],
      ['headline is the cabin', snap.time === 'Cabin 6 · Frisco Woods'],
      ['kicker is drive done', /drive done/i.test(snap.kicker)],
      ['tomorrow is Friday and adds a fact', snap.meta === 'Tomorrow · Fri 10/9 · No drive'],
      ['cabin line is not repeated under tomorrow', snap.nextHidden || snap.next !== snap.time],
      ['next drive is Sunday', /10\/11/.test(snap.pill) && /Corolla/i.test(snap.pill)],
      ['today drive is not next', !/10\/8/.test(snap.pill)],
      ['status is the stay', /Frisco/i.test(snap.status) && !/^Drive day/i.test(snap.status)],
      ['thursday drive folded', snap.liveDrives.join(',') === '2026-10-11'],
      ['four earlier drives', snap.driveEarlier === 'Earlier · 4 drives'],
      ['five finished stays', snap.lodgeEarlier === 'Earlier · 5 finished stays'],
      ['hammocks stay folded', snap.hammocks.earlier && !snap.hammocks.open],
      ['hammocks todo folded', snap.hammocksTodo.earlier && !snap.hammocksTodo.open],
      ['frisco stay open', snap.frisco.open && !snap.frisco.earlier],
      ['thursday food stays current', snap.food.thu.open && snap.food.thu.earlier === false],
      ['leg notes collapsed', snap.food.thu.leg === 'collapsed' && !/Cook Out/.test(snap.food.thu.visible) && !/stock snack/i.test(snap.food.thu.visible)],
      ['tonight dinner still listed', /READYWISE|dinner/i.test(snap.food.thu.visible) && /READYWISE|Coleman/i.test(snap.meals) && !/Cook Out/.test(snap.meals) && !/stock snack/i.test(snap.meals)]
    ]);
    const afterPath = await page.shoot('thu-9pm-390.png', Math.max(snap.bottom, 640));
    const thuMealsPath = await page.shoot('thu-9pm-meals-390.png', {
      x: 0, y: snap.dayTop, width: 390, height: 980, scale: 1
    });
    const thuDrivesPath = await page.shoot('thu-9pm-drives-390.png', {
      x: 0, y: snap.drivesTop, width: 390, height: Math.min(snap.drivesBottom - snap.drivesTop, 1400), scale: 1
    });

    await page.open(base + '?date=2026-10-13&time=09:00');
    snap = await page.snapshot();
    assertCase('last morning before checkout', snap, [
      ['phase checkout', snap.phase === 'checkout'],
      ['checkout still ahead', /check out by 10:00 AM/i.test(snap.time)],
      ['trip not over yet', !/trip over/i.test(snap.kicker)],
      ['corolla still open', snap.corolla.open && snap.corolla.earlier === false],
      ['no drive left', snap.pill === '']
    ]);

    await page.open(base + '?date=2026-10-13&time=11:00');
    snap = await page.snapshot();
    assertCase('last day after checkout', snap, [
      ['phase done', snap.phase === 'done'],
      ['checked out', snap.time === 'Checked out'],
      ['trip over', /trip over/i.test(snap.kicker) && /trip over/i.test(snap.status)],
      ['no drive left', snap.pill === '']
    ]);

    await page.open(base + '?date=2026-10-09&time=12:00');
    snap = await page.snapshot();
    assertCase('Friday noon stay', snap, [
      ['phase stay', snap.phase === 'stay'],
      ['no drive on a stay day', /no drive/i.test(snap.time)],
      ['cabin wording', snap.next === 'Cabin 6 · Frisco Woods'],
      ['thursday food has rolled past midnight', snap.food.thu.earlier && snap.food.thu.open === false],
      ['tomorrow is Saturday', /Sat/.test(snap.meta) && !/Fri 10\/9/.test(snap.meta)],
      ['thursday drive stays folded', snap.liveDrives.join(',') === '2026-10-11'],
      ['four earlier drives', snap.driveEarlier === 'Earlier · 4 drives'],
      ['five finished stays', snap.lodgeEarlier === 'Earlier · 5 finished stays'],
      ['hammocks stay folded', snap.hammocks.earlier && !snap.hammocks.open],
      ['frisco stay open', snap.frisco.open && !snap.frisco.earlier]
    ]);
    const friPath = await page.shoot('fri-noon-390.png', Math.max(snap.bottom, 640));

    await page.open(base + '?date=2026-10-11&time=08:00');
    snap = await page.snapshot();
    assertCase('Sunday morning before leaving', snap, [
      ['phase before', snap.phase === 'before'],
      ['leave by noon', /leave by noon/i.test(snap.time)],
      ['sunday drive is live', snap.liveDrives.indexOf('2026-10-11') !== -1],
      ['frisco still open', snap.frisco.open && !snap.frisco.earlier],
      ['hammocks already folded', snap.hammocks.earlier && !snap.hammocks.open],
      ['next drive is today', /10\/11/.test(snap.pill)],
      ['sunday food still current', snap.food.sun.open && snap.food.sun.earlier === false && /northbound|NC-12/i.test(snap.food.sun.visible)],
      ['thursday food already earlier', snap.food.thu.earlier]
    ]);
    const sunPath = await page.shoot('sun-8am-390.png', Math.max(snap.bottom, 640));

    await page.open(base + '?date=2026-10-11&time=21:00');
    snap = await page.snapshot();
    assertCase('Sunday evening after arrival', snap, [
      ['phase arrived', snap.phase === 'arrived'],
      ['headline is the condo', snap.time === 'GhettOHway Condo · Corolla'],
      ['stay named once', snap.title === 'Corolla stay' && !/Corolla stay/.test(snap.meta)],
      ['tomorrow is Monday', snap.meta === 'Tomorrow · Mon 10/12 · No drive'],
      ['sunday drive folded', snap.liveDrives.indexOf('2026-10-11') === -1],
      ['five earlier drives', snap.driveEarlier === 'Earlier · 5 drives'],
      ['frisco folded', snap.frisco.earlier && !snap.frisco.open],
      ['corolla open', snap.corolla.open && !snap.corolla.earlier],
      ['no next drive', snap.pill === '']
    ]);

    await page.open(base + '?date=2026-10-13&time=21:00');
    snap = await page.snapshot();
    assertCase('Tuesday evening after checkout', snap, [
      ['phase done', snap.phase === 'done'],
      ['checked out', snap.time === 'Checked out'],
      ['corolla folded', snap.corolla.earlier && !snap.corolla.open],
      ['seven finished stays', snap.lodgeEarlier === 'Earlier · 7 finished stays'],
      ['no drive left', snap.pill === '']
    ]);

    console.log('screenshot ' + beforePath);
    console.log('screenshot ' + afterPath);
    console.log('screenshot ' + thuMealsPath);
    console.log('screenshot ' + thuDrivesPath);
    console.log('screenshot ' + friPath);
    console.log('screenshot ' + sunPath);
  } finally {
    if (page) page.close();
    chrome.kill();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
