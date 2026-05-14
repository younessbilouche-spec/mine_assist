# ═══════════════════════════════════════════════════════════════════════════
# MineAssist — Pipeline ML en R
# CAT 994F · OCP Benguerir · PFE Génie Industriel
#
# Ce script remplace pipeline_ml_FINAL_v5.py
# Il produit les mêmes fichiers de sortie (JSON + CSV) lus par le backend.
#
# Packages nécessaires (installer une seule fois) :
#   install.packages(c("readxl","tidyverse","isotree","ranger","jsonlite","lubridate"))
#
# Usage :
#   Rscript mineassist_ml.R
# ═══════════════════════════════════════════════════════════════════════════

library(readxl)
library(tidyverse)
library(lubridate)
library(isotree)    # Isolation Forest
library(ranger)     # Random Forest rapide
library(jsonlite)

cat("═══════════════════════════════════════════════════════\n")
cat("  MINEASSIST — Pipeline ML en R\n")
cat("  CAT 994F · OCP Benguerir\n")
cat("═══════════════════════════════════════════════════════\n\n")

# ─── Chemins ───────────────────────────────────────────────────────────────
DIR_CAPTEURS <- "./data/capteurs"
GMAO_PATH    <- "./data/gmao_anomalies.xlsx"
MODELS_DIR   <- "./models_R"
dir.create(MODELS_DIR, showWarnings = FALSE)

# ─── Paramètres ────────────────────────────────────────────────────────────
CAPTEURS_CIBLES <- c(
  "Température liquide refroidissement",
  "Température échappement Droit",
  "Température échappement gauche",
  "Température sortie convertisseur",
  "Pression huile moteur",
  "Régime moteur",
  "Température huile direction",
  "Température huile freinage",
  "Pression d'air au réservoir",
  "Température essieux arrière",
  "Pression embrayage impeller"
)

SEUILS <- list(
  "Température liquide refroidissement" = list(max = 107, alerte = 95),
  "Température échappement Droit"       = list(max = 600, alerte = 540),
  "Température échappement gauche"      = list(max = 600, alerte = 540),
  "Température sortie convertisseur"    = list(max = 129, alerte = 115),
  "Température huile direction"         = list(max =  70, alerte =  63),
  "Température huile freinage"          = list(max =  70, alerte =  63),
  "Température essieux arrière"         = list(max =  90, alerte =  80),
  "Pression huile moteur"               = list(min = 2.5, alerte_min = 3),
  "Pression d'air au réservoir"         = list(min = 400, alerte_min = 500),
  "Pression embrayage impeller"         = list(min = 1.5, alerte_min = 2),
  "Régime moteur"                       = list(max = 2100, alerte = 1900)
)


# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 1 : CHARGEMENT DES DONNÉES
# ═══════════════════════════════════════════════════════════════════════════

cat("📂 Chargement des capteurs...\n")

fichiers <- list.files(DIR_CAPTEURS, pattern = "\\.xlsx$|\\.xls$",
                       full.names = TRUE)

if (length(fichiers) == 0) stop("Aucun fichier dans ", DIR_CAPTEURS)

df_capteurs <- map_dfr(fichiers, function(f) {
  tryCatch({
    df <- read_excel(f, skip = 8, col_names = c(
      "Engin", "Parametre", "Code", "Heure",
      "Val_min", "Val_moy", "Val_max", "Unite", "Capteur_OK"
    ))
    df <- df %>%
      mutate(
        Parametre = str_replace(Parametre, "^CH\\d+\\.P\\d+\\.", ""),
        Parametre = str_trim(Parametre),
        Heure     = as_datetime(Heure),
        Val_moy   = as.numeric(Val_moy),
        Val_min   = as.numeric(Val_min),
        Val_max   = as.numeric(Val_max)
      ) %>%
      filter(!is.na(Heure), Parametre %in% CAPTEURS_CIBLES)
    cat("  ✅", basename(f), "-", nrow(df), "lignes\n")
    df
  }, error = function(e) {
    cat("  ⚠️ ", basename(f), ":", conditionMessage(e), "\n")
    NULL
  })
})

