from flask import Flask, request, jsonify
from transformers import pipeline

app = Flask(__name__)

print("🔬 Lade Modell philschmid/bio-flan-t5-small ...")
summarizer = pipeline(
    "summarization",
    model="philschmid/bio-flan-t5-small",
    device="mps"  # macOS mit Apple Silicon (M1/M2/M3) nutzt Metal Performance Shaders
)

@app.route("/summarize", methods=["POST"])
def summarize():
    data = request.get_json()
    rsid = data.get("rsid", "unknown")
    text = data.get("text", "").strip()

    if not text:
        return jsonify({ "summary": "No input text provided." }), 400

    prompt = f"""
Summarize biomedical findings related to SNP {rsid}.
Focus on:
- Disease associations
- Functional effects
- Risk alleles or odds ratios
- Affected genes or mechanisms
Limit to 150 words.

{text}
    """.strip()

    try:
        result = summarizer(prompt, max_length=256, min_length=50, do_sample=False)
        summary = result[0]["summary_text"].strip()
        return jsonify({ "summary": summary })
    except Exception as e:
        return jsonify({ "summary": f"Error: {str(e)}" }), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=7860)
