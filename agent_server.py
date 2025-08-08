# agent_server.py
import os, json, requests
from fastapi import FastAPI
from pydantic import BaseModel
from smolagents import CodeAgent, tool

# --- Try to load Ollama Model (may be unavailable) ---
try:
    from smolagents.models import OllamaModel
except Exception:
    OllamaModel = None

# --- Fallback: local transformers pipeline for summaries ---
from transformers import pipeline
def get_local_summarizer():
    # light summarizer; requires transformers + torch installed
    return pipeline("summarization", model="sshleifer/distilbart-cnn-6-6")

# ---- Health check for Ollama ----
def is_ollama_up():
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=2)
        return r.ok
    except Exception:
        return False

# ---- Domain config ----
CARDIO_EFOS = [
    "EFO_0004541","EFO_0004611","EFO_0004612","EFO_0004530",
    "EFO_0001645","EFO_0006335","EFO_0004574","EFO_0004458","EFO_0006336"
]

# ---- Tools ----
@tool
def validate_input(genome_text: str) -> dict:
    """
    Validate and parse 23andMe text.

    Args:
        genome_text (str): Full text of a 23andMe raw data file
            (tab-delimited: rsid, chromosome, position, genotype).

    Returns:
        dict: {'variants': list, 'count': int}
    """
    if not genome_text or len(genome_text) < 100:
        raise ValueError("Genome text seems too short.")
    variants = [{"rsid": "rs123", "genotype": "AA"}]  # stub
    return {"variants": variants, "count": len(variants)}

@tool
def propose_efos(variants: list) -> dict:
    """
    Return relevant EFO IDs for cardiometabolic analysis.

    Args:
        variants (list): Parsed variant dicts from validate_input.

    Returns:
        dict: {'efo_ids': list[str]}
    """
    return {"efo_ids": CARDIO_EFOS}

@tool
def compute_all_prs(efo_ids: list, variants: list) -> dict:
    """
    Compute PRS for provided EFOs using existing logic.

    Args:
        efo_ids (list): EFO identifiers to score (e.g., ['EFO_0004541', ...]).
        variants (list): Parsed variants (from validate_input).

    Returns:
        dict: {'scores': list[dict]} with fields like efoId, trait, id (PGS id),
              percentile, name/label, etc.
    """
    # Stub demo row; replace with your real computation
    scores = [
        {"efoId": efo_ids[0], "trait": "HbA1c measurement",
         "id": "PGS000127", "name": "Inouye 2018", "percentile": 91.2}
    ]
    return {"scores": scores}

@tool
def summarize(scores: list) -> dict:
    """
    Summarize results using Ollama 'mediphi-lite' if available,
    otherwise fallback to local DistilBART.

    Args:
        scores (list): PRS result dicts (from compute_all_prs).

    Returns:
        dict: {'summary': str}
    """
    text = json.dumps(scores, indent=2)

    # Try Ollama first
    if OllamaModel is not None and is_ollama_up():
        try:
            model = OllamaModel(model_id=os.getenv("OLLAMA_MODEL", "mediphi-lite"))
            summary = model.generate(
                f"Summarize the following PRS results for a medical professional:\n\n{text}"
            )
            return {"summary": summary}
        except Exception as e:
            print(f"[WARN] Ollama summarization failed: {e}")

    # Fallback to local transformers
    summarizer = get_local_summarizer()
    out = summarizer(text, max_length=100, min_length=25, do_sample=False)
    summary = (out[0]["summary_text"] if out and isinstance(out, list) else "").strip()
    return {"summary": summary or "Keine Zusammenfassung verfügbar."}

# ---- Pick main LLM for reasoning between tools (optional) ----
def pick_model():
    if OllamaModel is not None and is_ollama_up():
        return OllamaModel(model_id=os.getenv("OLLAMA_MODEL", "mediphi-lite"))
    return None  # signal fallback to deterministic pipeline

model = pick_model()

# Create agent only if a model is available
agent = None
if model is not None:
    try:
        agent = CodeAgent(
            tools=[validate_input, propose_efos, compute_all_prs, summarize],
            model=model,
            max_steps=6,
        )
        print("[agent] Using Ollama model for reasoning.")
    except TypeError:
        # some smolagents versions use max_iterations
        agent = CodeAgent(
            tools=[validate_input, propose_efos, compute_all_prs, summarize],
            model=model,
            max_iterations=6,
        )
        print("[agent] Using Ollama model for reasoning (max_iterations).")
else:
    print("[agent] No LLM available; using deterministic tool chain.")

# ---- Deterministic pipeline (no LLM) ----
def run_without_model(genome_text: str, goal: str):
    step1 = validate_input(genome_text=genome_text)
    variants = step1["variants"]

    step2 = propose_efos(variants=variants)
    efo_ids = step2["efo_ids"]

    step3 = compute_all_prs(efo_ids=efo_ids, variants=variants)
    scores = step3["scores"]

    step4 = summarize(scores=scores)
    return {"scores": scores, "summary": step4["summary"]}

# ---- FastAPI app ----
class RunReq(BaseModel):
    genomeText: str
    goal: str | None = "Analysiere kardiometabolische Risiken"

app = FastAPI()

@app.post("/run")
def run(req: RunReq):
    if agent is None:
        return run_without_model(req.genomeText, req.goal)

    prompt = (
        f"Goal: {req.goal}\n"
        "Call tools in exactly this order and pass outputs between them:\n"
        "1) validate_input(genome_text)\n"
        "2) propose_efos(variants)\n"
        "3) compute_all_prs(efo_ids, variants)\n"
        "4) summarize(scores)\n"
        "Return ONLY a compact JSON object with keys `scores` (list) and `summary` (string).\n\n"
        f"genome_text:\n{req.genomeText[:200000]}\n"
    )
    out = agent.run(prompt)
    try:
        if isinstance(out, dict):
            return out
        return json.loads(out)
    except Exception:
        return {"summary": str(out), "scores": []}
