#!/usr/bin/env node
// Usage: node scripts/demo-smoke.mjs https://procurement-contracts-poc.web.app
const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/demo-smoke.mjs <url>');
  process.exit(2);
}
const res = await fetch(url, { redirect: 'follow' });
const html = await res.text();
if (res.status !== 200) {
  console.error(`expected 200, got ${res.status}`);
  process.exit(1);
}
if (!html.includes('Procurement &amp; contracts PoC') || !html.includes('<div id="root">')) {
  console.error('page did not look like the demo');
  process.exit(1);
}
const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
if (script) {
  const js = await fetch(new URL(script, url));
  if (js.status !== 200) {
    console.error(`bundle ${script} returned ${js.status}`);
    process.exit(1);
  }
}
console.log(`ok ${res.status} ${url} (${html.length} bytes, bundle ${script ?? 'n/a'})`);
