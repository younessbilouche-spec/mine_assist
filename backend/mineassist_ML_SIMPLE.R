# ╔══════════════════════════════════════════════════════════════╗
# ║   MineAssist — Pipeline ML COMPLET et SIMPLE                ║
# ║   CAT 994F · OCP Benguerir · PFE Génie Industriel           ║
# ║                                                              ║
# ║   CE QUE CE SCRIPT FAIT :                                    ║
# ║   1. Charge les données capteurs + GMAO                      ║
# ║   2. Calcule un Health Score (0-100)                         ║
# ║   3. Détecte les anomalies (Isolation Forest)                ║
# ║   4. Classe les modes de travail (K-Means)                   ║
# ║   5. Produit 6 graphiques pour ton rapport PFE               ║
# ║                                                              ║
# ║   INSTALLER LES PACKAGES UNE SEULE FOIS :                    ║
# ║   install.packages(c("readxl","tidyverse","lubridate",        ║
# ║                       "isotree","patchwork","corrplot"))      ║
# ║                                                              ║
# ║   LANCER :  Rscript mineassist_ML_SIMPLE.R                   ║
# ╚══════════════════════════════════════════════════════════════╝

library(readxl)
library(tidyverse)
library(lubridate)
library(isotree)    # Isolation Forest
library(patchwork)  # Coller plusieurs graphiques ensemble
library(corrplot)   # Matrice de corrélation

cat("\n╔══════════════════════════════════════╗\n")
cat("║  MineAssist ML — Démarrage           ║\n")
cat("╚══════════════════════════════════════╝\n\n")


# ════════════════════════════════════════════════════════════════
# 0. CHEMINS ET PARAMÈTRES
#    ► Modifier ici si tes fichiers sont ailleurs
# ════════════════════════════════════════════════════════════════

DOSSIER_CAPTEURS <- "C:/Users/ORIGINAL/Desktop/AI_994F_Assistant/backend/data/capteurs"
FICHIER_GMAO     <- "C:/Users/ORIGINAL/Desktop/AI_994F_Assistant/backend/data/gmao_anomalies.xlsx"
DOSSIER_SORTIE   <- "C:/Users/ORIGINAL/Desktop/AI_994F_Assistant/backend/resultats_ML"

dir.create(DOSSIER_SORTIE, showWarnings = FALSE)

