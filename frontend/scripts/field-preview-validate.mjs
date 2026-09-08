// Non-browser validation for the standalone HTML prototype.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, stat } from 'node:fs/promises';
const base = new URL('../public/field-preview/', import.meta.url);
const data = await readFile(new URL('data.js', base), 'utf8');
const code = await readFile(new URL('app.js', base), 'utf8');
new vm.Script(data); new vm.Script(code);
function harness(id) {
  const nodes = new Map();
  const element = () => ({ innerHTML: '', textContent: '', dataset: {}, append() {}, prepend() {}, setAttribute() {}, addEventListener() {}, querySelector() { return element(); }, querySelectorAll() { return []; }, showModal() {}, close() {}, focus() {}, isConnected: true });
  const get = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const context = { document: { body: { dataset: { page: id }, append() {} }, querySelector: get, querySelectorAll: () => [], createElement: element, addEventListener() {} }, console, URL, Date, Intl, FormData, setTimeout: () => 1, clearTimeout() {}, location: { href: '' }, matchMedia: () => ({ matches: false }) };
  context.window = context;
  vm.createContext(context); vm.runInContext(data, context); vm.runInContext(code, context);
  return { nodes, context, get };
}
const nav = harness('index');
const fields = nav.context.FIELDS;
assert.equal(fields.length, 11);
for (const f of fields) {
  const html = await readFile(new URL(f.id + '.html', base), 'utf8');
  assert.ok(html.includes(`data-page="${f.id}"`));
  await stat(new URL('assets/' + f.image, base));
  const test = harness(f.id);
  const output = test.get('#app').innerHTML + test.get('#content').innerHTML;
  assert.ok(output.includes(f.star), f.id + ' star label');
  assert.ok(test.get('#content').innerHTML.length > 200, f.id + ' primary surface');
  assert.ok(output.includes('./index.html'), f.id + ' return link');
  for (const match of output.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) await stat(new URL(match[1], base));
  // Exercise renderer variants without a browser or page DOM inspection.
  if(f.id==='library') vm.runInContext('libraryTab="clubs";renderers.library();workCategory="journal";libraryTab="works";renderers.library();',test.context);
  if(f.id==='museum') vm.runInContext('floor=2;renderers.museum();floor=3;renderers.museum();',test.context);
  if(f.id==='health') vm.runInContext('healthTier="child";healthCat="all";renderers.health();',test.context);
  if(f.id==='health') assert.ok(!test.get('#content').innerHTML.includes('成年後的自主與溝通'));
  if(f.id==='adult') { vm.runInContext('adultAccess=true;renderers.adult();',test.context); assert.ok(test.get('#content').innerHTML.includes('把界線說清楚')); }
  if(f.id==='weilan') vm.runInContext('for(const band of ["low","mid","high"]){density=band;renderers.weilan();for(const [game] of games[band])gameView({game,seats:[],messages:[]});}',test.context);
  if(f.id==='mail') vm.runInContext('for(const tab of ["inbox","sent","timed","physical"]){mailTab=tab;renderers.mail();}',test.context);
  if(f.id==='park') { vm.runInContext('parkActivity="rest";renderers.park();',test.context); assert.ok(test.get('#content').innerHTML.includes('已示意打卡')); }
  assert.equal(vm.runInContext('esc("<script>\\\"&")',test.context),'&lt;script&gt;&quot;&amp;');
  console.log('PASS', f.id, 'HTML, image, renderer variants, return link');
}
assert.ok(!/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\.geolocation\b/.test(code),'No network, persistent storage or geolocation');
for(const file of ['index.html',...fields.map(f=>f.id+'.html')]) {
 const html=await readFile(new URL(file,base),'utf8');
 for(const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await stat(new URL(match[1],base));
}
console.log('PASS 12 HTML entry files, assets and script syntax. Not a browser interaction or visual test.');
