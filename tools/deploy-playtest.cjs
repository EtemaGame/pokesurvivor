'use strict';
// Única vía de despliegue recomendada: exige proyecto ps-test-* explícito.
// NUNCA usa el proyecto predeterminado del repositorio original.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const local = path.join(root, 'playtest-config.local.json');
if (!fs.existsSync(local))
  throw Error('Crea playtest-config.local.json con la configuración WEB de un proyecto Firebase NUEVO ps-test-*.');
const config = JSON.parse(fs.readFileSync(local, 'utf8'));
if (!/^ps-test-[a-z0-9-]{4,24}$/.test(config.projectId || '') ||
    config.authDomain !== config.projectId + '.firebaseapp.com')
  throw Error('DEPLOY BLOQUEADO: el destino no es el Firebase de pruebas.');
console.log('Destino protegido: ' + config.projectId + '.web.app');
cp.execFileSync(process.execPath, ['tools/prepare-playtest.cjs', '--require-config'], {
  cwd: root, stdio: 'inherit'
});
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
cp.execFileSync(npx, ['--yes', 'firebase-tools@14.12.0', 'deploy',
  '--project', config.projectId,
  '--config', 'firebase.playtest.json',
  '--only', 'hosting,firestore,database'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  // El laboratorio incluye miles de sprites: limitar subidas paralelas evita
  // los errores de socket de Hosting con conexiones/VMs saturadas.
  env: { ...process.env, FIREBASE_HOSTING_UPLOAD_CONCURRENCY: '10' }
});
console.log('Web del grupo: https://' + config.projectId + '.web.app/');
