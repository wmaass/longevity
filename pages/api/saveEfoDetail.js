// pages/api/saveEfoDetail.js
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { efoId, detail } = req.body;

  if (!efoId || !detail) {
    return res.status(400).json({ error: 'efoId and detail required' });
  }

  try {
    const dirPath = path.join(process.cwd(), 'public', 'details');
    const filePath = path.join(dirPath, `${efoId}.json`);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Bestehende Daten lesen, wenn vorhanden
    let existing = [];
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      try {
        existing = JSON.parse(content);
      } catch (_) {
        existing = [];
      }
    }

    existing.push(detail);

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
