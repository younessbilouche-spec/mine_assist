import joblib
import os
from pathlib import Path

models_dir = Path("backend/models")
for f in models_dir.glob("*.pkl"):
    try:
        m = joblib.load(f)
        n = getattr(m, "n_features_in_", "N/A")
        names = getattr(m, "feature_names_in_", "N/A")
        print(f"{f.name}: n={n}")
        if names != "N/A":
            print(f"  First 5 names: {names[:5]}")
    except:
        pass