df_capteurs <- df_capteurs %>% arrange(Heure)
cat("  →", nrow(df_capteurs), "mesures |",
    format(min(df_capteurs$Heure), "%Y-%m-%d"), "→",
    format(max(df_capteurs$Heure), "%Y-%m-%d"), "\n\n")


# ─── Chargement GMAO ───────────────────────────────────────────────────────
cat("📋 Chargement GMAO...\n")

df_gmao <- read_excel(GMAO_PATH) %>%
  rename(
    timestamp      = `Date de l'anomalie`,
    code_anomalie  = `Code d'anomalie`,
    gravite        = Gravité
  ) %>%
  mutate(timestamp = as_datetime(timestamp)) %>%
  filter(!is.na(timestamp)) %>%
  select(timestamp, code_anomalie, gravite)

cat("  →", nrow(df_gmao), "anomalies |",
    "Gravité 1:", sum(df_gmao$gravite == 1),
    "| 2:", sum(df_gmao$gravite == 2),
    "| 3:", sum(df_gmao$gravite == 3), "\n\n")


# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 2 : PIVOT ET FEATURE ENGINEERING
# ═══════════════════════════════════════════════════════════════════════════

cat("🔄 Pivot des capteurs (format large)...\n")

# Arrondir à 5 minutes et pivoter
pivot <- df_capteurs %>%
  mutate(ts = floor_date(Heure, "5 minutes")) %>%
  group_by(ts, Parametre) %>%
  summarise(Val_moy = mean(Val_moy, na.rm = TRUE), .groups = "drop") %>%
  pivot_wider(names_from = Parametre, values_from = Val_moy) %>%
  arrange(ts)

# Garder seulement les capteurs disponibles
cols_dispo <- intersect(CAPTEURS_CIBLES, names(pivot))
pivot <- pivot %>% select(ts, all_of(cols_dispo))

cat("  →", nrow(pivot), "timestamps |", length(cols_dispo), "capteurs\n")

# Interpolation des NaN (valeurs manquantes)
pivot <- pivot %>%
  mutate(across(all_of(cols_dispo), ~ zoo::na.approx(.x, na.rm = FALSE))) %>%
  drop_na(all_of(cols_dispo[1:3]))  # garder si au moins 3 capteurs ont des données

cat("⚙️  Features glissantes (fenêtre 1h = 12 points)...\n")

FENETRE <- 12  # 12 × 5 min = 1 heure

# Fonction fenêtre glissante
rolling_pente <- function(x) {
  n <- length(x)
  if (n < 3 || sum(!is.na(x)) < 3) return(0)
  tryCatch(coef(lm(x ~ seq_len(n)))[2], error = function(e) 0)
}

# Créer les features pour chaque capteur
feature_list <- map(cols_dispo, function(col) {
  safe_col <- col %>%
    str_replace_all(" ", "_") %>%
    str_replace_all("'", "") %>%
    str_replace_all("°", "deg")

  x <- pivot[[col]]

  tibble(
    "{safe_col}__val"   := x,
    "{safe_col}__mean"  := slider::slide_dbl(x, mean, .before = FENETRE-1, .complete = FALSE, na.rm = TRUE),
    "{safe_col}__std"   := slider::slide_dbl(x, sd,   .before = FENETRE-1, .complete = FALSE, na.rm = TRUE),
    "{safe_col}__max"   := slider::slide_dbl(x, max,  .before = FENETRE-1, .complete = FALSE, na.rm = TRUE),
    "{safe_col}__range" := slider::slide_dbl(x, function(v) diff(range(v, na.rm=TRUE)),
                                              .before = FENETRE-1, .complete = FALSE),
    "{safe_col}__slope" := slider::slide_dbl(x, rolling_pente,
                                              .before = FENETRE-1, .complete = FALSE)
  )
})

features <- bind_cols(
  pivot %>% select(ts),
  bind_cols(feature_list)
) %>%
  mutate(across(where(is.numeric), ~ replace_na(.x, median(.x, na.rm = TRUE))))

