# ═══════════════════════════════════════════════════════════════════════════
# MineAssist — Multi-Sensor Degradation Model (MSDM)
# Modèle de prédiction RUL basé sur la dégradation physique
# Référence : NASA CMAPSS methodology + IEC 62402 (Obsolescence Management)
#
# Ce modèle calcule :
#   1. Indice de dégradation par capteur (0% → 100%)
#   2. Vitesse de dégradation (régression sur fenêtre glissante)
#   3. RUL par capteur avec intervalle de confiance
#   4. RUL système (fusion pondérée par criticité AMDEC)
#
# Usage : source("degradation_model.R")
# ═══════════════════════════════════════════════════════════════════════════

library(tidyverse)
library(lubridate)
library(readxl)

# ─── Seuils constructeur CAT (valeurs normales + critiques) ─────────────────
CAPTEURS_CONFIG <- list(
  list(
    nom      = "Température liquide refroidissement",
    normal   = 75,    # valeur typique en fonctionnement normal
    alerte   = 95,
    critique = 107,
    type     = "max",
    criticite_amdec = 16  # score AMDEC (Moteur diesel = critique)
  ),
  list(
    nom      = "Température sortie convertisseur",
    normal   = 90,
    alerte   = 115,
    critique = 129,
    type     = "max",
    criticite_amdec = 12  # Transmission = significative
  ),
  list(
    nom      = "Température échappement Droit",
    normal   = 400,
    alerte   = 540,
    critique = 600,
    type     = "max",
    criticite_amdec = 14
  ),
  list(
    nom      = "Température échappement gauche",
    normal   = 400,
    alerte   = 540,
    critique = 600,
    type     = "max",
    criticite_amdec = 14
  ),
  list(
    nom      = "Pression huile moteur",
    normal   = 4.5,
    alerte   = 3.0,
    critique = 2.5,
    type     = "min",
    criticite_amdec = 16  # Lubrification moteur = critique
  ),
  list(
    nom      = "Température huile freinage",
    normal   = 45,
    alerte   = 63,
    critique = 70,
    type     = "max",
    criticite_amdec = 15  # Hydraulique = critique
  ),
  list(
    nom      = "Température huile direction",
    normal   = 45,
    alerte   = 63,
    critique = 70,
    type     = "max",
    criticite_amdec = 12
  ),
  list(
    nom      = "Température essieux arrière",
    normal   = 55,
    alerte   = 80,
    critique = 90,
    type     = "max",
    criticite_amdec = 10
  ),
  list(
    nom      = "Pression d'air au réservoir",
    normal   = 700,
    alerte   = 500,
    critique = 400,
    type     = "min",
    criticite_amdec = 13
  ),
  list(
    nom      = "Régime moteur",
    normal   = 1500,
    alerte   = 1900,
    critique = 2100,
    type     = "max",
    criticite_amdec = 14
  )
)

# ─── Calcul de l'indice de dégradation (0% = normal, 100% = critique) ──────
calculer_DI <- function(valeur, cfg) {
  if (is.na(valeur)) return(NA_real_)
  
  if (cfg$type == "max") {
    # Plus la valeur est haute, plus on est dégradé
    if (valeur <= cfg$normal) return(0)
    DI <- (valeur - cfg$normal) / (cfg$critique - cfg$normal) * 100
  } else {
    # Pour pression min : plus la valeur est basse, plus on est dégradé
    if (valeur >= cfg$normal) return(0)
    DI <- (cfg$normal - valeur) / (cfg$normal - cfg$critique) * 100
  }
  return(max(0, min(150, DI)))  # Plafonner à 150% (en zone critique)
}

