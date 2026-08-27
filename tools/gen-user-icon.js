// 把用户上传的鲸鱼娘图裁成方形应用图标
// 原图 960x960，主体在右半部分（含鲸鱼娘 + 下方饭碗），切掉左边对话框/手指。
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'user-whale.jpg');
const SZ = 960; // 原图尺寸

const outDir = path.join(__dirname, '..', 'assets');

(async () => {
  const img = sharp(SRC);
  const meta = await img.metadata();
  console.log('原图尺寸:', meta.width, 'x', meta.height);

  // 裁剪：向右偏，取一个方形区域，主体（鲸鱼娘+碗）居中
  // 视觉分析：主体集中在右侧~下半部。取(180..y)..(940)方形偏右下。
  const cropSize = 680;
  const left = SZ * 0.30;   // 左起点 ~288（略偏右，避开左边框）
  const top = SZ * 0.14;    // 上起点 ~134（包含头顶）
  // 先精确到主体区域（去掉左边文字）：
  // 用 vision_ground 定位主体：x1=200 y1=100 x2=800 y2=900
  // 取方形主体区（头身+鱼尾），去掉左框与右下碗
  const cw = 600, ch = 600;
  const cx = 210, cy = 100;
  const cropped = sharp(SRC).extract({ left: cx, top: cy, width: cw, height: ch });
  const cmeta = (await cropped.metadata());
  console.log('裁剪区域:', cx, cy, cw, ch, '→', cmeta.width, 'x', cmeta.height);

  // 输出裁剪预览（262字节略小，用于确认）
  await cropped.clone().resize(480, 480).png()
    .toFile(path.join(outDir, 'preview-crop.png'));
  console.log('preview-crop.png 已生成（预览用）');

  // 正式图标：白色背景填充（保持它原本的白色底，得到圆形边缘避免杂角）
  const icon = await cropped.clone().resize(512, 512)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png().toBuffer();
  require('fs').writeFileSync(path.join(outDir, 'icon-user.png'), icon);
  console.log('icon-user.png 生成:', icon.length, 'bytes (512x512)');
})().catch((e) => { console.error('失败', e); process.exit(1); });