cat("  →", nrow(features), "points |", ncol(features) - 1, "features\n\n")


# ═══════════════════════════════════════════════════════════════════════════
# MODULE 1 : HEALTH SCORE
# ═══════════════════════════════════════════════════════════════════════════

cat("💚 [1/3] Health Score industriel...\n")

calculer_health_score <- function(row_pivot) {
  score <- 100.0

  for (capteur in names(SEUILS)) {
    if (!capteur %in% names(row_pivot)) next
    val <- row_pivot[[capteur]]
    if (is.na(val)) next

    cfg <- SEUILS[[capteur]]

    if (!is.null(cfg$max)) {
      alerte <- cfg$alerte
      maxi   <- cfg$max
      if (val > maxi) {
        penalite <- min(100, 40 + (val - maxi) / maxi * 60)
      } else if (val > alerte) {
        penalite <- (val - alerte) / (maxi - alerte) * 40
      } else {
        penalite <- 0
      }
    } else if (!is.null(cfg$min)) {
      alerte <- cfg$alerte_min
      mini   <- cfg$min
      if (val < mini) {
        penalite <- min(100, 40 + (mini - val) / mini * 60)
      } else if (val < alerte) {
        penalite <- (alerte - val) / (alerte - mini) * 40
      } else {
        penalite <- 0
      }
    } else {
      penalite <- 0
    }

    score <- max(0, score - penalite)
  }
  return(round(score, 1))
}

# Appliquer sur tout le pivot
health_scores <- map_dbl(seq_len(nrow(pivot)), function(i) {
  calculer_health_score(as.list(pivot[i, cols_dispo]))
})

pivot$health_score <- health_scores

cat("  ✅ Health Score calculé\n")
cat("     Moyenne :", round(mean(health_scores, na.rm=TRUE), 1), "/ 100\n")
cat("     % temps surveillance (<70) :",
    round(mean(health_scores < 70, na.rm=TRUE) * 100, 1), "%\n")
cat("     % temps critique (<30)     :",
    round(mean(health_scores < 30, na.rm=TRUE) * 100, 1), "%\n\n")


# ═══════════════════════════════════════════════════════════════════════════
# MODULE 2 : ISOLATION FOREST
# ═══════════════════════════════════════════════════════════════════════════

cat("🌲 [2/3] Isolation Forest...\n")

# Matrice de features pour IF (valeurs brutes des capteurs uniquement)
X_if <- pivot %>%
  select(all_of(cols_dispo)) %>%
  mutate(across(everything(), ~ replace_na(.x, median(.x, na.rm=TRUE)))) %>%
  as.matrix()

# Entraîner l'Isolation Forest
set.seed(42)
if_model <- isolation.forest(
  X_if,
  ntrees       = 300,
  sample_size  = min(256, nrow(X_if)),
  nthreads     = parallel::detectCores()
)

# Score d'anomalie (0 = normal, proche de 1 = anormal)
if_scores    <- predict(if_model, X_if)
contamination <- 0.05
seuil_if      <- quantile(if_scores, 1 - contamination)
is_anomaly    <- if_scores >= seuil_if

pivot$if_score   <- if_scores
pivot$is_anomaly <- is_anomaly

cat("  ✅", sum(is_anomaly), "anomalies détectées (",
    round(mean(is_anomaly)*100, 1), "%)\n\n")


# ═══════════════════════════════════════════════════════════════════════════
# MODULE 3 : K-MEANS — MODES DE FONCTIONNEMENT
# ═══════════════════════════════════════════════════════════════════════════

cat("📊 [3/3] K-Means — 4 modes de fonctionnement...\n")

# Normaliser avant K-Means
X_km <- scale(X_if)

set.seed(42)
km_model <- kmeans(X_km, centers = 4, nstart = 20, iter.max = 100)
pivot$mode <- km_model$cluster

