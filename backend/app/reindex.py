"""
reindex.py — À lancer UNE FOIS après correction du rag_engine.py
Place ce fichier à la racine de ton backend (à côté de api.py) et exécute :

    python reindex.py

Ce script :
  1. Supprime la collection ChromaDB existante (anciens chunks mal indexés)
  2. Recharge et réindexe tous les documents depuis zéro
  3. Affiche un résumé de ce qui a été indexé par source
"""

import sys
from pathlib import Path

# ── Ajuste si ton backend est dans un sous-dossier (ex: backend/) ────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.rag_engine import RAGEngine, CHROMA_PATH, DATA_DIR
import chromadb

# ── 1. Suppression de la collection existante ─────────────────────────────────
print("🗑️  Suppression de l'ancienne collection ChromaDB...")
try:
    client = chromadb.PersistentClient(path=str(CHROMA_PATH))
    client.delete_collection("mine_assist")
    print("✅ Collection supprimée.")
except Exception as e:
    print(f"ℹ️  Rien à supprimer : {e}")

# ── 2. Réindexation complète ──────────────────────────────────────────────────
print("\n🔄 Démarrage de l'indexation complète...\n")
rag = RAGEngine()
result = rag.index_all()

# ── 3. Rapport ────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("📊 RAPPORT D'INDEXATION")
print("="*60)

from collections import Counter
type_counts = Counter(m["type"] for m in rag.metadatas)
source_counts = Counter(rag.sources)

print(f"\n  Total chunks indexés : {len(rag.documents)}")
print(f"\n  Par type :")
for t, n in sorted(type_counts.items()):
    print(f"    {t:10s} : {n} chunks")

print(f"\n  Par fichier source :")
for src, n in sorted(source_counts.items(), key=lambda x: -x[1]):
    print(f"    {n:5d} chunks  ←  {src}")

# ── 4. Vérification rapide : recherche "température refroidissement" ──────────
print("\n" + "="*60)
print("🔍 TEST RAPIDE — requête : 'température liquide refroidissement'")
print("="*60)
context, sources = rag.build_context(
    query="température liquide refroidissement 994F1",
    top_k=5,
    max_chars=2000,
)
if context.strip():
    print(f"\n✅ Contexte trouvé ({len(context)} caractères)\n")
    print(context[:800] + "..." if len(context) > 800 else context)
    print(f"\nSources : {sources}")
else:
    print("\n❌ Aucun contexte trouvé — vérifier les chemins et les fichiers dans data/gmao/capteurs/")

print("\n✅ Réindexation terminée. Redémarre ton serveur FastAPI.")
