const fs = require('node:fs');
const path = require('node:path');
function ensureAdConfig(root = path.resolve(__dirname, '..')) {
  const target = path.join(root, 'admob-config.json');
  if (fs.existsSync(target)) {
    JSON.parse(fs.readFileSync(target, 'utf8'));
    return false;
  }
  const config = { appId: '', units: { splash: '', milestone: '', floating: '', banner: '', prerecording: '' } };
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  return true;
}
module.exports = { ensureAdConfig };
if (require.main === module) ensureAdConfig();
