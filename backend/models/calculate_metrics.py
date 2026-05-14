import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split, learning_curve
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score, confusion_matrix, ConfusionMatrixDisplay
import matplotlib.pyplot as plt
import os

def evaluate_models():
    # Création d'un dossier pour les graphiques si nécessaire
    assets_dir = os.path.join(os.path.dirname(__file__), "assets_report")
    if not os.path.exists(assets_dir):
        os.makedirs(assets_dir)

    file_path = os.path.join(os.path.dirname(__file__), "train_results.csv")
    if not os.path.exists(file_path):
        print(f"Erreur : Fichier {file_path} non trouvé.")
        return

    df = pd.read_csv(file_path)
    
    print("="*50)
    print("1. EVALUATION DU MODELE RANDOM FOREST (RUL)")
    print("="*50)
    
    sensor_cols = [col for col in df.columns if col.startswith('CH994.P1.')]
    df['Target_RUL'] = np.linspace(150, 0, len(df))
    df['Target_RUL'] = df['Target_RUL'] - (df['anomaly_score'] * 10)
    df['Target_RUL'] = df['Target_RUL'].clip(lower=0)
    
    X = df[sensor_cols]
    y = df['Target_RUL']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # On utilise un petit échantillon pour la courbe d'apprentissage pour que ce soit rapide
    model = RandomForestRegressor(n_estimators=10, max_depth=5, random_state=42, n_jobs=-1)
    
    # --- COURBE D'APPRENTISSAGE ---
    print("Generation de la courbe d'apprentissage...")
    train_sizes, train_scores, test_scores = learning_curve(
        model, X, y, cv=3, n_jobs=-1, train_sizes=np.linspace(0.1, 1.0, 5)
    )
    
    plt.figure(figsize=(10, 6))
    plt.plot(train_sizes, np.mean(train_scores, axis=1), 'o-', color="green", label="Score Entrainement")
    plt.plot(train_sizes, np.mean(test_scores, axis=1), 's-', color="orange", label="Score Validation")
    plt.title("Courbe d'apprentissage - Random Forest RUL")
    plt.xlabel("Taille de l'echantillon")
    plt.ylabel("R2 Score")
    plt.legend()
    plt.grid(True)
    plt.savefig(os.path.join(assets_dir, "learning_curve_rul.png"))
    plt.close()
    print(f"OK : Courbe d'apprentissage sauvegardee dans assets_report/")

    print("\n"+"="*50)
    print("2. EVALUATION ISOLATION FOREST")
    print("="*50)
    
    if 'is_anomaly' in df.columns:
        # Simulation des prédictions basée sur le score d'anomalie existant
        seuil = df['anomaly_score'].quantile(0.95) # Top 5%
        df['predicted_anomaly'] = (df['anomaly_score'] > seuil).astype(int)
        
        # --- MATRICE DE CONFUSION ---
        cm = confusion_matrix(df['is_anomaly'], df['predicted_anomaly'])
        
        plt.figure(figsize=(8, 6))
        disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=['Normal', 'Anomalie'])
        disp.plot(cmap=plt.cm.Greens, values_format='d')
        plt.title("Matrice de Confusion - Isolation Forest")
        plt.savefig(os.path.join(assets_dir, "confusion_matrix_isolation.png"))
        plt.close()
        print(f"OK : Matrice de confusion sauvegardee dans assets_report/")
    else:
        print("Colonne 'is_anomaly' manquante pour la matrice de confusion.")

if __name__ == "__main__":
    evaluate_models()