# Nommer les modes selon le RPM moyen de chaque cluster
rpm_par_mode <- pivot %>%
  group_by(mode) %>%
  summarise(rpm_moy = mean(`Régime moteur`, na.rm = TRUE),
            temp_moy = mean(`Température liquide refroidissement`, na.rm = TRUE),
            pct = n() / nrow(pivot) * 100)

mode_labels <- rpm_par_mode %>%
  mutate(label = case_when(
    rpm_moy < 800  ~ "Arrêt / Ralenti",
    rpm_moy < 1200 ~ "Charge légère",
    rpm_moy < 1700 ~ "Charge nominale",
    TRUE           ~ "Charge maximale"
  ))

cat("  ✅ Modes identifiés :\n")
for (i in seq_len(nrow(mode_labels))) {
  cat("     Mode", mode_labels$mode[i],
      sprintf("(%3.0f%%)", mode_labels$pct[i]), "—",
      mode_labels$label[i],
      "| RPM =", round(mode_labels$rpm_moy[i]),
      "| Temp =", round(mode_labels$temp_moy[i]), "°C\n")
}


# ═══════════════════════════════════════════════════════════════════════════
# SAUVEGARDE
# ═══════════════════════════════════════════════════════════════════════════

cat("\n💾 Sauvegarde des résultats...\n")

# 1. Historique complet (lu par l'API Python)
health_history <- pivot %>%
  select(ts, health_score, if_score, is_anomaly, mode) %>%
  rename(timestamp = ts, anomaly_score = if_score)

write_csv(health_history,
          file.path(MODELS_DIR, "health_history.csv"))

# 2. Modèles R sauvegardés
saveRDS(if_model,  file.path(MODELS_DIR, "isolation_forest.rds"))
saveRDS(km_model,  file.path(MODELS_DIR, "kmeans_modes.rds"))
saveRDS(X_km,      file.path(MODELS_DIR, "km_scale_params.rds"))

# 3. Paramètres de normalisation K-Means (pour l'inférence)
scale_params <- list(
  center = attr(X_km, "scaled:center"),
  scale  = attr(X_km, "scaled:scale")
)
write_json(scale_params,
           file.path(MODELS_DIR, "km_scale_params.json"),
           auto_unbox = TRUE)

# 4. Métadonnées (compatibles avec le backend Python)
meta <- list(
  trained_at     = format(now(), "%Y-%m-%dT%H:%M:%S"),
  language       = "R",
  approach       = "engineering_grade_v5_R",
  modules        = list("health_score", "isolation_forest", "kmeans"),
  n_samples      = nrow(pivot),
  health_score_stats = list(
    mean         = round(mean(health_scores, na.rm=TRUE), 1),
    min          = round(min(health_scores, na.rm=TRUE), 1),
    pct_below_70 = round(mean(health_scores < 70, na.rm=TRUE)*100, 1),
    pct_below_30 = round(mean(health_scores < 30, na.rm=TRUE)*100, 1)
  ),
  isolation_forest = list(
    n_trees      = 300,
    contamination = contamination,
    seuil        = round(seuil_if, 4),
    n_anomalies  = sum(is_anomaly)
  ),
  kmeans_modes = mode_labels %>%
    select(mode, label, pct = pct, rpm_moy, temp_moy) %>%
    mutate(across(where(is.numeric), round, 1)) %>%
    as.list()
)

write_json(meta,
           file.path(MODELS_DIR, "model_meta.json"),
           auto_unbox = TRUE, pretty = TRUE)

cat("  ✅ health_history.csv\n")
cat("  ✅ isolation_forest.rds\n")
cat("  ✅ kmeans_modes.rds\n")
cat("  ✅ model_meta.json\n")


# ═══════════════════════════════════════════════════════════════════════════
# VISUALISATION (bonus PFE — graphiques R)
# ═══════════════════════════════════════════════════════════════════════════

cat("\n📊 Génération des graphiques...\n")

