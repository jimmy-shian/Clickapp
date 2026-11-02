const fs = require('node:fs');
const path = require('node:path');

const ADSENSE_SLOT_KEYS = ['splash', 'banner', 'floating', 'prerecording'];

/** 讀取 JSON 時去掉 UTF-8 BOM（Windows 工具常會寫入 BOM，會讓 JSON.parse 直接報錯）。 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function ensureAdConfig(root = path.resolve(__dirname, '..')) {
  const target = path.join(root, 'admob-config.json');
  if (fs.existsSync(target)) {
    readJson(target);
    return false;
  }
  const config = { appId: '', units: { splash: '', milestone: '', floating: '', banner: '', prerecording: '' } };
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  return true;
}

/**
 * 補齊 adsense-config.json（網頁版 AdSense 顯示廣告設定）。
 * slot id 留空時，廣告元件不會渲染 <ins>，改顯示品牌佔位板。
 */
function ensureAdsenseConfig(root = path.resolve(__dirname, '..')) {
  const target = path.join(root, 'adsense-config.json');
  if (fs.existsSync(target)) {
    readJson(target);
    return false;
  }
  const slots = {};
  for (const key of ADSENSE_SLOT_KEYS) slots[key] = '';
  const config = { client: 'ca-pub-2415998114933157', slots };
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  return true;
}

module.exports = { ensureAdConfig, ensureAdsenseConfig };
if (require.main === module) {
  ensureAdConfig();
  ensureAdsenseConfig();
}
