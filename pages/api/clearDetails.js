// pages/api/clearDetails.js
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  const detailsDir = path.join(process.cwd(), 'public', 'details');
  fs.readdir(detailsDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Fehler beim Lesen des Verzeichnisses' });
    }

    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(detailsDir, file));
      }
    }

    res.status(200).json({ success: true, deleted: files.length });
  });
}
