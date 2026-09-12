'use strict';

const { readFileSync } = require('node:fs');

// 读取 WebP 的像素尺寸。用于让测试核对 srcset 的 w 描述符、以及各档图片的实际宽度，
// 图被替换后这些断言会立刻失败，提醒重新确认选档边界。
function webpDimensions(buffer) {
  const format = buffer.subarray(12, 16).toString('ascii');
  if (format === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  throw new Error(`无法解析 WebP 尺寸：${format}`);
}

function readWebpDimensions(filePath) {
  return webpDimensions(readFileSync(filePath));
}

module.exports = { readWebpDimensions, webpDimensions };
