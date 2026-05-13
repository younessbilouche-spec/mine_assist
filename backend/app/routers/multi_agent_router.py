# backend/app/routers/multi_agent_router.py
import asyncio
import json
from typing import AsyncGenerator
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

multi_agent_router = APIRouter(prefix="/multi-agent", tags=["ML — Conseil Multi-Agents"])

class DiagnoseRequest(BaseModel):
    query: str

def create_event(agent: str, name: str, text: str, status: str = "typing", delay: float = 0.0) -> dict:
    return {
        "agent": agent,
        "name": name,
        "text": text,
        "status": status,
        "delay": delay
    }

async def generate_conversation(query: str) -> AsyncGenerator[str, None]:
    q = query.lower()
    
    # Choisir un scénario en fonction de la requête (pour la démo)
    if "e102" in q or "pression" in q or "hydraulique" in q:
        scenario = [
            create_event("gmao", "Agent GMAO", "J'analyse l'historique pour l'engin 994F...", "typing", 1.0),
            create_event("gmao", "Agent GMAO", "Le code E102 est apparu 3 fois dans les 6 derniers mois. Historiquement, cela a toujours conduit à un remplacement de la pompe de levage principale au bout de 50h de tolérance.", "done", 2.0),
            
            create_event("sensors", "Agent Télémétrie", "Vérification des données temps réel...", "typing", 0.5),
            create_event("sensors", "Agent Télémétrie", "Je confirme. La pression de refoulement de la pompe (Capteur P-102) a chuté de 15% par rapport à sa baseline nominale au cours des 48 dernières heures. La température du circuit est normale.", "done", 2.5),
            
            create_event("oil", "Agent Fiabilité (Huiles)", "Extraction du dernier rapport d'analyse SOS...", "typing", 0.5),
            create_event("oil", "Agent Fiabilité (Huiles)", "Attention : le rapport d'huile hydraulique d'il y a 3 jours montre une concentration en Fer (Fe) de 18 ppm (+5 ppm par rapport à la moyenne). Cela indique une usure mécanique interne en cours.", "done", 3.0),
            
            create_event("gmao", "Agent GMAO", "Vu l'usure interne (Fer) et la chute de pression, l'intervention est urgente. La pièce n'a que 8000h, c'est une usure prématurée.", "done", 1.5),
            
            create_event("consensus", "Système IA", "Génération du consensus...", "typing", 1.0),
            create_event("consensus", "Système IA", "🚨 **Consensus Atteint : Remplacement critique**\n\n**Diagnostic :** Usure interne prématurée de la pompe hydraulique de levage (chute de pression + présence de fer).\n**Action prescrite :** \n1. Arrêter la machine à la fin du poste actuel.\n2. Remplacer la pompe de levage (Réf: CAT-PMP-994-01).\n3. Procéder à une vidange et un filtrage (bypass) du circuit hydraulique pour éliminer les limailles.\n\n**Probabilité de casse imminente :** 92%", "done", 3.0),
        ]
    else:
        # Scénario par défaut (Moteur / Surchauffe)
        scenario = [
            create_event("sensors", "Agent Télémétrie", "Analyse de la signature de télémétrie en cours...", "typing", 1.0),
            create_event("sensors", "Agent Télémétrie", "Je détecte une élévation graduelle de la température du liquide de refroidissement (Capteur T-04) depuis 5 jours, accompagnée d'une légère baisse de puissance moteur dans les rampes.", "done", 2.5),
            
            create_event("gmao", "Agent GMAO", "Recherche des interventions similaires...", "typing", 0.5),
            create_event("gmao", "Agent GMAO", "Le dernier nettoyage du radiateur date de 1200 heures. La recommandation constructeur est de 1000 heures. Il est fort probable que le faisceau soit colmaté par la poussière de phosphate.", "done", 2.5),
            
            create_event("oil", "Agent Fiabilité (Huiles)", "Vérification des fluides...", "typing", 0.5),
            create_event("oil", "Agent Fiabilité (Huiles)", "L'analyse d'huile moteur est parfaitement normale. Pas de glycol dans l'huile, ce qui écarte l'hypothèse d'une culasse fissurée ou d'un joint défectueux. C'est bien un problème de flux thermique externe.", "done", 3.0),
            
            create_event("consensus", "Système IA", "Génération du consensus...", "typing", 1.0),
            create_event("consensus", "Système IA", "✅ **Consensus Atteint : Intervention mineure requise**\n\n**Diagnostic :** Surchauffe moteur due au colmatage externe du radiateur (poussières de phosphate).\n**Action prescrite :**\n1. Planifier un lavage haute pression du faisceau radiateur lors du prochain arrêt planifié (PM).\n2. Vérifier la tension de la courroie du ventilateur par précaution.\n\n**Gravité :** Faible (aucune usure interne détectée).", "done", 2.5),
        ]

    for event in scenario:
        await asyncio.sleep(event["delay"])
        yield f"data: {json.dumps(event)}\n\n"
        
    yield "event: close\ndata: {}\n\n"

@multi_agent_router.post("/simulate")
async def simulate_conversation(req: DiagnoseRequest):
    return StreamingResponse(
        generate_conversation(req.query),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )
