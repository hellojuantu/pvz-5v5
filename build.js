const fs = require('fs');

// 获取环境变量中的 BACKEND_URL，如果未设置则为空字符串 (本地开发通常不需要)
const backendUrl = process.env.BACKEND_URL || '';

const content = `window.BACKEND_URL = "${backendUrl}";`;

try {
  fs.writeFileSync('config.js', content);
  console.log('Successfully generated config.js');
  console.log('BACKEND_URL:', backendUrl || '(not set, using default relative path)');
} catch (error) {
  console.error('Error writing config.js:', error);
  process.exit(1);
}
