// Builds the iPhone launch images (apple-touch-startup-image) from icons/icon.svg, in light
// and dark, and prints the <link> tags for index.html. Run: PW=<playwright> node tools/build_splash.mjs
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PW ?? 'playwright');
// CSS width × height and pixel ratio of current iPhones (portrait).
const DEVICES = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2], [320, 568, 2],
];
const svg = await readFile(new URL('../app/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const links = [];
for (const [w, h, r] of DEVICES) {
  for (const [scheme, bg] of [['light', '#f2f2f7'], ['dark', '#000000']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg}">
      <div style="width:${Math.round(w * 0.28)}px">${svg.replace('<svg ', '<svg width="100%" ')}</div></body>`);
    const name = `splash-${w}x${h}@${r}-${scheme}.png`;
    await page.screenshot({ path: new URL(`../app/icons/splash/${name}`, import.meta.url).pathname });
    await page.close();
    links.push(`<link rel="apple-touch-startup-image" href="icons/splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})">`);
  }
}
await browser.close();
console.log(links.join('\n'));
