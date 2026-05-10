# Correction upload Fichiers Capteurs — format Excel 994F1

## Problème

Ton fichier `994f1 Février.xlsx` est un export diagnostic long, pas un tableau capteurs déjà pivoté.

Il contient les colonnes :

```text
Engin
Paramètres Diagnostic
Code
Heure
Valeur minimale
Valeur moyenne
Valeur maximale
Unité de mesure
Fonctionnement du capteur
```

Avant correction, le backend cherchait une colonne `Date` et des colonnes directes comme `Regime_moteur`, `Pression_huile`, etc. Donc il lançait l’erreur `Date`.

## Correction faite

Fichier modifié :

```text
backend/app/ocp/utils/data_processing.py
```

Le parser accepte maintenant ce format réel :

- détecte automatiquement la ligne d’en-tête `Paramètres Diagnostic / Heure / Valeur moyenne` ;
- utilise `Heure` comme `Date` ;
- transforme le fichier long en tableau capteurs large ;
- mappe automatiquement les paramètres vers les colonnes internes :

```text
CH994.P1.Régime moteur                         -> Regime_moteur
CH994.P1.Pression huile moteur                 -> Pression_huile
CH994.P1.Température liquide refroidissement   -> Temp_refroid
CH994.P2.Régime sortie convertisseur           -> Regime_conv
CH994.P1.Température sortie convertisseur      -> Temp_conv
CH994.P1.Température huile direction           -> Temp_huile_dir
```

## Test avec ton fichier

Fichier testé : `994f1 Février.xlsx`

Résultat upload backend :

```json
{
  "success": true,
  "filename": "994f1 Février.xlsx",
  "nb_points": 9696,
  "date_debut": "2025-02-01 00:01:17",
  "date_fin": "2025-02-28 23:51:08",
  "label_counts": {
    "Normal": 5032,
    "Pre-alerte": 4221,
    "Anomalie": 233,
    "Critique": 210
  }
}
```

## Vérifications réalisées

```bash
python -m py_compile backend/app/ocp/utils/data_processing.py backend/app/ocp/routers/upload.py
npm run build
npm run test -- --run
npm run lint
```

Résultats :

- Upload backend du fichier fourni : OK
- Build frontend : OK
- Tests Vitest : OK, 6 tests passés
- Lint : OK, 0 erreur

## Application

Dézipper à la racine du projet :

```bash
unzip mine_assist_upload_capteurs_994f1_fix.zip -d mine_assist
```

Puis redémarrer le backend, et réessayer l’upload sur la page `Fichiers Capteurs`.
