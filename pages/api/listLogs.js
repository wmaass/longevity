// pages/api/listLogs.js
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const logDir = path.join(process.cwd(), 'public', 'logs');
  try {
    if (!fs.existsSync(logDir)) {
      return res.status(200).json({ files: [] });
    }
    const files = fs.readdirSync(logDir)
      .filter(name => name.endsWith('.txt'))
      .sort()
      .reverse(); // Neueste zuerst
    res.status(200).json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
