// summarize_paper_local.js
import fs from 'fs';
import path from 'path';
import { pipeline } from '@xenova/transformers';

// Load a summarization-capable open-source LLM (runs in Node.js via transformers.js)
let summarizer;

// Initialize model (lazy-loaded)
async function initModel() {
  if (!summarizer) {
    summarizer = await pipeline('text-generation', 'Xenova/llama-3-8b-instruct'); 
    // Alternative smaller models for speed:
    // summarizer = await pipeline('summarization', 'facebook/bart-large-cnn');
  }
  return summarizer;
}

/**
 * Summarize the paper with respect to an EFO trait and SNP.
 */
async function summarizePaper(text, efo, snp) {
  const model = await initModel();

  const prompt = `
Summarize the findings in the following research text *specifically regarding*:
- The trait or disease: ${efo}
- The genetic variant (SNP): ${snp}

Include only relevant associations, effect sizes, risk factors, or functional impacts.
Keep it concise (max 200 words).

Text:
${text.slice(0, 4000)}
`;

  const output = await model(prompt, { max_new_tokens: 300, temperature: 0.2 });
  return output[0].generated_text.trim();
}

/**
 * Process all papers for a given EFO and SNP.
 */
async function processSummaries(efo, snp) {
  const PAPERS_DIR = './papers_text';
  const OUTPUT_DIR = './summaries';
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(PAPERS_DIR).filter(f => f.endsWith('.txt'));

  for (const file of files) {
    const paperPath = path.join(PAPERS_DIR, file);
    const text = fs.readFileSync(paperPath, 'utf8');

    console.log(`Summarizing ${file} for ${efo}, ${snp}...`);
    try {
      const summary = await summarizePaper(text, efo, snp);
      const outPath = path.join(
        OUTPUT_DIR,
        `${file.replace('.txt', '')}_${efo}_${snp}.summary.txt`
      );
      fs.writeFileSync(outPath, summary, 'utf8');
      console.log(`Saved summary: ${outPath}`);
    } catch (err) {
      console.error(`Failed to summarize ${file}: ${err.message}`);
    }
  }
}

// CLI: node summarize_paper_local.js EFO_0001645 rs7412
if (process.argv.length >= 4) {
  const efo = process.argv[2];
  const snp = process.argv[3];
  processSummaries(efo, snp);
} else {
  console.error('Usage: node summarize_paper_local.js <EFO_ID> <SNP_ID>');
}
