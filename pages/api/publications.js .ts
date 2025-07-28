import { fetchPublicationsForStroke } from '../../lib/fetchPublications.js';

export default async function handler(req, res) {
  const pubs = await fetchPublicationsForStroke();
  res.status(200).json(pubs);
}
