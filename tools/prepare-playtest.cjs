'use strict';
/* Prepara solo archivos estáticos del laboratorio. Nunca incluye las credenciales
 * del juego oficial ni ejecuta un deploy de forma implícita.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist-test');
const local = path.join(root, 'playtest-config.local.json');

function validate(raw) {
  const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!cfg || !/^ps-test-[a-z0-9-]{4,24}$/.test(cfg.projectId || ''))
    throw Error('Seguridad: el ID de Firebase debe ser un proyecto nuevo ps-test-...');
  if (!cfg.apiKey || !cfg.appId || cfg.authDomain !== cfg.projectId + '.firebaseapp.com')
    throw Error('Seguridad: configura los datos web de TU Firebase de pruebas.');
  const u = new URL(cfg.databaseURL);
  if (u.protocol !== 'https:' || !u.hostname.startsWith(cfg.projectId + '-') ||
      !u.hostname.endsWith('.firebasedatabase.app'))
    throw Error('Seguridad: la Realtime Database debe pertenecer al mismo proyecto de prueba.');
  return cfg;
}
const fromEnv = process.env.PS_TEST_FIREBASE_CONFIG;
const raw = fromEnv || (fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null);
const config = raw ? validate(raw) : null;
if (process.argv.includes('--require-config') && !config)
  throw Error('Falta playtest-config.local.json. NO se publicará el juego sin un Firebase separado.');

cp.execFileSync(process.execPath, ['tools/build.js', '--sin-seo'], { cwd: root, stdio: 'inherit' });
cp.execFileSync(process.execPath, ['tools/export_data.js'], { cwd: root, stdio: 'inherit' });
cp.execFileSync('python3', ['tools/make_seo_pages.py'], { cwd: root, stdio: 'inherit' });

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const folder of ['assets', 'css'])
  fs.cpSync(path.join(root, folder), path.join(output, folder), { recursive: true });
for (const file of ['index.html', 'manifest.webmanifest', 'favicon.ico', 'sw.js',
                     'version.json', 'LICENSE', 'LICENSE-NONCOMMERCIAL.md', 'CREDITS.md']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.mkdirSync(path.join(output, 'js'));
fs.copyFileSync(path.join(root, 'js/app.min.js'), path.join(output, 'js/app.min.js'));
fs.mkdirSync(path.join(output, 'en'));
fs.copyFileSync(path.join(root, 'en/index.html'), path.join(output, 'en/index.html'));
fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(output, 'sandbox-config.js'),
  '/* Firebase del laboratorio (identificadores web públicos, no secretos) */\n' +
  'window.PS_TEST_FIREBASE_CONFIG = ' + JSON.stringify(config) + ';\n');
console.log(config
  ? 'Web de prueba preparada para ' + config.projectId
  : 'Preview sin Firebase: solo modo local. Para cooperativo configura tu proyecto ps-test-*.');
module.exports = { validate };
