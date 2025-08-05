// pages/api/saveLogs.js
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  const { logs, duration } = req.body;
  if (!Array.isArray(logs)) {
    return res.status(400).json({ error: 'Logs müssen ein Array sein' });
  }

  const logDir = path.join(process.cwd(), 'public', 'logs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `log_${timestamp}.txt`;
  const filePath = path.join(logDir, filename);

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const content = [
      `📅 Zeitstempel: ${new Date().toISOString()}`,
      `⏱️ Dauer: ${duration} Sekunden`,
      '',
      ...logs
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf-8');

    res.status(200).json({ message: '✅ Log gespeichert', filename });
  } catch (error) {
    res.status(500).json({ error: `❌ Fehler beim Speichern: ${error.message}` });
  }
}
