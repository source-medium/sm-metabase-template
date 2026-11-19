import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {copyFile, mkdir, mkdtemp, rename, writeFile, access} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {seed} from './seed.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const {values} = parseArgs({options: {out: {type: 'string'}, routes: {type: 'string'},
  viewport: {type: 'string', default: 'all'}, theme: {type: 'string', default: 'all'}}});
if (!values.out) throw new Error('Pass --out <new packet directory>.');
const select = (value, choices) => {
  if (value === 'all') return choices;
  if (!choices.includes(value)) throw new Error('Choose one of ' + choices.join(', ') + ' or all.');
  return [value];
};
const themes = select(values.theme, ['light', 'dark']);
const viewports = select(values.viewport, ['desktop', 'mobile']);
const out = resolve(values.out);
if (await access(out).then(() => true, () => false)) throw new Error('Output already exists.');
await mkdir(dirname(out), {recursive: true});
const run = (cmd, args) => execFileSync(cmd, args, {cwd: root, encoding: 'utf8'}).trim();
const git = (...args) => run('git', args);
const manifest = {v: 1, repo: 'sm-metabase-template', sha: git('rev-parse', 'HEAD'),
  dirty: Boolean(git('status', '--porcelain')), register: 'product', items: []};
const name = 'foundation-capture-' + randomUUID();
let container, warehouse, browser;
const staging = await mkdtemp(join(dirname(out), '.foundation-packet-'));
// Node cannot await cleanup during exit. Attempt every owned resource even when
// one has already disappeared. The staging directory is also removed on signals.
process.once('exit', () => {
  for (const id of [warehouse, container].filter(Boolean)) {
    try { run('docker', ['stop', '-t', '2', id]); }
    catch { console.error('Could not stop capture container ' + id); process.exitCode = 1; }
  }
  rmSync(staging, {recursive: true, force: true});
});
process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));
try {
  container = run('docker', ['run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::3000',
    '-e', 'MB_ANON_TRACKING_ENABLED=false', '-e', 'MB_CHECK_FOR_UPDATES=false', '-e', 'MB_ENABLE_PUBLIC_SHARING=true',
    'metabase/metabase:v0.65.3']);
  const origin = 'http://' + run('docker', ['port', container, '3000/tcp']);
  const password = randomUUID();
  warehouse = execFileSync('docker', ['run', '--rm', '-d', '--network', 'container:' + container,
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD', 'postgres:17-alpine',
    'postgres', '-c', 'listen_addresses=127.0.0.1'], {encoding: 'utf8', env: {...process.env, POSTGRES_PASSWORD: password}}).trim();
  const deadline = Date.now() + 150000;
  while (!(await fetch(origin + '/api/health').then(r => r.ok, () => false))) {
    if (Date.now() > deadline) throw new Error('Local Metabase startup timed out.');
    await new Promise(r => setTimeout(r, 1000));
  }
  run('docker', ['exec', warehouse, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    "CREATE TABLE filter_values(day date, label text); INSERT INTO filter_values VALUES ('2026-10-28', 'North shop')"]);
  const routes = await seed(origin, password);
  const requested = values.routes?.split(',') || routes.map(r => r.route_id);
  if (requested.some(id => !routes.some(r => r.route_id === id))) throw new Error('Unknown route. Available: ' + routes.map(r => r.route_id).join(', '));
  browser = await chromium.launch();
  for (const route of routes.filter(r => requested.includes(r.route_id))) {
    await mkdir(join(staging, route.route_id));
    for (const viewport of viewports) for (const theme of themes) {
      const width = viewport === 'desktop' ? 1440 : 390;
      const height = viewport === 'desktop' ? 900 : 844;
      const page = await browser.newPage({viewport: {width, height}, colorScheme: theme});
      const queryChecks = [];
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (!path.startsWith('/api/') || !path.includes('/card/')) return;
        queryChecks.push((async () => {
          if (!response.ok()) return path + ' returned ' + response.status();
          const result = await response.json();
          return result?.error || result?.status === 'failed' ? path + ': ' + (result.error || 'failed query') : null;
        })().catch(error => path + ': ' + error.message));
      });
      await page.route('**/*', intercepted => new URL(intercepted.request().url()).origin === origin ?
        intercepted.continue() : intercepted.abort());
      await page.goto(origin + route.path + '#theme=' + (theme === 'dark' ? 'night' : 'light'));
      const cards = page.locator('[data-testid="dashcard"]');
      await cards.first().waitFor({timeout: 45000});
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      if (await cards.count() !== route.count) throw new Error('Incorrect card count on ' + route.tab);
      const heading = page.getByText(route.title, {exact: true}).first();
      await heading.waitFor();
      const probes = await page.evaluate(() => {
        const clipped = [...document.querySelectorAll('[data-testid="dashcard"] *')].filter(el => {
          const style = getComputedStyle(el);
          return el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1
            && ['hidden','clip'].includes(style.overflowX) && style.textOverflow !== 'ellipsis'
            && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
        }).slice(0, 20).map(el => el.tagName.toLowerCase() + ' ' + el.textContent.trim().slice(0, 60));
        return {page: document.documentElement.scrollWidth > document.documentElement.clientWidth, clipped};
      });
      const contentHeight = await cards.evaluateAll(nodes => Math.max(...nodes.map(node => node.getBoundingClientRect().bottom)));
      await page.setViewportSize({width, height: Math.min(4000, Math.max(height, Math.ceil(contentHeight) + 64))});
      await page.waitForTimeout(300);
      await page.waitForLoadState('networkidle');
      const queryErrors = (await Promise.all(queryChecks)).filter(Boolean);
      const failedCards = await cards.filter({hasText: /there was a problem displaying|something went wrong|cannot be displayed|group only by a time field/i}).allInnerTexts();
      const errors = [...queryErrors, ...failedCards];
      if (errors.length) throw new Error('A card failed on ' + route.tab + ': ' + errors.join(', '));
      const file = route.route_id + '/' + viewport + '-' + theme + '.png';
      await page.screenshot({path: join(staging, file), animations: 'disabled'});
      const capturedHeight = page.viewportSize().height;
      const finalBottom = await cards.evaluateAll(nodes => Math.ceil(Math.max(...nodes.map(node => node.getBoundingClientRect().bottom))));
      const capture = {height: capturedHeight, contentHeight: Math.max(capturedHeight, finalBottom), truncated: finalBottom > capturedHeight};
      manifest.items.push({route_id: route.route_id, priority: route.priority, path: route.path, viewport, theme, file,
        capture, h1: (await heading.innerText()).trim(), overflow: probes});
      console.log(file);
      await page.close();
    }
  }
  await mkdir(join(staging, 'rubric'));
  for (const doc of ['PRODUCT.md', 'DESIGN.md']) await copyFile(join(root, doc), join(staging, 'rubric', doc));
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rename(staging, out);
} finally {
  await browser?.close();
}