# Liste des capteurs qu'on utilise
CAPTEURS <- c(
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

# Seuils constructeur CAT (tirés du manuel de la 994F)
# "alerte" = zone orange | "max" = zone rouge
SEUILS <- list(
  list(nom="Température liquide refroidissement", alerte=95,  max=107, type="max"),
  list(nom="Température échappement Droit",       alerte=540, max=600, type="max"),
  list(nom="Température échappement gauche",      alerte=540, max=600, type="max"),
  list(nom="Température sortie convertisseur",    alerte=115, max=129, type="max"),
  list(nom="Température huile direction",         alerte=63,  max=70,  type="max"),
  list(nom="Température huile freinage",          alerte=63,  max=70,  type="max"),
  list(nom="Température essieux arrière",         alerte=80,  max=90,  type="max"),
  list(nom="Régime moteur",                       alerte=1900,max=2100,type="max"),
  list(nom="Pression huile moteur",               alerte=3,   min=2.5, type="min"),
  list(nom="Pression d'air au réservoir",         alerte=500, min=400, type="min"),
  list(nom="Pression embrayage impeller",         alerte=2,   min=1.5, type="min")
)

# Thème graphique uniforme pour tous les plots
MON_THEME <- theme_minimal(base_size = 12) +
  theme(
    plot.title      = element_text(face = "bold", size = 14, margin = margin(b=6)),
    plot.subtitle   = element_text(color = "grey45", size = 11),
    plot.caption    = element_text(color = "grey55", size = 9),
    panel.grid.minor = element_blank(),
    strip.text      = element_text(face = "bold", size = 11)
  )

MES_COULEURS <- c("#1D9E75", "#EF9F27", "#378ADD", "#E24B4A",
                  "#7F77DD", "#D85A30", "#0F6E56")


# ════════════════════════════════════════════════════════════════
# 1. CHARGEMENT DES DONNÉES
#    ► On lit tous les fichiers Excel du dossier capteurs
#    ► On lit le fichier GMAO
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 1 : Chargement des données ─────────────────\n")

# --- 1a. Fichiers capteurs ---
fichiers <- list.files(DOSSIER_CAPTEURS,
                       pattern = "\\.xlsx$|\\.xls$",
                       full.names = TRUE)

if (length(fichiers) == 0) {
  stop("❌ Aucun fichier trouvé dans : ", DOSSIER_CAPTEURS,
       "\n   Vérifie le chemin DOSSIER_CAPTEURS en haut du script.")
}

donnees_brutes <- map_dfr(fichiers, function(f) {
  tryCatch({
    df <- read_excel(f, skip = 8) %>%
      setNames(c("Engin","Parametre","Code","Heure",
                 "Val_min","Val_moy","Val_max",
                 "Unite","Capteur_OK"))
    df %>%
      mutate(
        # Enlever le préfixe "CH994.P1." du nom du capteur
        Parametre = str_replace(Parametre, "^CH\\d+\\.P\\d+\\.", ""),
        Parametre = str_trim(Parametre),
        Heure     = as_datetime(Heure),
        Val_moy   = as.numeric(Val_moy)
      ) %>%
      filter(!is.na(Heure), !is.na(Val_moy),
             Parametre %in% CAPTEURS)
  }, error = function(e) {
    cat("  ⚠️  Impossible de lire :", basename(f), "\n")
    NULL
  })
}) %>%
  arrange(Heure)

cat("  ✅ Capteurs :", nrow(donnees_brutes), "mesures\n")
cat("     Période  :", format(min(donnees_brutes$Heure), "%d/%m/%Y"),
    "→", format(max(donnees_brutes$Heure), "%d/%m/%Y"), "\n")

# --- 1b. Fichier GMAO ---
gmao <- read_excel(FICHIER_GMAO) %>%
  rename(
    timestamp = `Date de l'anomalie`,
    code      = `Code d'anomalie`,
    gravite   = Gravité
  ) %>%
  mutate(timestamp = as_datetime(timestamp),
         gravite   = as.integer(gravite)) %>%
  filter(!is.na(timestamp)) %>%
  arrange(timestamp)

cat("  ✅ GMAO     :", nrow(gmao), "codes d'anomalie\n")
cat("     Gravité  : 1 =", sum(gmao$gravite==1),
    "| 2 =", sum(gmao$gravite==2),
    "| 3 =", sum(gmao$gravite==3), "\n\n")


# ════════════════════════════════════════════════════════════════
# 2. MISE EN FORME (PIVOT)
#    ► On transforme : une ligne = un capteur
#    ► En           : une ligne = un instant avec TOUS les capteurs
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 2 : Mise en forme des données ───────────────\n")

# Arrondir à 5 minutes pour aligner tous les capteurs
pivot <- donnees_brutes %>%
  mutate(ts = floor_date(Heure, "5 minutes")) %>%
  group_by(ts, Parametre) %>%
  summarise(Val_moy = mean(Val_moy, na.rm = TRUE), .groups = "drop") %>%
  pivot_wider(names_from  = Parametre,
              values_from = Val_moy) %>%
  arrange(ts)

# Garder seulement les capteurs vraiment présents dans les données
capteurs_dispo <- intersect(CAPTEURS, names(pivot))

# Remplir les petits trous (interpolation)
pivot <- pivot %>%
  mutate(across(all_of(capteurs_dispo),
                ~ zoo::na.approx(.x, na.rm = FALSE, maxgap = 3)))

cat("  ✅", nrow(pivot), "timestamps (intervalle 5 min)\n")
cat("  ✅", length(capteurs_dispo), "capteurs disponibles\n\n")


# ════════════════════════════════════════════════════════════════
# 3. HEALTH SCORE (0 à 100)
#    ► Pour chaque instant, on calcule un score de santé
#    ► 100 = tout est parfait
#    ►   0 = situation critique
#    ► Basé sur les seuils constructeur CAT
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 3 : Calcul du Health Score ─────────────────\n")

# Fonction qui calcule le score pour une seule ligne de données
calculer_score <- function(ligne) {
  score <- 100.0

  for (s in SEUILS) {
    capteur <- s$nom
    if (!capteur %in% names(ligne)) next
    valeur <- as.numeric(ligne[[capteur]])
    if (is.na(valeur)) next

    if (s$type == "max") {
      # Capteur de température ou pression max
      if (valeur > s$max) {
        # Zone rouge : pénalité forte (40 à 100)
        penalite <- min(100, 40 + (valeur - s$max) / s$max * 60)
      } else if (valeur > s$alerte) {
        # Zone orange : pénalité modérée (0 à 40)
        penalite <- (valeur - s$alerte) / (s$max - s$alerte) * 40
      } else {
        penalite <- 0
      }
    } else {
      # Capteur de pression min
      if (valeur < s$min) {
        penalite <- min(100, 40 + (s$min - valeur) / s$min * 60)
      } else if (valeur < s$alerte) {
        penalite <- (s$alerte - valeur) / (s$alerte - s$min) * 40
      } else {
        penalite <- 0
      }
    }
    score <- max(0, score - penalite)
  }
  return(round(score, 1))
}

# Appliquer sur toutes les lignes du tableau pivot
pivot$health_score <- map_dbl(
  seq_len(nrow(pivot)),
  function(i) calculer_score(as.list(pivot[i, ]))
)

# Ajouter le statut lisible
pivot <- pivot %>%
  mutate(statut = case_when(
    health_score >= 90 ~ "Excellent",
    health_score >= 70 ~ "Bon",
    health_score >= 50 ~ "Surveillance",
    health_score >= 30 ~ "Dégradé",
    TRUE               ~ "Critique"
  ))

cat("  ✅ Score moyen :", round(mean(pivot$health_score, na.rm=TRUE), 1), "/ 100\n")
cat("     Surveillance (<70) :",
    round(mean(pivot$health_score < 70, na.rm=TRUE)*100, 1), "% du temps\n")
cat("     Critique (<30)     :",
    round(mean(pivot$health_score < 30, na.rm=TRUE)*100, 1), "% du temps\n\n")


# ════════════════════════════════════════════════════════════════
# 4. ISOLATION FOREST
#    ► Modèle non supervisé : pas besoin de labels
#    ► Apprend ce qu'est un comportement NORMAL
#    ► Signale ce qui est DIFFÉRENT du normal
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 4 : Isolation Forest ────────────────────────\n")

# Préparer la matrice de données (seulement les valeurs numériques)
X <- pivot %>%
  select(all_of(capteurs_dispo)) %>%
  mutate(across(everything(),
                ~ replace_na(.x, median(.x, na.rm = TRUE)))) %>%
  as.matrix()

# Entraîner le modèle
set.seed(42)
modele_if <- isolation.forest(
  X,
  ntrees      = 200,       # 200 arbres (plus = plus précis)
  sample_size = 256,       # taille d'échantillon par arbre
  nthreads    = 1
)

# Score d'anomalie : plus il est élevé, plus c'est anormal
pivot$score_if  <- predict(modele_if, X)

# Seuil : les 5% les plus anormaux sont marqués comme anomalies
seuil_anomalie  <- quantile(pivot$score_if, 0.95)
pivot$anomalie  <- pivot$score_if >= seuil_anomalie

cat("  ✅ Modèle entraîné\n")
cat("  ✅", sum(pivot$anomalie), "anomalies détectées (",
    round(mean(pivot$anomalie)*100, 1), "% des mesures)\n\n")


# ════════════════════════════════════════════════════════════════
# 5. K-MEANS — MODES DE FONCTIONNEMENT
#    ► Regroupe automatiquement les mesures similaires
#    ► Résultat : 4 groupes = 4 façons de travailler
#      (ex: ralenti, charge légère, charge nominale, charge max)
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 5 : K-Means ─────────────────────────────────\n")

# Normaliser les données avant K-Means (obligatoire)
X_norm <- scale(X)

set.seed(42)
km <- kmeans(X_norm, centers = 4, nstart = 25, iter.max = 100)
pivot$mode <- km$cluster

# Nommer automatiquement chaque mode selon le RPM moyen
if ("Régime moteur" %in% capteurs_dispo) {
  rpm_par_mode <- pivot %>%
    group_by(mode) %>%
    summarise(rpm_moy = mean(`Régime moteur`, na.rm = TRUE))

  pivot <- pivot %>%
    left_join(rpm_par_mode, by = "mode") %>%
    mutate(mode_nom = case_when(
      rpm_moy < 800  ~ "Arrêt / Ralenti",
      rpm_moy < 1300 ~ "Charge légère",
      rpm_moy < 1700 ~ "Charge nominale",
      TRUE           ~ "Charge maximale"
    ))
} else {
  pivot <- pivot %>%
    mutate(mode_nom = paste("Mode", mode))
}

cat("  ✅ 4 modes identifiés :\n")
pivot %>%
  count(mode_nom) %>%
  mutate(pct = round(n / sum(n) * 100, 1)) %>%
  arrange(desc(pct)) %>%
  pwalk(function(mode_nom, n, pct, ...) {
    cat("     •", mode_nom, ":", pct, "% du temps\n")
  })
cat("\n")


# ════════════════════════════════════════════════════════════════
# 6. GRAPHIQUES POUR LE RAPPORT PFE
#    ► 6 graphiques clairs et professionnels
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 6 : Création des graphiques ─────────────────\n")


# ┌─────────────────────────────────────────────────────────────┐
# │ GRAPHIQUE 1 : Évolution du Health Score dans le temps       │
# └─────────────────────────────────────────────────────────────┘

# Agrégation par jour pour que le graphique soit lisible
hs_journalier <- pivot %>%
  mutate(date = as_date(ts)) %>%
  group_by(date) %>%
  summarise(
    hs_moy = mean(health_score, na.rm = TRUE),
    hs_min = min(health_score,  na.rm = TRUE),
    statut = case_when(
      mean(health_score, na.rm=TRUE) >= 70 ~ "Bon",
      mean(health_score, na.rm=TRUE) >= 30 ~ "Surveillance",
      TRUE ~ "Critique"
    )
  )

g1 <- ggplot(hs_journalier, aes(x = date, y = hs_moy)) +
  annotate("rect", xmin = min(hs_journalier$date), xmax = max(hs_journalier$date),
           ymin =  0, ymax = 30,  fill = "#E24B4A", alpha = 0.08) +
  annotate("rect", xmin = min(hs_journalier$date), xmax = max(hs_journalier$date),
           ymin = 30, ymax = 70,  fill = "#EF9F27", alpha = 0.08) +
  annotate("rect", xmin = min(hs_journalier$date), xmax = max(hs_journalier$date),
           ymin = 70, ymax = 100, fill = "#1D9E75", alpha = 0.08) +
  geom_line(aes(color = statut), linewidth = 0.8) +
  geom_point(aes(color = statut), size = 1.5, alpha = 0.7) +
  geom_hline(yintercept = 70, linetype = "dashed",
             color = "#EF9F27", linewidth = 0.6) +
  geom_hline(yintercept = 30, linetype = "dashed",
             color = "#E24B4A", linewidth = 0.6) +
  annotate("text", x = max(hs_journalier$date),
           y = 85, label = "BON", hjust = 1, size = 3.5,
           color = "#1D9E75", fontface = "bold") +
  annotate("text", x = max(hs_journalier$date),
           y = 50, label = "SURVEILLANCE", hjust = 1, size = 3.5,
           color = "#EF9F27", fontface = "bold") +
  annotate("text", x = max(hs_journalier$date),
           y = 15, label = "CRITIQUE", hjust = 1, size = 3.5,
           color = "#E24B4A", fontface = "bold") +
  scale_color_manual(values = c("Bon"="#1D9E75",
                                "Surveillance"="#EF9F27",
                                "Critique"="#E24B4A")) +
  scale_y_continuous(limits = c(0, 100), breaks = seq(0, 100, 20)) +
  labs(
    title    = "Health Score de la CAT 994F — Evolution sur 11 mois",
    subtitle = "Score composite 0-100 base sur les seuils constructeur CAT",
    x = NULL, y = "Health Score (0 = critique / 100 = parfait)",
    color = "Etat",
    caption = "OCP Benguerir - Donnees capteurs VIMS"
  ) +
  MON_THEME

ggsave(file.path(DOSSIER_SORTIE, "01_health_score_evolution.png"),
       g1, width = 14, height = 5, dpi = 150)
cat("  ✅ 01_health_score_evolution.png\n")


# ┌─────────────────────────────────────────────────────────────┐
# │ GRAPHIQUE 2 : Anomalies Isolation Forest                    │
# └─────────────────────────────────────────────────────────────┘

# Agrégation par jour
anom_journalier <- pivot %>%
  mutate(date = as_date(ts)) %>%
  group_by(date) %>%
  summarise(
    score_moy  = mean(score_if, na.rm = TRUE),
    n_anomalies = sum(anomalie, na.rm = TRUE),
    pct_anomalie = mean(anomalie, na.rm = TRUE) * 100
  )

g2 <- ggplot(anom_journalier, aes(x = date)) +
  geom_col(aes(y = pct_anomalie, fill = pct_anomalie > 10),
           width = 1, alpha = 0.8) +
  geom_hline(yintercept = 10, linetype = "dashed",
             color = "#E24B4A", linewidth = 0.5) +
  scale_fill_manual(values = c("FALSE" = "#378ADD", "TRUE" = "#E24B4A")) +
  labs(
    title    = "Détection d'anomalies — Isolation Forest",
    subtitle = "% de mesures anormales par jour · Seuil de contamination : 5%",
    x = NULL, y = "% mesures anormales",
    caption = "Rouge = jours avec plus de 10% d'anomalies"
  ) +
  MON_THEME +
  theme(legend.position = "none")

ggsave(file.path(DOSSIER_SORTIE, "02_anomalies_isolation_forest.png"),
       g2, width = 14, height = 5, dpi = 150)
cat("  ✅ 02_anomalies_isolation_forest.png\n")


# ┌─────────────────────────────────────────────────────────────┐
# │ GRAPHIQUE 3 : Modes opérationnels K-Means                   │
# └─────────────────────────────────────────────────────────────┘

# Camembert + barres
modes_stats <- pivot %>%
  count(mode_nom) %>%
  mutate(pct = round(n / sum(n) * 100, 1),
         label = paste0(mode_nom, "\n", pct, "%"))

g3a <- ggplot(modes_stats, aes(x = "", y = pct, fill = mode_nom)) +
  geom_col(width = 1, color = "white", linewidth = 0.5) +
  coord_polar("y") +
  geom_text(aes(label = paste0(pct, "%")),
            position = position_stack(vjust = 0.5),
            size = 4, color = "white", fontface = "bold") +
  scale_fill_manual(values = MES_COULEURS[1:4]) +
  labs(title = "Répartition des modes", fill = "Mode") +
  MON_THEME +
  theme(axis.text = element_blank(),
        axis.title = element_blank(),
        panel.grid = element_blank())

# Health Score moyen par mode
modes_hs <- pivot %>%
  group_by(mode_nom) %>%
  summarise(hs_moy = mean(health_score, na.rm=TRUE),
            hs_sd  = sd(health_score, na.rm=TRUE))

g3b <- ggplot(modes_hs, aes(x = reorder(mode_nom, hs_moy),
                              y = hs_moy, fill = mode_nom)) +
  geom_col(width = 0.6) +
  geom_errorbar(aes(ymin = hs_moy - hs_sd,
                    ymax = hs_moy + hs_sd),
                width = 0.2, color = "grey30") +
  scale_fill_manual(values = MES_COULEURS[1:4]) +
  coord_flip() +
  labs(title    = "Health Score par mode",
       x = NULL, y = "Health Score moyen") +
  MON_THEME +
  theme(legend.position = "none")

g3 <- g3a + g3b +
  plot_annotation(
    title    = "Classification des modes opérationnels — K-Means (4 clusters)",
    subtitle = "Chaque mode correspond à un régime de travail de la machine",
    caption  = "K-Means entraîné sur les 11 capteurs normalisés",
    theme    = theme(plot.title = element_text(face="bold", size=14))
  )

ggsave(file.path(DOSSIER_SORTIE, "03_modes_operationnels.png"),
       g3, width = 14, height = 6, dpi = 150)
cat("  ✅ 03_modes_operationnels.png\n")


# ┌─────────────────────────────────────────────────────────────┐
# │ GRAPHIQUE 4 : Distribution des capteurs (histogrammes)      │
# └─────────────────────────────────────────────────────────────┘

noms_courts <- c(
  "Température liquide refroidissement" = "Temp. Refroid.",
  "Température échappement Droit"       = "Temp. Échap. D",
  "Température échappement gauche"      = "Temp. Échap. G",
  "Température sortie convertisseur"    = "Temp. Convert.",
  "Pression huile moteur"               = "Press. Huile",
  "Régime moteur"                       = "Régime Moteur",
  "Température huile direction"         = "Temp. Direction",
  "Température huile freinage"          = "Temp. Freinage",
  "Pression d'air au réservoir"         = "Press. Air",
  "Température essieux arrière"         = "Temp. Essieux",
  "Pression embrayage impeller"         = "Press. Embrg."
)

df_hist <- donnees_brutes %>%
  filter(!is.na(Val_moy)) %>%
  group_by(Parametre) %>%
  filter(Val_moy >= quantile(Val_moy, 0.01, na.rm=TRUE),
         Val_moy <= quantile(Val_moy, 0.99, na.rm=TRUE)) %>%
  ungroup() %>%
  mutate(Capteur = noms_courts[Parametre])

g4 <- ggplot(df_hist, aes(x = Val_moy, fill = Capteur)) +
  geom_histogram(bins = 35, color = "white", linewidth = 0.15) +
  facet_wrap(~ Capteur, scales = "free", ncol = 3) +
  scale_fill_manual(values = rep(MES_COULEURS, 3)) +
  labs(
    title    = "Distribution statistique des 11 capteurs — CAT 994F",
    subtitle = "Histogrammes des valeurs mesurées (percentiles 1-99%)",
    x = "Valeur mesurée", y = "Fréquence",
    caption  = "11 mois de données · 43 942 mesures"
  ) +
  MON_THEME +
  theme(legend.position = "none",
        axis.text       = element_text(size = 8))

ggsave(file.path(DOSSIER_SORTIE, "04_distribution_capteurs.png"),
       g4, width = 14, height = 10, dpi = 150)
cat("  ✅ 04_distribution_capteurs.png\n")


# ┌─────────────────────────────────────────────────────────────┐
# │ GRAPHIQUE 5 : Codes GMAO — analyse complète                 │
# └─────────────────────────────────────────────────────────────┘

# Top 10 codes
top_codes <- gmao %>%
  count(code, gravite, sort = TRUE) %>%
  slice_head(n = 10) %>%
  mutate(
    code_court = str_trunc(code, 38),
    grav_label = paste("Gravité", gravite)
  )

g5a <- ggplot(top_codes,
              aes(x = n, y = reorder(code_court, n),
                  fill = grav_label)) +
  geom_col(width = 0.7) +
  geom_text(aes(label = n), hjust = -0.2, size = 3.5) +
  scale_fill_manual(values = c("Gravité 1"="#1D9E75",
                               "Gravité 2"="#EF9F27",
                               "Gravité 3"="#E24B4A")) +
  labs(title = "Top 10 des codes d'anomalie",
       x = "Nombre d'occurrences", y = NULL, fill = NULL) +
  MON_THEME + theme(legend.position = "top")

# Par mois
gmao_mois <- gmao %>%
  mutate(mois = floor_date(timestamp, "month")) %>%
  count(mois, gravite) %>%
  mutate(grav_label = paste("Gravité", gravite))

g5b <- ggplot(gmao_mois,
              aes(x = mois, y = n, fill = grav_label)) +
  geom_col(position = "stack") +
  scale_fill_manual(values = c("Gravité 1"="#1D9E75",
                               "Gravité 2"="#EF9F27",
                               "Gravité 3"="#E24B4A")) +
  scale_x_datetime(date_labels = "%b %Y", date_breaks = "2 months") +
  labs(title = "Évolution mensuelle des anomalies",
       x = NULL, y = "Nombre de codes", fill = NULL) +
  MON_THEME +
  theme(legend.position    = "top",
        axis.text.x = element_text(angle = 30, hjust = 1))

g5 <- g5a + g5b +
  plot_annotation(
    title    = "Analyse des codes d'anomalie GMAO — CAT 994F",
    subtitle = "1 373 codes sur 11 mois · Source : Export GMAO Caterpillar VIMS",
    theme    = theme(plot.title = element_text(face="bold", size=14))
  )

ggsave(file.path(DOSSIER_SORTIE, "05_analyse_codes_gmao.png"),
       g5, width = 14, height = 8, dpi = 150)
cat("  ✅ 05_analyse_codes_gmao.png\n")


# ┌─────────────────────────────────────────────────────────────┐
# │ GRAPHIQUE 6 : Corrélation entre capteurs                    │
# └─────────────────────────────────────────────────────────────┘

X_corr <- pivot %>%
  select(all_of(capteurs_dispo)) %>%
  drop_na()
colnames(X_corr) <- noms_courts[colnames(X_corr)]

mat_corr <- cor(X_corr, use = "complete.obs")

png(file.path(DOSSIER_SORTIE, "06_matrice_correlation.png"),
    width = 1600, height = 1400, res = 150)
corrplot(
  mat_corr,
  method      = "color",
  type        = "upper",
  order       = "hclust",
  tl.cex      = 0.9,
  tl.col      = "black",
  addCoef.col = "black",
  number.cex  = 0.7,
  col         = colorRampPalette(c("#E24B4A","white","#1D9E75"))(200),
  title       = "Corrélation entre capteurs — CAT 994F",
  mar         = c(0, 0, 2, 0)
)
dev.off()
cat("  ✅ 06_matrice_correlation.png\n\n")


# ════════════════════════════════════════════════════════════════
# 7. SAUVEGARDE DES RÉSULTATS
#    ► CSV pour le backend Python
#    ► CSV des statistiques pour le rapport
# ════════════════════════════════════════════════════════════════

cat("── ÉTAPE 7 : Sauvegarde ──────────────────────────────\n")

# Historique complet (lu par le backend Python via /ml/health-history)
pivot %>%
  select(timestamp = ts,
         health_score, statut,
         anomaly_score = score_if,
         anomalie, mode, mode_nom) %>%
  write_csv(file.path(DOSSIER_SORTIE, "health_history.csv"))

# Statistiques descriptives pour le rapport
stats <- donnees_brutes %>%
  filter(!is.na(Val_moy)) %>%
  group_by(Parametre) %>%
  summarise(
    N       = n(),
    Moyenne = round(mean(Val_moy, na.rm=TRUE), 2),
    Ecart_type = round(sd(Val_moy, na.rm=TRUE), 2),
    Min     = round(min(Val_moy, na.rm=TRUE), 2),
    Mediane = round(median(Val_moy, na.rm=TRUE), 2),
    Max     = round(max(Val_moy, na.rm=TRUE), 2)
  ) %>%
  mutate(Capteur = noms_courts[Parametre]) %>%
  select(Capteur, N, Moyenne, Ecart_type, Min, Mediane, Max)

write_csv(stats, file.path(DOSSIER_SORTIE, "statistiques_descriptives.csv"))

cat("  ✅ health_history.csv     → copier dans backend/models/\n")
cat("  ✅ statistiques_descriptives.csv\n\n")

library(jsonlite)
write_json(
  list(
    trained_at   = format(now(), "%Y-%m-%dT%H:%M:%S"),
    language     = "R",
    approach     = "engineering_grade_v5_R",
    modules      = list("health_score", "isolation_forest", "kmeans"),
    n_samples    = nrow(pivot),
    health_score_stats = list(
      mean        = round(mean(pivot$health_score, na.rm=TRUE), 1),
      pct_below_70 = round(mean(pivot$health_score < 70, na.rm=TRUE)*100, 1),
      pct_below_30 = round(mean(pivot$health_score < 30, na.rm=TRUE)*100, 1)
    ),
    isolation_forest = list(
      contamination = round(seuil_anomalie, 3),
      n_anomalies   = sum(pivot$anomalie, na.rm=TRUE)
    )
  ),
  file.path(DOSSIER_SORTIE, "model_meta.json"),
  auto_unbox = TRUE, pretty = TRUE
)


# ════════════════════════════════════════════════════════════════
# 8. RÉSUMÉ FINAL
# ════════════════════════════════════════════════════════════════

cat("╔══════════════════════════════════════════════════════╗\n")
cat("║  ✅  PIPELINE ML TERMINÉ                             ║\n")
cat("╠══════════════════════════════════════════════════════╣\n")
cat(sprintf("║  💚 Health Score moyen  : %5.1f / 100              ║\n",
            mean(pivot$health_score, na.rm=TRUE)))
cat(sprintf("║     Temps surveillance  : %5.1f %%                  ║\n",
            mean(pivot$health_score < 70, na.rm=TRUE)*100))
cat(sprintf("║     Temps critique      : %5.1f %%                  ║\n",
            mean(pivot$health_score < 30, na.rm=TRUE)*100))
cat(sprintf("║  🌲 Anomalies (IF)      : %5d détectées           ║\n",
            sum(pivot$anomalie, na.rm=TRUE)))
cat(sprintf("║  📊 Modes (K-Means)     : %5d groupes identifiés  ║\n", 4))
cat("╠══════════════════════════════════════════════════════╣\n")
cat("║  6 graphiques dans : ./resultats_ML/                ║\n")
cat("║  01_health_score_evolution.png                       ║\n")
cat("║  02_anomalies_isolation_forest.png                   ║\n")
cat("║  03_modes_operationnels.png                          ║\n")
cat("║  04_distribution_capteurs.png                        ║\n")
cat("║  05_analyse_codes_gmao.png                           ║\n")
cat("║  06_matrice_correlation.png                          ║\n")
cat("╠══════════════════════════════════════════════════════╣\n")
cat("║  PROCHAINE ÉTAPE :                                   ║\n")
cat("║  Copier resultats_ML/health_history.csv              ║\n")
cat("║  dans backend/models/                                ║\n")
cat("╚══════════════════════════════════════════════════════╝\n\n")
