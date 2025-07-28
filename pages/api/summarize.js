import { summarizePublication } from '../../lib/summarizeLLM.js';

export default async function handler(req, res) {
  const { pubmedId } = req.query;
  const summary = await summarizePublication(pubmedId);
  res.status(200).json({ pubmedId, summary });
}