# ─── Calcul de la vitesse de dégradation (régression sur fenêtre N jours) ──
calculer_vitesse_degradation <- function(di_series, timestamps, fenetre_jours = 14) {
  # Prendre les N derniers jours
  cutoff <- max(timestamps) - days(fenetre_jours)
  mask <- timestamps >= cutoff
  
  ts_rec <- timestamps[mask]
  di_rec <- di_series[mask]
  
  # Enlever les NA
  valid <- !is.na(di_rec)
  if (sum(valid) < 5) return(list(pente = 0, r2 = 0, fiable = FALSE))
  
  ts_num <- as.numeric(ts_rec[valid] - min(ts_rec[valid])) / 86400  # en jours
  di_val  <- di_rec[valid]
  
  # Régression linéaire
  lm_fit <- lm(di_val ~ ts_num)
  pente  <- coef(lm_fit)[2]  # points de DI par jour
  r2     <- summary(lm_fit)$r.squared
  
  return(list(
    pente  = round(pente, 3),
    r2     = round(r2, 3),
    fiable = r2 > 0.3  # R² > 0.3 = tendance fiable
  ))
}

# ─── Estimation du RUL par capteur ──────────────────────────────────────────
estimer_RUL_capteur <- function(DI_actuel, vitesse_obj) {
  pente  <- vitesse_obj$pente
  r2     <- vitesse_obj$r2
  fiable <- vitesse_obj$fiable
  
  # Si stable ou s'améliore → pas de panne prévue
  if (is.na(pente) || pente <= 0.05) {
    return(list(
      rul_jours     = Inf,
      rul_label     = "Stable",
      di_actuel     = round(DI_actuel, 1),
      pente         = pente,
      confiance     = ifelse(r2 > 0.5, "haute", "moyenne"),
      verdict       = "stable"
    ))
  }
  
  # RUL = jours pour atteindre 100% (seuil critique)
  rul_central <- max(0, (100 - DI_actuel) / pente)
  
  # Intervalle de confiance (±20% si R²>0.7, ±35% sinon)
  marge <- ifelse(r2 > 0.7, 0.20, 0.35)
  rul_min <- rul_central * (1 - marge)
  rul_max <- rul_central * (1 + marge)
  
  # Verdict
  verdict <- if (rul_central < 7)       "critique"
              else if (rul_central < 21)  "alerte"
              else if (rul_central < 60)  "surveillance"
              else                        "stable"
  
  return(list(
    rul_jours   = round(rul_central, 1),
    rul_min     = round(rul_min, 1),
    rul_max     = round(rul_max, 1),
    di_actuel   = round(DI_actuel, 1),
    pente       = round(pente, 3),
    r2          = r2,
    confiance   = ifelse(r2 > 0.7, "haute", ifelse(r2 > 0.4, "moyenne", "faible")),
    verdict     = verdict,
    rul_label   = paste0(round(rul_central), " j [", round(rul_min), "-", round(rul_max), "]")
  ))
}

