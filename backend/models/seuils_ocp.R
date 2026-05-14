# ═══════════════════════════════════════════════════════════════════════════
# MineAssist — Seuils OCP OFFICIELS en R
# Source : "notification & Alerte Engins" — OCP Benguérir
# ═══════════════════════════════════════════════════════════════════════════

# ─── Seuils simples (utilisés dans Health Score et MSDM) ────────────────────
CAPTEURS_CONFIG_OCP <- list(

  list(nom="Température échappement Droit",
       normal=400, alerte=540, critique=600, type="max",
       unite="°C", criticite_amdec=14, source="OCP officiel"),

  list(nom="Température échappement gauche",
       normal=400, alerte=540, critique=600, type="max",
       unite="°C", criticite_amdec=14, source="OCP officiel"),

  list(nom="Température sortie convertisseur",
       normal=90, alerte=115, critique=129, type="max",
       unite="°C", criticite_amdec=12, source="OCP officiel : ≥ 129°C"),

  list(nom="Température huile direction",
       normal=45, alerte=63, critique=70, type="max",
       unite="°C", criticite_amdec=12, source="OCP officiel : > 70°C"),

  list(nom="Température huile freinage",
       normal=45, alerte=63, critique=70, type="max",
       unite="°C", criticite_amdec=15, source="OCP officiel : > 70°C"),

  list(nom="Température liquide refroidissement",
       normal=75, alerte=95, critique=107, type="max",
       unite="°C", criticite_amdec=16, source="Manuel CAT (non dans OCP)"),

  list(nom="Température huile hydraulique",
       normal=70, alerte=85, critique=93, type="max",
       unite="°C", criticite_amdec=13,
       source="OCP officiel : ≥ 93°C — NOUVEAU"),

  # Régime moteur : OCP dit 1750 rpm (surrégime), pas 2100 rpm !
  list(nom="Régime moteur",
       normal=1500, alerte=1650, critique=1750, type="max",
       unite="tr/min", criticite_amdec=14,
       source="OCP officiel : > 1750 rpm — CORRIGÉ (avant: 2100)"),

  # Pression air : OCP dit 600-900 KPa (plage normale)
  list(nom="Pression d'air au réservoir",
       normal=750, alerte=600, critique=500, type="min",
       unite="KPa", criticite_amdec=13,
       source="OCP officiel : 600 à 900 KPa — CORRIGÉ (avant: 400 KPa)"),

  # Pression huile moteur à régime nominal 1500 rpm (interpolée)
  # OCP : 140 KPa à 750 rpm / 275 KPa à 1700 rpm
  # À 1500 rpm : 140 + (1500-750)/(1700-750) * (275-140) ≈ 247 KPa
  list(nom="Pression huile moteur",
       normal=300, alerte=247, critique=200, type="min",
       unite="KPa", criticite_amdec=16,
       source="OCP officiel dynamique — interpolé à 1500 rpm nominal"),

  list(nom="Pression auto-graissage",
       normal=18000, alerte=15000, critique=12000, type="min",
       unite="KPa", criticite_amdec=12,
       source="OCP officiel : 15 000 à 21 000 KPa"),

  list(nom="Pression pompe hydraulique principale",
       normal=20000, alerte=15000, critique=12000, type="min",
       unite="KPa", criticite_amdec=11,
       source="OCP officiel : 15 000 à 25 000 KPa")
)

# ─── Fonction seuil dynamique pression huile selon RPM ───────────────────────
seuil_pression_huile_rpm <- function(rpm) {
  # OCP : Min 140 KPa à 750 rpm / Min 275 KPa à 1700 rpm
  rpm1 <- 750;  p1 <- 140
  rpm2 <- 1700; p2 <- 275

  if (rpm <= rpm1) return(p1)
  if (rpm >= rpm2) return(p2)
  return(p1 + (rpm - rpm1) / (rpm2 - rpm1) * (p2 - p1))
}

# ─── Afficher le résumé ──────────────────────────────────────────────────────
cat("═══════════════════════════════════════════════════════\n")
cat("  Seuils OCP chargés —", length(CAPTEURS_CONFIG_OCP), "capteurs\n")
cat("═══════════════════════════════════════════════════════\n")
for (cfg in CAPTEURS_CONFIG_OCP) {
  cat(sprintf("  %-42s [%s] → critique=%s %s\n",
    substr(cfg$nom, 1, 42),
    cfg$type,
    ifelse(cfg$type=="max", cfg$critique, cfg$critique),
    cfg$unite))
}
cat("\n")
cat("Changements vs anciens seuils :\n")
cat("  ✅ Régime moteur : 2100 → 1750 tr/min (surrégime OCP)\n")
cat("  ✅ Pression huile : fixe → dynamique selon RPM\n")
cat("  ✅ Pression air   : 400 → 500-600 KPa (seuil OCP)\n")
cat("  ✅ Temp. hydraulique : NOUVEAU (93°C)\n")
