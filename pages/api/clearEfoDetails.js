import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  const dir = path.join(process.cwd(), 'public/details');
  console.log('🧨 clearEfoDetails API aufgerufen');
  console.log('📁 Zielverzeichnis:', dir);

  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      let count = 0;
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(dir, file));
          count++;
        }
      }
      console.log(`🧹 ${count} JSON-Dateien gelöscht`);
      return res.status(200).json({ message: `✅ ${count} JSON-Dateien gelöscht.` });
    } else {
      console.log('📁 Ordner nicht vorhanden – kein Löschen nötig');
      return res.status(200).json({ message: '📁 Ordner war leer oder existierte nicht.' });
    }
  } catch (err) {
    console.error('❌ Fehler beim Löschen:', err.message);
    return res.status(500).json({ error: `Fehler beim Löschen: ${err.message}` });
  }
}
