// dev.js
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const logPath = path.join('public', 'logs', 'session.log');

// Log-Datei löschen, falls vorhanden
if (fs.existsSync(logPath)) {
  fs.unlinkSync(logPath);
  console.log('🧹 session.log wurde gelöscht.');
}

// Next.js dev server starten
exec('next dev', (err, stdout, stderr) => {
  if (err) {
    console.error(`❌ Fehler beim Start von next dev: ${err.message}`);
    return;
  }
  console.log(stdout);
  console.error(stderr);
});