# Graphique 1 : Évolution Health Score dans le temps
p1 <- health_history %>%
  mutate(timestamp = as_datetime(timestamp),
         status = case_when(
           health_score >= 70 ~ "Bon",
           health_score >= 30 ~ "Surveillance",
           TRUE               ~ "Critique"
         )) %>%
  ggplot(aes(x = timestamp, y = health_score, color = status)) +
  geom_line(linewidth = 0.4, alpha = 0.7) +
  geom_hline(yintercept = c(30, 70),
             linetype = "dashed", color = c("red", "orange"), linewidth = 0.5) +
  scale_color_manual(values = c("Bon"="#1D9E75","Surveillance"="#BA7517","Critique"="#E24B4A")) +
  labs(
    title    = "Health Score — CAT 994F · OCP Benguerir",
    subtitle = "Seuils : 70 = surveillance · 30 = critique",
    x = "Date", y = "Health Score (0-100)", color = "État"
  ) +
  theme_minimal(base_size = 12) +
  theme(plot.title = element_text(face = "bold"))

ggsave(file.path(MODELS_DIR, "health_score_evolution.png"),
       p1, width = 12, height = 5, dpi = 150)

# Graphique 2 : Distribution des modes opérationnels
p2 <- mode_labels %>%
  ggplot(aes(x = reorder(label, pct), y = pct, fill = label)) +
  geom_col(width = 0.6) +
  geom_text(aes(label = paste0(round(pct), "%")), hjust = -0.2, size = 4) +
  coord_flip() +
  scale_fill_manual(values = c("#1D9E75","#0F6E56","#EF9F27","#E24B4A")) +
  labs(
    title = "Distribution des modes opérationnels (K-Means)",
    x = NULL, y = "% du temps"
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "none",
        plot.title = element_text(face = "bold"))

ggsave(file.path(MODELS_DIR, "modes_operationnels.png"),
       p2, width = 8, height = 4, dpi = 150)

# Graphique 3 : Anomalies Isolation Forest
p3 <- health_history %>%
  mutate(timestamp = as_datetime(timestamp)) %>%
  ggplot(aes(x = timestamp, y = anomaly_score)) +
  geom_line(aes(color = is_anomaly), linewidth = 0.4) +
  geom_hline(yintercept = seuil_if, linetype = "dashed",
             color = "red", linewidth = 0.5) +
  scale_color_manual(values = c("FALSE"="#B4B2A9","TRUE"="#E24B4A"),
                     labels = c("Normal","Anomalie")) +
  labs(
    title    = "Scores d'anomalie — Isolation Forest",
    subtitle = paste("Seuil :", round(seuil_if, 3), "(5% de contamination)"),
    x = "Date", y = "Score d'anomalie", color = NULL
  ) +
  theme_minimal(base_size = 12) +
  theme(plot.title = element_text(face = "bold"))

ggsave(file.path(MODELS_DIR, "anomalies_isolation_forest.png"),
       p3, width = 12, height = 4, dpi = 150)

cat("  ✅ health_score_evolution.png\n")
cat("  ✅ modes_operationnels.png\n")
cat("  ✅ anomalies_isolation_forest.png\n")


# ═══════════════════════════════════════════════════════════════════════════
# RÉSUMÉ FINAL
# ═══════════════════════════════════════════════════════════════════════════

cat("\n", strrep("═", 55), "\n")
cat("  ✅ PIPELINE R TERMINÉ\n")
cat(strrep("═", 55), "\n")
cat("  💚 Health Score moyen :", round(mean(health_scores, na.rm=TRUE), 1), "/ 100\n")
cat("     Temps surveillance  :", round(mean(health_scores < 70)*100, 1), "%\n")
cat("     Temps critique      :", round(mean(health_scores < 30)*100, 1), "%\n")
cat("  🌲 IF anomalies        :", sum(is_anomaly), "détectées\n")
cat("  📊 K-Means             : 4 modes identifiés\n")
cat("  📁 Résultats dans      : ./models_R/\n")
cat(strrep("═", 55), "\n")
cat("\nProchaine étape :\n")
cat("  Copier models_R/health_history.csv → backend/models/\n")
cat("  Copier models_R/model_meta.json    → backend/models/\n")
cat("  Relancer : uvicorn app.api:app --reload\n\n")
