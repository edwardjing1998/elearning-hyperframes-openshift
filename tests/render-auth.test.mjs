import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToken, validateToken, createRenderAuth } from '../public/capture-studio/auth.js';

const TOKEN = 'a'.repeat(64);
const KEY = 'hyperframes.renderApiToken.v1';

function setup(handler, saved = '') {
  const storage = new Map(saved ? [[KEY, saved]] : []);
  globalThis.window = { location: { origin: 'https://studio.example' } };
  globalThis.sessionStorage = {
    getItem: k => storage.get(k) ?? null,
    setItem: (k,v) => storage.set(k,v),
    removeItem: k => storage.delete(k)
  };
  globalThis.fetch = handler;
  function element(value = '') {
    return Object.assign(new EventTarget(), {value, checked:false, disabled:false, textContent:'', dataset:{}});
  }
  const ui = {input:element(), remember:element(), testButton:element(), clearButton:element(), status:element()};
  const auth = createRenderAuth(ui);
  return {ui,auth,storage};
}
const success = () => new Response(JSON.stringify({authenticated:true}),{status:200});

test('normalize pasted Bearer prefix and outer whitespace; reject invalid formats', () => {
  assert.equal(normalizeToken('  Bearer '+TOKEN+'\n'), TOKEN);
  assert.equal(validateToken(TOKEN), TOKEN);
  assert.throws(() => validateToken('short'), /short/);
  assert.throws(() => validateToken(TOKEN+' invalid'), /whitespace/);
  assert.throws(() => validateToken(TOKEN+'\u00e9'), /invalid/);
});

test('verify and persist only when opted in; clear on edit', async () => {
  const {ui,auth,storage} = setup(async (url, options) => {
    assert.equal(url.pathname, '/api/auth/verify');
    assert.equal(options.headers.get('authorization'), 'Bearer '+TOKEN);
    assert.equal(options.redirect, 'error');
    return success();
  });
  ui.input.value = ' Bearer '+TOKEN+' ';
  await auth.verify();
  assert.equal(ui.input.value,TOKEN);
  assert.equal(ui.status.dataset.state,'success');
  assert.equal(storage.has(KEY),false);
  ui.remember.checked = true;
  ui.remember.dispatchEvent(new Event('change'));
  assert.equal(storage.get(KEY),TOKEN);
  ui.input.value = 'b'.repeat(64);
  ui.input.dispatchEvent(new Event('input'));
  assert.equal(storage.has(KEY),false);
  assert.equal(ui.status.dataset.state,'pending');
});

test('reload revalidates saved token; 401 removes token from session but retains input for recovery', async () => {
  let unauthorized = false;
  const {ui,auth,storage} = setup(async () => unauthorized ? new Response('', {status:401}) : success(), TOKEN);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.input.value,TOKEN);
  assert.equal(ui.status.dataset.state,'success');
  unauthorized = true;
  await assert.rejects(auth.request('/api/captures'), /Invalid Render API token/);
  assert.equal(storage.has(KEY),false);
  assert.equal(ui.input.value,TOKEN);
  assert.equal(ui.status.dataset.state,'error');
  ui.clearButton.dispatchEvent(new Event('click'));
  assert.equal(ui.input.value,'');
  assert.equal(ui.remember.checked,false);
});

test('preserve capture body and headers; refuse off-origin requests', async () => {
  const blob = new Blob(['video'], {type:'video/webm'});
  let calls = 0;
  const {ui,auth} = setup(async (url, options) => {
    calls++;
    assert.equal(url.pathname,'/api/captures');
    assert.equal(options.headers.get('authorization'),'Bearer '+TOKEN);
    assert.equal(options.headers.get('x-course-id'),'azure-storage');
    assert.equal(options.body,blob);
    return new Response('{}',{status:201});
  });
  ui.input.value = TOKEN;
  assert.equal((await auth.request('/api/captures',{method:'POST',headers:{'X-Course-Id':'azure-storage'},body:blob})).status,201);
  await assert.rejects(auth.request('https://outside.example/api/captures'), /Refusing/);
  assert.equal(calls,1);
});

test('an obsolete verification response cannot mark an edited token as verified', async () => {
  let complete;
  const {ui,auth,storage} = setup(() => new Promise(resolve => {complete=resolve;}));
  ui.input.value = TOKEN;
  ui.remember.checked = true;
  const pending = auth.verify();
  ui.input.value = 'b'.repeat(64);
  ui.input.dispatchEvent(new Event('input'));
  complete(success());
  await pending;
  assert.equal(ui.status.dataset.state,'pending');
  assert.equal(storage.has(KEY),false);
});
