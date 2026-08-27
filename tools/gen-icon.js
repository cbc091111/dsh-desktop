// 用 sharp 把 whale-icon.svg 渲染成高质量 PNG 图标
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'whale-icon.svg'));

(async () => {
  const buf = await sharp(Buffer.from(svg)).png().resize(256, 256).toBuffer();
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), buf);
  console.log('icon.png 生成:', buf.length, 'bytes (256x256 Q版大肥鱼)');
  // 也生成一个高分辨率 icns 用的 png（512，mac 备用）
  const buf512 = await sharp(Buffer.from(svg)).png().resize(512, 512).toBuffer();
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon-512.png'), buf512);
  console.log('icon-512.png 生成:', buf512.length, 'bytes');
})().catch((e) => { console.error('生成失败', e); process.exit(1); });
