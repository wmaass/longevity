// scripts/prepare_dev.js
import fs from 'fs';
import path from 'path';

const logPath = path.join(process.cwd(), 'public', 'logs', 'session.log');

try {
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
    console.log('🧹 session.log wurde gelöscht');
  } else {
    console.log('ℹ️ Keine session.log zum Löschen gefunden.');
  }
} catch (err) {
  console.error('❌ Fehler beim Löschen von session.log:', err.message);
}
