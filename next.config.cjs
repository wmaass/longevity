// next.config.js
const fs = require('fs');
const path = require('path');

// 🧹 Log-Datei beim Start löschen
const logPath = path.join(__dirname, 'public', 'logs', 'session.log');
try {
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
    console.log('🧹 session.log gelöscht.');
  }
} catch (err) {
  console.warn('⚠️ Fehler beim Löschen der session.log:', err.message);
}

module.exports = {
  reactStrictMode: true,
};
