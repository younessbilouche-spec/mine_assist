import os
from dotenv import load_dotenv
load_dotenv()

# Test RAG
try:
    from app.rag_engine import RAGEngine
    rag = RAGEngine()
    ctx, src = rag.build_context("salut", top_k=4, max_chars=5000)
    print("RAG OK:", ctx[:100] if ctx else "(vide)")
except Exception as e:
    print("RAG ERREUR:", e)

# Test LLM
try:
    from openai import OpenAI
    client = OpenAI(base_url="https://openrouter.ai/api/v1",
                    api_key=os.getenv("OPENROUTER_API_KEY"))
    r = client.chat.completions.create(
        model="meta-llama/llama-3.3-70b-instruct",
        messages=[{"role": "user", "content": "salut"}],
        max_tokens=50
    )
    print("LLM OK:", r.choices[0].message.content)
except Exception as e:
    print("LLM ERREUR:", e)
# Test /ask complet
try:
    from app.rag_engine import RAGEngine
    from app.pdf_image_extractor import extract_images_for_sources

    rag = RAGEngine()
    context, sources = rag.build_context("salut", top_k=4, max_chars=5000)
    print("sources:", sources)

    pdf_images = extract_images_for_sources(sources, query="salut", max_images=3)
    print("pdf_images OK:", pdf_images)

except Exception as e:
    import traceback
    traceback.print_exc()