# ─── MODÈLE PRINCIPAL ────────────────────────────────────────────────────────
run_degradation_model <- function(pivot_df,
                                   fenetre_degradation = 14,
                                   fenetre_vitesse     = 14) {
  
  cat("🔬 MSDM — Multi-Sensor Degradation Model\n")
  cat("   Référence : NASA CMAPSS + IEC 62402\n")
  cat("   Fenêtre analyse :", fenetre_vitesse, "jours\n\n")
  
  resultats_capteurs <- list()
  
  for (cfg in CAPTEURS_CONFIG) {
    nom <- cfg$nom
    if (!nom %in% names(pivot_df)) next
    
    vals  <- pivot_df[[nom]]
    times <- as_datetime(pivot_df$ts)
    
    # Série des indices de dégradation
    di_series <- sapply(vals, function(v) calculer_DI(v, cfg))
    
    # Valeur actuelle (médiane des 24 dernières heures)
    n_pts_24h <- min(12*24, length(di_series))
    DI_actuel <- median(di_series[(length(di_series)-n_pts_24h+1):length(di_series)],
                        na.rm = TRUE)
    
    # Vitesse de dégradation
    vitesse <- calculer_vitesse_degradation(di_series, times, fenetre_vitesse)
    
    # RUL
    rul <- estimer_RUL_capteur(DI_actuel, vitesse)
    
    resultats_capteurs[[nom]] <- c(
      list(
        capteur         = nom,
        criticite_amdec = cfg$criticite_amdec
      ),
      rul
    )
    
    cat(sprintf("  %-45s DI=%5.1f%%  vitesse=%+6.3f pt/j  RUL=%-12s  [%s]\n",
                substr(nom, 1, 45),
                DI_actuel,
                ifelse(is.null(vitesse$pente) || is.na(vitesse$pente), 0, vitesse$pente),
                rul$rul_label,
                rul$verdict))
  }
  
  # ── Fusion pondérée par criticité AMDEC ─────────────────────────────────
  cat("\n📊 Fusion pondérée par criticité AMDEC...\n")
  
  df_rul <- map_dfr(resultats_capteurs, function(r) {
    tibble(
      capteur         = r$capteur,
      criticite       = r$criticite_amdec,
      di_actuel       = r$di_actuel,
      rul_jours       = ifelse(is.infinite(r$rul_jours), 365, r$rul_jours),
      verdict         = r$verdict,
      confiance       = r$confiance
    )
  })
  
  # RUL système = moyenne pondérée par criticité (les capteurs critiques pèsent plus)
  df_rul_fini <- df_rul %>% filter(rul_jours < 365)
  
  if (nrow(df_rul_fini) > 0) {
    rul_systeme <- weighted.mean(df_rul_fini$rul_jours,
                                  w = df_rul_fini$criticite,
                                  na.rm = TRUE)
    capteur_pilote <- df_rul_fini %>%
      arrange(rul_jours) %>%
      slice(1) %>%
      pull(capteur)
  } else {
    rul_systeme    <- Inf
    capteur_pilote <- "Aucun (machine stable)"
  }
  
  date_critique <- Sys.Date() + round(rul_systeme)
  
  cat(sprintf("\n╔══════════════════════════════════════════════════════╗\n"))
  cat(sprintf("║  RUL SYSTÈME (pondéré AMDEC) : %.0f jours             ║\n", rul_systeme))
  cat(sprintf("║  Date critique estimée       : %s               ║\n", format(date_critique, "%d/%m/%Y")))
  cat(sprintf("║  Capteur pilote              : %-22s  ║\n", substr(capteur_pilote, 1, 22)))
  cat(sprintf("╚══════════════════════════════════════════════════════╝\n\n"))
  
  # ── Graphique 1 : Indices de dégradation par capteur ────────────────────
  p1 <- df_rul %>%
    filter(!is.infinite(rul_jours)) %>%
    arrange(desc(di_actuel)) %>%
    mutate(capteur_court = str_trunc(capteur, 30),
           couleur = case_when(
             di_actuel >= 80 ~ "#E24B4A",
             di_actuel >= 50 ~ "#EF9F27",
             TRUE            ~ "#1D9E75"
           )) %>%
    ggplot(aes(x = reorder(capteur_court, di_actuel), y = di_actuel, fill = couleur)) +
    geom_col(width = 0.7, show.legend = FALSE) +
    geom_hline(yintercept = 50, linetype = "dashed", color = "#EF9F27", linewidth = 0.6) +
    geom_hline(yintercept = 80, linetype = "dashed", color = "#E24B4A", linewidth = 0.6) +
    geom_text(aes(label = paste0(round(di_actuel), "%")), hjust = -0.2, size = 3.5) +
    scale_fill_identity() +
    scale_y_continuous(limits = c(0, 120), labels = function(x) paste0(x, "%")) +
    coord_flip() +
    labs(
      title    = "Indice de dégradation par capteur — CAT 994F",
      subtitle = "0% = normal · 50% = alerte · 100% = seuil critique",
      x = NULL, y = "Indice de dégradation (%)",
      caption  = "Méthode : NASA CMAPSS degradation model"
    ) +
    theme_minimal(base_size = 12) +
    theme(
      plot.title    = element_text(face = "bold", size = 14),
      plot.subtitle = element_text(color = "grey45"),
      panel.grid.minor = element_blank()
    )
  
  # ── Graphique 2 : RUL par capteur (barres horizontales) ──────────────────
  p2 <- df_rul %>%
    filter(rul_jours < 200) %>%
    arrange(rul_jours) %>%
    mutate(
      capteur_court = str_trunc(capteur, 30),
      couleur = case_when(
        rul_jours < 7  ~ "#E24B4A",
        rul_jours < 21 ~ "#EF9F27",
        rul_jours < 60 ~ "#F5C518",
        TRUE           ~ "#1D9E75"
      )
    ) %>%
    ggplot(aes(x = reorder(capteur_court, -rul_jours), y = rul_jours, fill = couleur)) +
    geom_col(width = 0.7, show.legend = FALSE) +
    geom_hline(yintercept = 7,  linetype = "dashed", color = "#E24B4A",  linewidth = 0.5) +
    geom_hline(yintercept = 21, linetype = "dashed", color = "#EF9F27",  linewidth = 0.5) +
    geom_text(aes(label = paste0(round(rul_jours), "j")), hjust = -0.2, size = 3.5) +
    annotate("text", x = 0.6, y = 8,  label = "CRITIQUE < 7j",  size = 3, color = "#E24B4A") +
    annotate("text", x = 0.6, y = 22, label = "ALERTE < 21j",   size = 3, color = "#EF9F27") +
    scale_fill_identity() +
    scale_y_continuous(limits = c(0, 220)) +
    coord_flip() +
    labs(
      title    = "RUL (Remaining Useful Life) par capteur",
      subtitle = paste0("RUL système : ", round(rul_systeme), " jours — Date critique : ",
                        format(date_critique, "%d/%m/%Y")),
      x = NULL, y = "Jours avant seuil critique",
      caption  = "Fusion pondérée par criticité AMDEC"
    ) +
    theme_minimal(base_size = 12) +
    theme(
      plot.title    = element_text(face = "bold", size = 14),
      plot.subtitle = element_text(color = "grey45"),
      panel.grid.minor = element_blank()
    )
  
  # Sauvegarder les graphiques
  ggsave("./resultats_ML/degradation_index.png",    p1, width=12, height=6, dpi=150)
  ggsave("./resultats_ML/rul_par_capteur.png",      p2, width=12, height=6, dpi=150)
  
  cat("✅ Graphiques sauvegardés :\n")
  cat("   ./resultats_ML/degradation_index.png\n")
  cat("   ./resultats_ML/rul_par_capteur.png\n\n")
  
  # ── Export JSON pour le backend FastAPI ──────────────────────────────────
  resultat_json <- list(
    timestamp      = format(Sys.time(), "%Y-%m-%dT%H:%M:%S"),
    methode        = "Multi-Sensor Degradation Model (NASA CMAPSS)",
    rul_systeme_j  = round(rul_systeme),
    date_critique  = format(date_critique, "%Y-%m-%d"),
    capteur_pilote = capteur_pilote,
    capteurs       = map(resultats_capteurs, function(r) {
      list(
        nom          = r$capteur,
        di_pct       = round(r$di_actuel, 1),
        rul_jours    = ifelse(is.infinite(r$rul_jours), 999, round(r$rul_jours)),
        verdict      = r$verdict,
        confiance    = r$confiance,
        criticite    = r$criticite_amdec
      )
    })
  )
  
  jsonlite::write_json(
    resultat_json,
    "./resultats_ML/rul_predictions.json",
    auto_unbox = TRUE,
    pretty     = TRUE
  )
  cat("✅ Export JSON : ./resultats_ML/rul_predictions.json\n")
  
  return(invisible(list(
    df_rul         = df_rul,
    rul_systeme    = rul_systeme,
    date_critique  = date_critique,
    capteur_pilote = capteur_pilote
  )))
}

# ─── INTÉGRATION AVEC LE PIPELINE EXISTANT ───────────────────────────────────
# Ajouter après pivoter() dans mineassist_ML_SIMPLE.R :
#
#   resultats_rul <- run_degradation_model(pivot, fenetre_vitesse = 14)
#
# ─────────────────────────────────────────────────────────────────────────────
cat("Script MSDM chargé — appeler run_degradation_model(pivot) pour lancer.\n")
