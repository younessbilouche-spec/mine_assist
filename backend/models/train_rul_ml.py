import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
import joblib
import json
import os
from datetime import datetime, timedelta

def train_and_predict_rul():
    print("Demarrage de l'entrainement du modele Machine Learning pour le RUL...")
    
    AMDEC = {
        "Température liquide refroidissement": 16,
        "Température sortie convertisseur": 12,
        "Température échappement Droit": 14,
        "Température échappement gauche": 14,
        "Pression huile moteur": 16,
        "Régime moteur": 14,
    }

    file_path = os.path.join(os.path.dirname(__file__), "train_results.csv")
    if not os.path.exists(file_path):
        print(f"Erreur : Fichier introuvable: {file_path}")
        return
        
    df = pd.read_csv(file_path)
    sensor_cols = [col for col in df.columns if col.startswith('CH994.P1.')]
    
    df['Target_RUL'] = np.linspace(150, 0, len(df))
    df['Target_RUL'] = df['Target_RUL'] - (df['anomaly_score'] * 10)
    df['Target_RUL'] = df['Target_RUL'].clip(lower=0)
    
    X = df[sensor_cols]
    y = df['Target_RUL']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = RandomForestRegressor(n_estimators=30, max_depth=10, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    
    derniere_ligne = X.iloc[-1:]
    predicted_rul = float(model.predict(derniere_ligne)[0])
    
    importances = model.feature_importances_
    idx_max = np.argmax(importances)
    capteur_pilote = sensor_cols[idx_max].replace("CH994.P1.", "")
    
    date_critique = (datetime.now() + timedelta(days=int(predicted_rul))).strftime('%Y-%m-%d')
    
    sensors_json = []
    for i, col in enumerate(sensor_cols):
        nom_propre = col.replace("CH994.P1.", "")
        importance = importances[i] * 100
        
        # Calcul d'un RUL spécifique pour l'affichage : le capteur pilote a le vrai RUL,
        # les autres ont un RUL proportionnel à leur importance (plus important = RUL plus court)
        if importance > 0:
            rel_importance = importance / importances[idx_max]
            s_rul = predicted_rul / rel_importance if rel_importance > 0 else 999
        else:
            s_rul = 999
            
        s_rul = min(999, round(s_rul))
        
        verdict = "stable"
        if s_rul < 7: verdict = "critique"
        elif s_rul < 21: verdict = "alerte"
        elif s_rul < 60: verdict = "surveillance"
        
        sensors_json.append({
            "nom": nom_propre,
            "rul_jours": s_rul,
            "di_pct": round(importance, 1),
            "pente_par_jour": round(importance / 10, 3),
            "verdict": verdict,
            "criticite": AMDEC.get(nom_propre, 10)
        })
        
    output_json = {
        "rul_systeme_j": round(predicted_rul),
        "date_critique": date_critique,
        "capteur_pilote": capteur_pilote,
        "capteurs": sensors_json,
        "timestamp": datetime.now().isoformat(),
        "model_type": "Random Forest Regressor (ML)"
    }
    
    json_path = os.path.join(os.path.dirname(__file__), "rul_predictions.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output_json, f, indent=4, ensure_ascii=False)
        
    print(f"Fichier json mis a jour avec succes !")

if __name__ == "__main__":
    train_and_predict_rul()
