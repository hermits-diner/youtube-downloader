// Rasterize build/icon.svg into build/icon.ico (multi-size, PNG-embedded).
// Uses the bundled Electron's Chromium to render the SVG — no extra deps.
// Run:  npx electron build-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const SIZES = [256, 128, 64, 48, 32, 16];
const svgPath = path.join(__dirname, 'build', 'icon.svg');
const outPath = path.join(__dirname, 'build', 'icon.ico');

function pngsToIco(items) {
  // items: [{ size, buf }]
  const count = items.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  items.forEach((it, i) => {
    const e = i * 16;
    dir.writeUInt8(it.size >= 256 ? 0 : it.size, e + 0); // width (0 = 256)
    dir.writeUInt8(it.size >= 256 ? 0 : it.size, e + 1); // height
    dir.writeUInt8(0, e + 2); // palette
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // color planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(it.buf.length, e + 8); // size of image data
    dir.writeUInt32LE(offset, e + 12); // offset of image data
    offset += it.buf.length;
    blobs.push(it.buf);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>*{margin:0;padding:0}html,body{width:512px;height:512px;background:transparent;overflow:hidden}
    svg{display:block}</style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Wait for an offscreen paint (with a timeout fallback).
  await new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };
    win.webContents.on('paint', () => finish());
    setTimeout(finish, 1800);
  });
  await new Promise((r) => setTimeout(r, 300));

  const shot = await win.webContents.capturePage();
  const items = SIZES.map((size) => ({
    size,
    buf: shot.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  fs.writeFileSync(outPath, pngsToIco(items));
  console.log('Wrote', outPath, 'sizes:', SIZES.join(','), 'source', shot.getSize());
  win.destroy();
  app.quit();
});
