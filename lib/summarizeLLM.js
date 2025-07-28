import { LlamaModel, LlamaContext, LlamaChatSession } from 'node-llama-cpp';
import fetch from 'node-fetch';
import config from '../config.json' assert { type: 'json' };

const model = new LlamaModel({ modelPath: config.modelPath, gpu: config.gpu });
const context = new LlamaContext({ model });
const session = new LlamaChatSession({ context });

export async function summarizePublication(pubmedId) {
  const abstract = await fetchAbstract(pubmedId);
  const prompt = `Fasse diese Studie (PubMed ${pubmedId}) für Laien zusammen:\n\n${abstract}`;
  return await session.prompt(prompt);
}

async function fetchAbstract(pubmedId) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pubmedId}&rettype=abstract&retmode=text`;
  const res = await fetch(url);
  return await res.text();
}
