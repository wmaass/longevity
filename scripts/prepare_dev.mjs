// scripts/prepare_dev.mjs
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(__dirname, '..', 'public', 'logs', 'session.log');

try {
  await fs.unlink(logPath);
  console.log('🧹 session.log wurde gelöscht');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('ℹ️ session.log nicht vorhanden – nichts zu löschen');
  } else {
    console.error('❌ Fehler beim Löschen:', err.message);
  }
}
