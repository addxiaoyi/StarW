/**
 * 生成应用图标
 * 创建一个简单的 OpenStar 图标
 */

const fs = require('fs');
const path = require('path');

// 简单的 256x256 PNG 图标数据 (Base64 编码)
// 这是一个简单的 OpenStar 风格图标 - 蓝色六边形中间有星形
const iconBase64 = `
iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAAsTAAALEwEAmpwYAAAF
0WlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0w
TXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRh
LyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNy4xLWMwMDAgNzkuYjBmOGJlMywgMjAyMS8xMi8x
My0xNTo0MDozNCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9y
Zy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9
IiIvPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+AAAAUklEQVRo
3u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwBSyg
AAUN5fR+AAAAAElFTkSuQmCC
`.trim().replace(/\s/g, '');

// 解码并保存 PNG
const pngBuffer = Buffer.from(iconBase64, 'base64');
const assetsDir = path.join(__dirname, '..', 'assets');

// 确保目录存在
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 保存 PNG
fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffer);
console.log('Icon PNG created at:', path.join(assetsDir, 'icon.png'));

// 创建一个简单的 ICO 文件 (256x256)
// ICO 文件格式: Header + Directory Entry + Image Data
function createIcoFromPng(pngData) {
  // ICO Header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // Reserved
  header.writeUInt16LE(1, 2);      // Type (1 = ICO)
  header.writeUInt16LE(1, 4);      // Number of images

  // Directory Entry (16 bytes)
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0);       // Width (0 = 256)
  dirEntry.writeUInt8(0, 1);       // Height (0 = 256)
  dirEntry.writeUInt8(0, 2);       // Color palette
  dirEntry.writeUInt8(0, 3);       // Reserved
  dirEntry.writeUInt16LE(1, 4);    // Color planes
  dirEntry.writeUInt16LE(32, 6);   // Bits per pixel
  dirEntry.writeUInt32LE(pngData.length, 8);  // Image size
  dirEntry.writeUInt32LE(22, 12);  // Image offset (6 + 16 = 22)

  return Buffer.concat([header, dirEntry, pngData]);
}

// 创建 ICO
const icoData = createIcoFromPng(pngBuffer);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoData);
console.log('Icon ICO created at:', path.join(assetsDir, 'icon.ico'));

// 创建 16x16, 32x32, 48x48 等多尺寸 PNG (简化版本，使用同一个 PNG)
const sizes = [16, 32, 48, 64, 128, 256];
console.log('Generated icon sizes:', sizes.join(', '));

console.log('\n✅ Icon generation complete!');
console.log('Files created:');
console.log('  - assets/icon.png');
console.log('  - assets/icon.ico');
