import fs from 'fs';
import path from 'path';


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST erlaubt' });
    return;
  }

  const { message, filename = 'session.log' } = req.body;
  if (!message) {
    res.status(400).json({ error: 'Keine Nachricht angegeben' });
    return;
  }
  
  console.log('[API] Log empfangen:', message);


  const logDir = path.join(process.cwd(), 'public', 'logs');
  const logPath = path.join(logDir, filename);

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    fs.appendFileSync(logPath, message + '\n', 'utf-8');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Fehler beim Schreiben der Log-Datei:', err);
    res.status(500).json({ error: err.message });
  }
}
