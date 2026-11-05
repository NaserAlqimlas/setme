// Run: node tests/test_load.mjs
// Every browser module loads: app.js, ui.mjs and each page, in a stand-in browser. Catches a syntax error, an
// import with no matching export, or code that breaks when the file first runs, before anyone opens the page.
// It doesn't draw any page, so a name used inside a function without being imported still only shows when that
// code runs.
const noop = () => {};
// Anything read from it is another stand-in, so top-level DOM lookups and observers just work.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub(),
  apply: () => stub(), construct: () => stub(),
});
globalThis.window = {
  addEventListener: noop,
  supabase: { createClient: () => ({ auth: { onAuthStateChange: noop, getSession: async () => ({ data: { session: null } }) } }) },
};
globalThis.document = new Proxy({ querySelectorAll: () => [], fonts: { load: async () => {} } }, { get: (t, k) => k in t ? t[k] : stub() });
globalThis.location = { hash: '', search: '', pathname: '/' };
globalThis.history = { replaceState: noop };
globalThis.addEventListener = noop;
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop });
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.ResizeObserver = globalThis.MutationObserver = class { observe() {} disconnect() {} };
// app.js draws the login page as soon as it loads; the stand-in DOM stops there, which is fine.
process.on('unhandledRejection', noop);

import { readdirSync } from 'node:fs';
const pages = readdirSync(new URL('../site/js/pages/', import.meta.url)).filter(f => f.endsWith('.mjs')).map(f => `pages/${f}`);
let fail = 0;
for (const m of ['ui.mjs', ...pages, 'app.js']) {
  try { await import(new URL(`../site/js/${m}`, import.meta.url)); }
  catch (e) { fail++; console.log('FAIL', m, e.message); }
}
console.log(fail ? `${fail} failed` : 'ok');
process.exit(fail ? 1 : 0);
