/**
 * DiagnosePage.jsx  —  VERSION 2  (Mine Assist · OCP · CAT 994F)
 * ═══════════════════════════════════════════════════════════════
 *
 *  ① DÉCODEUR INSTANTANÉ  — Panel gauche
 *     - Parser auto  : "MID 081 CID 1403 FMI 06"  ou  "E100"  ou  "CID 0096 FMI 04"
 *     - Affiche immédiatement : composant, type de panne, action prioritaire
 *     - Données : CHF442.pdf (FMI, MID, CID) + RENR6306 (procédures)
 *
 *  ② RÉFÉRENTIEL VIMS / EVENT CODES
 *     - Table complète E-codes moteur + VIMS
 *     - Recherche par numéro ou mot-clé
 *
 *  ③ LOCALISATION COMPOSANT (CHF442 p.3–5)
 *     - Position schéma (ex: C-13) + emplacement machine
 *     - Code couleur par sous-système
 *
 *  ④ DIAGNOSTIC LLM STRUCTURÉ (backend /diagnose)
 *     - Context injecté : données Excel GMAO + CODE_BILOUCHE.txt
 *     - Rendu structuré avec DiagnosticRenderer + steps SIS
 *     - Export PDF disponible
 *
 *  ⑤ SUPPORT EXCEL / GMAO
 *     - Upload fichier Excel → contexte injecté dans le prompt LLM
 *     - Affichage résumé statistique des capteurs
 */

import { useState, useEffect } from 'react'
import DiagnosticRenderer from './DiagnosticRenderer'
import { API, C } from '../config'

// ─────────────────────────────────────────────────────────────────────────────
//  BASE DE DONNÉES LOCALE  — extraite de CHF442.pdf + RENR6306 + RENR9347
// ─────────────────────────────────────────────────────────────────────────────

const FMI_DB = {
  0:  { label: 'Signal au-dessus de la plage normale',          icone: '↑',  classe: 'signal',   couleur: '#E67E22',
        action: 'Vérifier la plage opérationnelle du capteur. Contrôler les connexions harnais.' },
  1:  { label: 'Signal en-dessous de la plage normale',         icone: '↓',  classe: 'signal',   couleur: '#E67E22',
        action: 'Vérifier la plage opérationnelle du capteur. Contrôler les connexions harnais.' },
  2:  { label: 'Données erratiques / intermittentes',           icone: '~',  classe: 'signal',   couleur: '#E67E22',
        action: 'Vérifier les connexions et le câblage. Inspecter le harnais pour corrosion/frottement.' },
  3:  { label: 'Tension au-dessus de la normale (court-circuit +bat)',  icone: '+', classe: 'court+', couleur: '#C0392B',
        action: '1) Déconnecter le composant. 2) Mesurer tension au connecteur ECM. 3) Si tension reste haute → court-circuit harnais vers +bat.' },
  4:  { label: 'Tension en-dessous de la normale (court-circuit masse)', icone: '−', classe: 'court-', couleur: '#C0392B',
        action: '1) Déconnecter le composant. 2) Mesurer tension. 3) Vérifier fil de masse. 4) Mesurer résistance vers chassis.' },
  5:  { label: 'Courant faible / circuit ouvert',                icone: '○',  classe: 'ouvert',  couleur: '#8E44AD',
        action: '1) Vérifier continuité du harnais. 2) Vérifier connecteur déconnecté. 3) Mesurer résistance du solénoïde/capteur.' },
  6:  { label: 'Courant élevé / circuit à la masse',             icone: '⏚',  classe: 'court-gnd', couleur: '#C0392B',
        action: '1) Déconnecter solénoïde → FMI change 06→05 ? Oui = solénoïde HS. Non = court-circuit harnais à la masse.' },
  7:  { label: 'Système mécanique ne répond pas',                icone: '⚙', classe: 'mecanique', couleur: '#E67E22',
        action: 'Contrôle mécanique direct. Vérifier blocage, usure, pression hydraulique.' },
  8:  { label: 'Fréquence / largeur d\'impulsion anormale',       icone: '⟳',  classe: 'frequence', couleur: '#2980B9',
        action: 'Vérifier capteur de vitesse ou régime. Nettoyer piste du capteur. Mesurer entrefer.' },
  9:  { label: 'Mise à jour anormale (datalink)',                 icone: '⚡',  classe: 'comm',    couleur: '#2980B9',
        action: 'Vérifier connexion CAN datalink. Contrôler résistances de terminaison (108-132 Ω).' },
  10: { label: 'Taux de variation anormal',                      icone: '△',  classe: 'signal',   couleur: '#E67E22',
        action: 'Vérifier dérive capteur ou vibration anormale. Contrôler fixations mécaniques.' },
  11: { label: 'Mode de défaillance non identifiable',            icone: '?',  classe: 'inconnu',  couleur: '#7F8C8D',
        action: 'Procédure diagnostique complète requise. Vérifier alimentations ECM et harnais.' },
  12: { label: 'Composant / dispositif défectueux',               icone: '✕',  classe: 'composant', couleur: '#C0392B',
        action: 'Remplacer le composant. Vérifier d\'abord le câblage pour éliminer cause externe.' },
  13: { label: 'Hors calibration',                               icone: '⊡',  classe: 'calibrage', couleur: '#E67E22',
        action: 'Recalibrer selon procédure Testing & Adjusting. Voir manuel RENR correspondant.' },
  17: { label: 'Module ne répond pas',                           icone: '□',  classe: 'comm',     couleur: '#8E44AD',
        action: 'Vérifier alimentation ECM (+24V commuté). Contrôler fusibles E-bay. Vérifier CAN datalink.' },
  18: { label: 'Défaut alimentation capteur (+8V ou +10V)',       icone: '⚡',  classe: 'alim',    couleur: '#8E44AD',
        action: 'Vérifier alimentation +8V/+10V sortie ECM. Court-circuit sur fil d\'alimentation capteurs ?' },
  19: { label: 'Condition non remplie',                          icone: '⊗',  classe: 'logique',  couleur: '#2980B9',
        action: 'Vérifier conditions de fonctionnement requises par la logique ECM.' },
}

const MID_DB = {
  '036': { label: 'Engine Control (ECM Moteur)',             sys: 'Moteur',         couleur: '#C0392B', manuel: 'RENR9347', desc: 'Contrôle injection, régime, températures moteur' },
  '081': { label: 'Electronic Transmission Control (TCM)',  sys: 'Transmission',   couleur: '#E67E22', manuel: 'RENR6306', desc: 'Contrôle embrayages, solénoïdes, vitesses' },
  '082': { label: 'Electronic Implement Control',           sys: 'Hydraulique',    couleur: '#2980B9', manuel: 'RENR6323', desc: 'Contrôle levée, basculement, pompe impléments' },
  '049': { label: 'VIMS — Vital Information Management',    sys: 'VIMS',           couleur: '#8E44AD', manuel: 'RENR6318', desc: 'Monitoring, alertes, journal événements' },
}

// CID principaux — Sources: CHF442.pdf p.3-5 + RENR6306
const CID_DB = {
  // ─── MID 036 — Moteur ────────────────────────────────────
  '036-0001': { nom: 'Injecteur cylindre 1',                    schemaPos: 'F-16', machinePos: 'Moteur côté gauche',     sous_sys: 'Moteur' },
  '036-0002': { nom: 'Injecteur cylindre 2',                    schemaPos: 'E-16', machinePos: 'Moteur côté gauche',     sous_sys: 'Moteur' },
  '036-0003': { nom: 'Injecteur cylindre 3',                    schemaPos: 'F-16', machinePos: 'Moteur côté gauche',     sous_sys: 'Moteur' },
  '036-0091': { nom: 'Capteur position pédale accélérateur',    schemaPos: 'B-10', machinePos: 'Cabine — plancher',      sous_sys: 'Moteur' },
  '036-0096': { nom: 'Capteur niveau carburant',                schemaPos: 'I-13', machinePos: 'Réservoir carburant',    sous_sys: 'Moteur' },
  '036-0101': { nom: 'Capteur pression carter moteur',          schemaPos: 'H-16', machinePos: 'Moteur — carter',        sous_sys: 'Moteur' },
  '036-0110': { nom: 'Capteur temp. liquide refroidissement',   schemaPos: 'F-15', machinePos: 'Moteur — sortie pompe',  sous_sys: 'Moteur' },
  '036-0168': { nom: 'Tension système électrique',              schemaPos: 'G-11', machinePos: 'E-Bay — junction block', sous_sys: 'Électrique' },
  '036-0190': { nom: 'Signal régime moteur (Speed)',            schemaPos: 'I-15', machinePos: 'Moteur — vilebrequin',   sous_sys: 'Moteur' },
  '036-0253': { nom: 'Module personnalité (Personality)',       schemaPos: 'D-16', machinePos: 'ECM Moteur',             sous_sys: 'Moteur' },
  '036-0261': { nom: 'Calibration calage distribution',        schemaPos: 'G-15', machinePos: 'Moteur — distribution',  sous_sys: 'Moteur' },
  '036-0273': { nom: 'Capteur pression sortie turbo',           schemaPos: 'G-16', machinePos: 'Turbo — sortie',         sous_sys: 'Moteur' },
  '036-0274': { nom: 'Capteur pression atmosphérique',          schemaPos: 'G-16', machinePos: 'Moteur — admission',     sous_sys: 'Moteur' },
  '036-0275': { nom: 'Capteur pression entrée turbo D',         schemaPos: 'G-15', machinePos: 'Turbo droit',            sous_sys: 'Moteur' },
  '036-0276': { nom: 'Capteur pression entrée turbo G',         schemaPos: 'G-16', machinePos: 'Turbo gauche',           sous_sys: 'Moteur' },
  '036-0291': { nom: 'Solénoïde ventilateur refroidissement',   schemaPos: 'G-15', machinePos: 'Ventilateur radiateur',  sous_sys: 'Moteur' },
  '036-0338': { nom: 'Relais pré-lubrification',                schemaPos: 'F-7',  machinePos: 'E-Bay',                 sous_sys: 'Moteur' },
  '036-0542': { nom: 'Capt. pression huile non-filtrée',        schemaPos: 'G-16', machinePos: 'Moteur — bloc',          sous_sys: 'Moteur' },
  '036-0543': { nom: 'Capt. pression huile filtrée',            schemaPos: 'F-16', machinePos: 'Moteur — filtre huile',  sous_sys: 'Moteur' },
  '036-0590': { nom: 'Communication ECM transmission',          schemaPos: 'D-16', machinePos: 'ECM Moteur',             sous_sys: 'Communication' },
  '036-0800': { nom: 'Communication VIMS ECM',                  schemaPos: 'D-16', machinePos: 'ECM Moteur',             sous_sys: 'Communication' },
  '036-0827': { nom: 'Capt. temp. échappement gauche',          schemaPos: 'F-15', machinePos: 'Moteur — échappement G', sous_sys: 'Moteur' },
  '036-0828': { nom: 'Capt. temp. échappement droite',          schemaPos: 'G-15', machinePos: 'Moteur — échappement D', sous_sys: 'Moteur' },
  // ─── MID 081 — Transmission ──────────────────────────────
  '081-0041': { nom: 'Alimentation capteur (+8V/+10V)',          schemaPos: 'C-13', machinePos: 'TCM — connecteur J2',    sous_sys: 'Transmission' },
  '081-0070': { nom: 'Switch frein de stationnement (pos.)',     schemaPos: 'E-13', machinePos: 'Châssis arrière',        sous_sys: 'Freinage' },
  '081-0138': { nom: 'Switch sélection réduction rimpull',       schemaPos: 'E-6',  machinePos: 'Console opérateur',      sous_sys: 'Transmission' },
  '081-0168': { nom: 'Tension système électrique',               schemaPos: 'G-11', machinePos: 'E-Bay',                 sous_sys: 'Électrique' },
  '081-0190': { nom: 'Signal régime moteur (depuis ECM)',         schemaPos: 'F-16', machinePos: 'ECM Moteur → TCM',      sous_sys: 'Communication' },
  '081-0348': { nom: 'Switch verrouillage transmission',         schemaPos: 'H-16', machinePos: 'Console gauche bas',     sous_sys: 'Transmission' },
  '081-0378': { nom: 'Solénoïde autolubrification',              schemaPos: 'B-4',  machinePos: 'Châssis avant',          sous_sys: 'Lubrification' },
  '081-0379': { nom: 'Capteur pression autolube',                schemaPos: 'B-4',  machinePos: 'Châssis avant',          sous_sys: 'Lubrification' },
  '081-0585': { nom: 'Capteur vitesse sortie XMT n°1',           schemaPos: 'E-10', machinePos: 'Transmission — sortie',  sous_sys: 'Transmission' },
  '081-0590': { nom: 'Communication ECM Moteur',                 schemaPos: 'D-16', machinePos: 'TCM → ECM',             sous_sys: 'Communication' },
  '081-0596': { nom: 'Communication ECM Impléments',             schemaPos: 'E-6',  machinePos: 'TCM → Impl. ECM',       sous_sys: 'Communication' },
  '081-0603': { nom: 'Capt. pression embrayage impulseur TC',    schemaPos: 'C-13', machinePos: 'Convertisseur couple',   sous_sys: 'Transmission' },
  '081-0623': { nom: 'Switch direction (N/F/R)',                 schemaPos: 'G-5',  machinePos: 'TCM — connecteur',       sous_sys: 'Transmission' },
  '081-0626': { nom: 'Switch STIC — verrouillage',               schemaPos: 'H-11', machinePos: 'Console opérateur',      sous_sys: 'Transmission' },
  '081-0627': { nom: 'Pressostat frein parking (pression)',       schemaPos: 'E-13', machinePos: 'Châssis arrière',        sous_sys: 'Freinage' },
  '081-0650': { nom: 'Code harnais (Harness Code)',               schemaPos: 'E-11', machinePos: 'Harnais — TCM',          sous_sys: 'Électrique' },
  '081-0670': { nom: 'Capteur position pédale TC',               schemaPos: 'E-10', machinePos: 'Cabine — plancher droit', sous_sys: 'Transmission' },
  '081-0672': { nom: 'Capteur vitesse sortie TC',                schemaPos: 'C-13', machinePos: 'Convertisseur couple',   sous_sys: 'Transmission' },
  '081-0673': { nom: 'Capteur vitesse sortie XMT n°2',           schemaPos: 'E-10', machinePos: 'Transmission — sortie',  sous_sys: 'Transmission' },
  '081-0678': { nom: 'Vanne modulante embrayage impulseur TC',   schemaPos: 'D-13', machinePos: 'Convertisseur couple',   sous_sys: 'Transmission' },
  '081-0679': { nom: 'Vanne modulante embrayage lockup TC',      schemaPos: 'D-13', machinePos: 'Convertisseur couple',   sous_sys: 'Transmission' },
  '081-0800': { nom: 'Communication VIMS ECM',                   schemaPos: 'H-5',  machinePos: 'E-Bay — VIMS',           sous_sys: 'Communication' },
  '081-1401': { nom: 'Solénoïde CL1 — Marche arrière',           schemaPos: 'E-11', machinePos: 'Transmission — valve',   sous_sys: 'Transmission' },
  '081-1402': { nom: 'Solénoïde CL2 — Marche avant',             schemaPos: 'E-11', machinePos: 'Transmission — valve',   sous_sys: 'Transmission' },
  '081-1403': { nom: 'Solénoïde CL3 — 3ème vitesse',             schemaPos: 'E-11', machinePos: 'Transmission — valve',   sous_sys: 'Transmission' },
  '081-1404': { nom: 'Solénoïde CL4 — 2ème vitesse',             schemaPos: 'D-11', machinePos: 'Transmission — valve',   sous_sys: 'Transmission' },
  '081-1405': { nom: 'Solénoïde CL5 — 1ère vitesse',             schemaPos: 'D-11', machinePos: 'Transmission — valve',   sous_sys: 'Transmission' },
  // ─── MID 082 — Impléments ────────────────────────────────
  '082-0168': { nom: 'Tension système électrique',               schemaPos: 'E-6',  machinePos: 'Impl. ECM',              sous_sys: 'Électrique' },
  '082-0296': { nom: 'Communication TCM',                        schemaPos: 'E-6',  machinePos: 'Impl. ECM → TCM',        sous_sys: 'Communication' },
  '082-0350': { nom: 'Capteur position levée',                   schemaPos: 'B-4',  machinePos: 'Flèche — axe levée',     sous_sys: 'Hydraulique' },
  '082-0359': { nom: 'Solénoïde détente levée (kickout)',        schemaPos: 'A-4',  machinePos: 'Levée — valve',          sous_sys: 'Hydraulique' },
  '082-0360': { nom: 'Solénoïde détente descente',               schemaPos: 'A-4',  machinePos: 'Levée — valve',          sous_sys: 'Hydraulique' },
  '082-0361': { nom: 'Solénoïde détente basculement godet',      schemaPos: 'A-4',  machinePos: 'Basculement — valve',    sous_sys: 'Hydraulique' },
  '082-0590': { nom: 'Communication ECM Moteur',                 schemaPos: 'E-6',  machinePos: 'Impl. ECM → ECM',        sous_sys: 'Communication' },
  '082-0767': { nom: 'Capteur pression pompe impléments',        schemaPos: 'A-5',  machinePos: 'Pompe impl. — pression', sous_sys: 'Hydraulique' },
  '082-2330': { nom: 'Solénoïde arrêt levée',                   schemaPos: 'A-4',  machinePos: 'Levée — valve',          sous_sys: 'Hydraulique' },
  '082-2332': { nom: 'Solénoïde pompe impléments',               schemaPos: 'B-6',  machinePos: 'Pompe impl.',            sous_sys: 'Hydraulique' },
  // ─── MID 049 — VIMS ──────────────────────────────────────
  '049-0096': { nom: 'Capteur niveau carburant (VIMS)',          schemaPos: 'I-13', machinePos: 'Réservoir carburant',    sous_sys: 'VIMS' },
  '049-0075': { nom: 'Capteur temp. huile direction',            schemaPos: 'B-13', machinePos: 'Pompe direction',        sous_sys: 'Direction' },
  '049-0127': { nom: 'Capteur pression huile transmission',      schemaPos: 'C-13', machinePos: 'Transmission',          sous_sys: 'Transmission' },
  '049-0171': { nom: 'Capteur temp. air ambiant',                schemaPos: 'I-13', machinePos: 'Chassis — extérieur',   sous_sys: 'Moteur' },
  '049-0248': { nom: 'CAT DataLink (communication)',             schemaPos: 'D-7',  machinePos: 'Harnais datalink',       sous_sys: 'Communication' },
  '049-0427': { nom: 'Capteur temp. huile essieu avant',         schemaPos: 'A-5',  machinePos: 'Essieu avant',          sous_sys: 'Essieux' },
  '049-0428': { nom: 'Capteur temp. huile essieu arrière',       schemaPos: 'A-16', machinePos: 'Essieu arrière',        sous_sys: 'Essieux' },
  '049-0457': { nom: 'Capteur temp. huile freins',               schemaPos: 'B-13', machinePos: 'Circuit freinage',      sous_sys: 'Freinage' },
  '049-0600': { nom: 'Capteur temp. huile hydraulique',          schemaPos: 'A-6',  machinePos: 'Réservoir hydraulique', sous_sys: 'Hydraulique' },
  '049-0826': { nom: 'Capteur temp. huile TC',                   schemaPos: 'C-13', machinePos: 'Convertisseur couple',  sous_sys: 'Transmission' },
  '049-0860': { nom: 'Capteur temp. huile pompe avant',          schemaPos: 'B-6',  machinePos: 'Pompe transmission avant', sous_sys: 'Transmission' },
}

// VIMS Event Codes — CHF442.pdf p.8 + manuel RENR6318
const VIMS_EVENTS = {
  'E017': { desc: 'Haute température du liquide de refroidissement',     gravite: 3, sys: 'Moteur',       action: 'Arrêt immédiat. Vérifier niveau liquide, courroie ventilateur, thermostat.' },
  'E021': { desc: 'Haute température d\'échappement',                    gravite: 3, sys: 'Moteur',       action: 'Réduire charge. Vérifier restriction admission, injection.' },
  'E035': { desc: 'Perte de débit liquide de refroidissement',           gravite: 3, sys: 'Moteur',       action: 'Arrêt immédiat. Vérifier pompe eau, courroie, fuite circuit.' },
  'E038': { desc: 'Basse température liquide de refroidissement',        gravite: 1, sys: 'Moteur',       action: 'Normal au démarrage. Si persistant: thermostat bloqué ouvert.' },
  'E047': { desc: 'Abus transmission (vitesse excessive en virage)',      gravite: 2, sys: 'Transmission', action: 'Réduire vitesse. Respecter procédure de conduite. Vérifier freins.' },
  'E049': { desc: 'Avertissement roue libre en position neutre',          gravite: 2, sys: 'Transmission', action: 'Ne pas passer en neutre en descente. Vérifier frein moteur.' },
  'E072': { desc: 'Niveau huile bas (repère minimum)',                   gravite: 2, sys: 'Moteur',       action: 'Arrêter moteur. Refaire le niveau. Vérifier fuite.' },
  'E073': { desc: 'Pression différentielle filtre huile élevée',         gravite: 2, sys: 'Moteur',       action: 'Remplacer filtre huile dès que possible.' },
  'E074': { desc: 'Pression différentielle filtre huile très élevée',    gravite: 3, sys: 'Moteur',       action: 'Remplacer filtre huile immédiatement. Risque contamination moteur.' },
  'E095': { desc: 'Restriction du filtre à carburant',                   gravite: 2, sys: 'Moteur',       action: 'Remplacer filtre carburant. Vérifier contamination réservoir.' },
  'E098': { desc: 'Dérogation pré-lubrification moteur',                 gravite: 2, sys: 'Moteur',       action: 'Ne pas démarrer sans pré-lubrification. Vérifier relais et moteur prélube.' },
  'E100': { desc: 'Pression huile moteur basse',                         gravite: 3, sys: 'Moteur',       action: 'Arrêt IMMÉDIAT. Vérifier niveau, capteur CID 542/543, pompe huile.' },
  'E101': { desc: 'Pression carter moteur élevée (blow-by)',             gravite: 3, sys: 'Moteur',       action: 'Vérifier étanchéité segments. Vérifier filtre dégazeur.' },
  'E190': { desc: 'Survitesse moteur',                                   gravite: 3, sys: 'Moteur',       action: 'Frein moteur. Vérifier régulateur et capteur régime (CID 190).' },
  'E272': { desc: 'Restriction air d\'admission',                         gravite: 2, sys: 'Moteur',       action: 'Nettoyer / remplacer filtre à air. Vérifier durites d\'admission.' },
  'E279': { desc: 'Haute température refroidisseur d\'admission',         gravite: 2, sys: 'Moteur',       action: 'Nettoyer faisceau aftercooler. Vérifier débit eau de refroidissement.' },
  'E540': { desc: 'Bas niveau réservoir appoint huile moteur',           gravite: 2, sys: 'Moteur',       action: 'Refaire le niveau. Vérifier consommation huile anormale.' },
  'E627': { desc: 'Machine conduite avec frein de stationnement serré',  gravite: 3, sys: 'Freinage',     action: 'Vérifier switch frein parking (CID 627). Inspecter disques frein.' },
  'E2089':{ desc: 'Système de renouvellement d\'huile inopérant',        gravite: 2, sys: 'Moteur',       action: 'Vérifier solénoïde Oil Renewal (CID 0819). Niveau huile.' },
}

// Couleurs sous-systèmes
const SYS_COLORS = {
  'Moteur': '#C0392B', 'Transmission': '#E67E22', 'Hydraulique': '#2980B9',
  'Freinage': '#8E44AD', 'Direction': '#16A085', 'Essieux': '#27AE60',
  'Électrique': '#F39C12', 'VIMS': '#9B59B6', 'Communication': '#7F8C8D',
  'Lubrification': '#1ABC9C',
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSEUR DE CODE  — détecte MID/CID/FMI ou E-code ou CID seul
// ─────────────────────────────────────────────────────────────────────────────
function parseCode(rawCode) {
  if (!rawCode) return null
  const s = rawCode.trim().toUpperCase()

  // Pattern: MID 081 CID 1403 FMI 06
  const m1 = s.match(/MID[_\s]?(\d{3})[_\s,/]+CID[_\s]?(\d{4})[_\s,/]+FMI[_\s]?(\d{1,2})/i)
  if (m1) return { type: 'MID_CID_FMI', mid: m1[1], cid: m1[2].padStart(4,'0'), fmi: parseInt(m1[3]) }

  // Pattern: CID 1403 FMI 06 (sans MID)
  const m2 = s.match(/CID[_\s]?(\d{4})[_\s,/]+FMI[_\s]?(\d{1,2})/i)
  if (m2) return { type: 'CID_FMI', cid: m2[1].padStart(4,'0'), fmi: parseInt(m2[2]) }

  // Pattern: MID 036 CID 0110 (sans FMI)
  const m3 = s.match(/MID[_\s]?(\d{3})[_\s,/]+CID[_\s]?(\d{4})/i)
  if (m3) return { type: 'MID_CID', mid: m3[1], cid: m3[2].padStart(4,'0') }

  // VIMS E-code: E100, E-100, E2089
  const m4 = s.match(/^E[-_]?(\d{1,4})(-\d)?$/)
  if (m4) return { type: 'VIMS_E', code: `E${m4[1]}` }

  // MID seul
  const m5 = s.match(/^MID[_\s]?(\d{3})$/)
  if (m5) return { type: 'MID', mid: m5[1] }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPOSANTS UI
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  card: {
    background: 'rgba(255,253,248,0.97)', border: `1px solid ${C.border}`,
    borderTop: `2px solid ${C.sand}`, padding: '18px 22px', marginBottom: 14,
    backdropFilter: 'blur(8px)', boxShadow: '0 2px 10px rgba(139,105,20,0.07)',
  },
  label: {
    display: 'block', fontSize: 10, fontWeight: 700, color: C.textMuted,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    width: '100%', background: 'rgba(255,255,255,0.9)', border: `1px solid ${C.border}`,
    color: C.text, padding: '10px 13px', fontFamily: "'Rajdhani', system-ui",
    fontSize: 14, outline: 'none', boxSizing: 'border-box', transition: 'all 0.2s',
    borderRadius: 4,
  },
  textarea: {
    width: '100%', background: 'rgba(255,255,255,0.9)', border: `1px solid ${C.border}`,
    color: C.text, padding: '10px 13px', fontFamily: "'Rajdhani', system-ui",
    fontSize: 14, outline: 'none', resize: 'vertical', minHeight: 90,
    boxSizing: 'border-box', transition: 'all 0.2s', borderRadius: 4,
  },
  btn: {
    background: C.green, color: '#fff', border: 'none', padding: '10px 28px',
    fontFamily: "'Rajdhani', system-ui", fontSize: 12, fontWeight: 700,
    letterSpacing: 2, cursor: 'pointer', textTransform: 'uppercase', borderRadius: 4,
    transition: 'all 0.2s',
  },
  btnOff: {
    background: C.border, color: C.textLight, border: 'none', padding: '10px 28px',
    fontFamily: "'Rajdhani', system-ui", fontSize: 12, fontWeight: 700,
    letterSpacing: 2, cursor: 'not-allowed', textTransform: 'uppercase', borderRadius: 4,
  },
}

function PageTitle({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, color: C.textMuted, letterSpacing: 4,
      textTransform: 'uppercase', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ width: 4, height: 16, background: C.green, borderRadius: 2 }} />
      {children}
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${C.border},transparent)` }} />
    </div>
  )
}

/** Panel de décodage instantané */
function DecoderPanel({ parsed }) {
  if (!parsed) {
    return (
      <div style={{ ...S.card, borderTop: `2px solid ${C.border}` }}>
        <div style={S.label}>🔍 Décodage automatique</div>
        <div style={{ fontSize: 12, color: C.textLight, fontStyle: 'italic', padding: '8px 0' }}>
          Entrez un code défaut (ex: "MID 081 CID 1403 FMI 06" ou "E100") pour le décoder instantanément.
        </div>
      </div>
    )
  }

  if (parsed.type === 'VIMS_E') {
    const ev = VIMS_EVENTS[parsed.code]
    const g = ev?.gravite || 0
    const gColor = g >= 3 ? '#C0392B' : g >= 2 ? '#E67E22' : '#27AE60'
    return (
      <div style={{ ...S.card, borderTop: `3px solid ${gColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{
            fontSize: 22, fontWeight: 900, fontFamily: 'monospace',
            background: gColor, color: '#fff', padding: '3px 10px', borderRadius: 4,
          }}>{parsed.code}</span>
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>EVENT CODE VIMS</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
              {ev?.desc || `Code VIMS ${parsed.code} — consulter RENR6318`}
            </div>
          </div>
        </div>
        {ev && <>
          <InfoRow label="Sous-système" value={ev.sys} couleur={SYS_COLORS[ev.sys]} />
          <InfoRow label="Sévérité" value={`Gravité ${ev.gravite}`} couleur={gColor} />
          <div style={{ marginTop: 10, background: '#FFF9F0', border: `1px solid ${gColor}30`,
            borderLeft: `4px solid ${gColor}`, padding: '10px 14px', borderRadius: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: gColor, letterSpacing: 1, marginBottom: 4 }}>ACTION REQUISE</div>
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{ev.action}</div>
          </div>
        </>}
      </div>
    )
  }

  // MID + CID + FMI
  const mid = parsed.mid
  const cidKey = parsed.mid ? `${parsed.mid}-${(parsed.cid || '').padStart(4, '0')}` : null
  const fmiNum = parsed.fmi

  // Chercher CID dans toutes les MID si pas de MID explicite
  let cidInfo = null
  let detectedMid = mid
  if (cidKey && CID_DB[cidKey]) {
    cidInfo = CID_DB[cidKey]
  } else if (parsed.cid) {
    for (const mid_try of ['036', '081', '082', '049']) {
      const k = `${mid_try}-${(parsed.cid).padStart(4,'0')}`
      if (CID_DB[k]) {
        cidInfo = CID_DB[k]
        detectedMid = mid_try
        break
      }
    }
  }

  const midInfo = MID_DB[detectedMid || mid]
  const fmiInfo = fmiNum !== undefined ? FMI_DB[fmiNum] : null
  const sysColor = SYS_COLORS[cidInfo?.sous_sys || midInfo?.sys] || C.green

  return (
    <div style={{ ...S.card, borderTop: `3px solid ${sysColor}` }}>
      {/* Titre code */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{
          fontFamily: 'monospace', fontSize: 13, fontWeight: 800,
          background: '#1C1A14', color: '#fff', padding: '6px 12px', borderRadius: 4,
          lineHeight: 1.4, whiteSpace: 'nowrap',
        }}>
          {mid && `MID ${mid}`}{parsed.cid && ` CID ${parsed.cid.padStart(4,'0')}`}
          {fmiNum !== undefined && ` FMI ${String(fmiNum).padStart(2,'0')}`}
        </div>
        {cidInfo && (
          <div>
            <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1, marginBottom: 2 }}>COMPOSANT IDENTIFIÉ</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{cidInfo.nom}</div>
          </div>
        )}
      </div>

      {/* MID */}
      {midInfo && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(0,0,0,0.02)',
          borderRadius: 6, border: `1px solid ${C.borderLt}` }}>
          <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1, marginBottom: 3 }}>MODULE (MID)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
              background: midInfo.couleur + '20', color: midInfo.couleur, border: `1px solid ${midInfo.couleur}40`,
            }}>MID {detectedMid || mid}</span>
            <span style={{ fontSize: 12, color: C.text }}>{midInfo.label}</span>
            <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 'auto' }}>📘 {midInfo.manuel}</span>
          </div>
        </div>
      )}

      {/* CID localisation */}
      {cidInfo && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.02)', borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 1, marginBottom: 2 }}>POSITION SCHÉMA (CHF442)</div>
            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 800, color: sysColor }}>{cidInfo.schemaPos}</div>
          </div>
          <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.02)', borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 1, marginBottom: 2 }}>EMPLACEMENT MACHINE</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{cidInfo.machinePos}</div>
          </div>
          <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.02)', borderRadius: 6, gridColumn: '1/-1' }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 1, marginBottom: 2 }}>SOUS-SYSTÈME</div>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
              background: sysColor + '15', color: sysColor, border: `1px solid ${sysColor}30`,
            }}>{cidInfo.sous_sys}</span>
          </div>
        </div>
      )}

      {/* FMI */}
      {fmiInfo && (
        <div style={{
          background: fmiInfo.couleur + '12', border: `1px solid ${fmiInfo.couleur}40`,
          borderLeft: `4px solid ${fmiInfo.couleur}`, padding: '10px 14px', borderRadius: 4, marginBottom: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 18, fontWeight: 900, color: fmiInfo.couleur,
              width: 28, textAlign: 'center',
            }}>{fmiInfo.icone}</span>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1 }}>FMI {String(fmiNum).padStart(2,'0')} — TYPE DE PANNE</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: fmiInfo.couleur }}>{fmiInfo.label}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.5, paddingLeft: 36 }}>
            {fmiInfo.action}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, couleur }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0', borderBottom: `1px solid ${C.borderLt}` }}>
      <span style={{ fontSize: 11, color: C.textMuted }}>{label}</span>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 3,
        background: (couleur || C.green) + '15', color: couleur || C.green,
      }}>{value}</span>
    </div>
  )
}

/** Table VIMS recherchable */
function VimsTable({ defaultSearch = '' }) {
  const [search, setSearch] = useState(defaultSearch)
  const filtered = Object.entries(VIMS_EVENTS).filter(([code, ev]) => {
    const q = search.toLowerCase()
    return !q || code.toLowerCase().includes(q) || ev.desc.toLowerCase().includes(q) || ev.sys.toLowerCase().includes(q)
  })

  useEffect(() => { setSearch(defaultSearch) }, [defaultSearch])

  return (
    <div style={S.card}>
      <div style={{ ...S.label, marginBottom: 10 }}>📋 Référentiel VIMS — Event Codes (CHF442.pdf p.8)</div>
      <input
        style={{ ...S.input, marginBottom: 10 }}
        placeholder="Rechercher par code, mot-clé ou sous-système…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: C.sandPale }}>
              {['Code', 'Description', 'Système', 'Gravité', 'Action immédiate'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9,
                  fontWeight: 700, color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase',
                  borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(([code, ev], i) => {
              const gColor = ev.gravite >= 3 ? '#C0392B' : ev.gravite >= 2 ? '#E67E22' : '#27AE60'
              return (
                <tr key={code} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAF8' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 800, color: gColor }}>{code}</td>
                  <td style={{ padding: '6px 10px', color: C.text }}>{ev.desc}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                      background: (SYS_COLORS[ev.sys] || C.green) + '15', color: SYS_COLORS[ev.sys] || C.green,
                    }}>{ev.sys}</span>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                      background: gColor + '15', color: gColor,
                    }}>G{ev.gravite}</span>
                  </td>
                  <td style={{ padding: '6px 10px', color: C.textMid, fontSize: 10 }}>
                    {ev.action.length > 60 ? ev.action.slice(0, 60) + '…' : ev.action}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: C.textLight, fontStyle: 'italic' }}>
                Aucun code correspondant
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function DiagnosePage({ onSave, apiFetch }) {
  const [faultCode,    setFaultCode]    = useState('')
  const [symptoms,     setSymptoms]     = useState('')
  const [gmaoCtx,      setGmaoCtx]      = useState('')
  const [hours,        setHours]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState(null)
  const [exporting,    setExporting]    = useState(false)
  const [activeTab,    setActiveTab]    = useState('diag')   // 'diag' | 'vims' | 'fmi_ref'
  const [xlsxSummary,  setXlsxSummary]  = useState(null)
  const [xlsxLoading,  setXlsxLoading]  = useState(false)

  // Décodage instantané du code tapé
  const parsed = faultCode ? parseCode(faultCode) : null

  // Suggestions rapides de codes courants
  const QUICK_CODES = [
    'E100', 'E095', 'E017', 'E101', 'E072',
    'MID 081 CID 1403 FMI 06',
    'MID 081 CID 1404 FMI 03',
    'MID 036 CID 0110 FMI 00',
    'MID 082 CID 0767 FMI 04',
    'MID 049 CID 0096 FMI 05',
  ]

  // ── Upload Excel pour contexte GMAO ───────────────────────────────────────
  const handleXlsxUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setXlsxLoading(true)
    setXlsxSummary(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`${API}/upload-xlsx-context`, { method: 'POST', body: fd })
      if (r.ok) {
        const d = await r.json()
        setXlsxSummary(d.summary || `Fichier chargé : ${file.name}`)
        setGmaoCtx(prev => {
          const header = `\n=== Données Excel : ${file.name} ===\n`
          return (prev || '') + header + (d.summary || '') + '\n'
        })
      }
    } catch (err) {
      setXlsxSummary(`Erreur lecture : ${err.message}`)
    } finally {
      setXlsxLoading(false)
      e.target.value = ''
    }
  }

  // ── Lancement diagnostic LLM ───────────────────────────────────────────────
  const handleDiagnose = async () => {
    setLoading(true)
    setResult(null)
    try {
      const r = await apiFetch(`${API}/diagnose`, {
        method: 'POST',
        body: JSON.stringify({
          fault_code: faultCode || null,
          symptoms: symptoms.split('\n').map(s => s.trim()).filter(Boolean),
          gmao_context: gmaoCtx || null,
          hours_since_maintenance: hours ? parseInt(hours) : null,
        }),
      })
      const data = await r.json()
      setResult(data)
      const q = [faultCode, symptoms.split('\n')[0]].filter(Boolean).join(' — ') || 'Diagnostic'
      onSave?.({
        id: Date.now(), type: 'diagnose', question: q, answer: data.diagnostic,
        sources: data.sources, pdf_images: data.pdf_images,
        schema_locations: data.schema_locations || [],
        timestamp: new Date().toISOString(),
      })
    } catch (e) {
      setResult({ diagnostic: `❌ API inaccessible: ${e.message}`, sources: [], pdf_images: [] })
    }
    setLoading(false)
  }

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    if (!result) return
    setExporting(true)
    try {
      const r = await apiFetch(`${API}/export/rapport-diagnostic`, {
        method: 'POST',
        body: JSON.stringify({
          fault_code: faultCode || null,
          symptoms: symptoms.split('\n').map(s => s.trim()).filter(Boolean),
          gmao_context: gmaoCtx || null,
          hours_since_maintenance: hours ? parseInt(hours) : null,
          diagnostic: result.diagnostic,
          sources: result.sources || [],
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const cd   = r.headers.get('Content-Disposition') || ''
      const fn   = cd.match(/filename="(.+?)"/)?.[1] || 'rapport_diagnostic.pdf'
      a.href = url; a.download = fn; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Export PDF échoué : ${e.message}`)
    }
    setExporting(false)
  }

  const foc = e => { e.target.style.borderColor = C.green; e.target.style.boxShadow = `0 0 0 3px rgba(0,132,61,0.07)` }
  const blr = e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }

  return (
    <div style={{ padding: '26px 32px', maxWidth: 1100, margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap');
        .diag-tab-btn { background: none; border: none; cursor: pointer; transition: all 0.2s; }
        .diag-tab-btn:hover { opacity: 0.75; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <PageTitle>Diagnostic de panne — CAT 994F · OCP Benguérir</PageTitle>

      <div style={{
        padding: '9px 16px', marginBottom: 18,
        background: C.orangePale, border: `1px solid rgba(196,118,10,0.3)`,
        borderLeft: `4px solid ${C.orange}`,
        display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: C.textMid,
        borderRadius: 4,
      }}>
        <span style={{ fontSize: 18 }}>⚠</span>
        Aide à la décision — Consulter le manuel officiel CAT avant toute intervention.
        Sources : CHF442, RENR6306, RENR9347, CODE_BILOUCHE.
      </div>

      {/* ONGLETS */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 18,
        background: 'rgba(255,255,255,0.8)', padding: 4,
        border: `1px solid ${C.border}`, borderRadius: 8, width: 'fit-content',
      }}>
        {[
          { key: 'diag',    label: '🔧 Diagnostic SIS' },
          { key: 'vims',    label: '📊 VIMS Event Codes' },
          { key: 'fmi_ref', label: '📋 Table FMI / MID' },
        ].map(tab => (
          <button key={tab.key} className="diag-tab-btn" onClick={() => setActiveTab(tab.key)} style={{
            padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            fontFamily: "'Rajdhani', system-ui", letterSpacing: 0.5,
            color: activeTab === tab.key ? '#fff' : C.textMuted,
            background: activeTab === tab.key ? C.green : 'transparent',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════ ONGLET DIAGNOSTIC ══════════════════════ */}
      {activeTab === 'diag' && (
        <div style={{ animation: 'fadeIn 0.25s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 18 }}>

            {/* Colonne gauche — Formulaire */}
            <div>
              {/* Code défaut + décodeur */}
              <div style={S.card}>
                <label style={S.label}>Code défaut (MID/CID/FMI ou E-code)</label>
                <input
                  style={S.input}
                  placeholder="Ex: MID 081 CID 1403 FMI 06   ou   E100   ou   CID 0110 FMI 00"
                  value={faultCode}
                  onChange={e => setFaultCode(e.target.value)}
                  onFocus={foc} onBlur={blr}
                />
                {/* Suggestions rapides */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {QUICK_CODES.map(c => (
                    <button key={c} onClick={() => setFaultCode(c)} style={{
                      fontSize: 9, padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                      background: C.greenPale, color: C.greenDark,
                      border: `1px solid ${C.greenLt}`, fontFamily: 'monospace',
                    }}>{c}</button>
                  ))}
                </div>
              </div>

              {/* Symptoms */}
              <div style={S.card}>
                <label style={S.label}>Symptômes observés (un par ligne)</label>
                <textarea
                  style={{ ...S.textarea, minHeight: 90 }}
                  placeholder={'Perte de puissance en côte\nFumée noire à l\'échappement\nVibrations inhabituelles\nBruit lors du changement de vitesse'}
                  value={symptoms}
                  onChange={e => setSymptoms(e.target.value)}
                  onFocus={foc} onBlur={blr}
                />
              </div>

              {/* Heures + GMAO */}
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 14 }}>
                <div style={S.card}>
                  <label style={S.label}>Heures depuis maintenance</label>
                  <input style={S.input} type="number" placeholder="Ex: 250"
                    value={hours} onChange={e => setHours(e.target.value)} onFocus={foc} onBlur={blr} />
                </div>
                <div style={S.card}>
                  <label style={S.label}>Contexte GMAO / Excel / Observations terrain</label>
                  <textarea
                    style={{ ...S.textarea, minHeight: 70 }}
                    placeholder="Historique interventions, codes récurrents, données capteurs..."
                    value={gmaoCtx}
                    onChange={e => setGmaoCtx(e.target.value)}
                    onFocus={foc} onBlur={blr}
                  />
                  {/* Upload Excel */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: C.textMuted, cursor: 'pointer',
                      padding: '5px 10px', borderRadius: 4,
                      border: `1px dashed ${C.border}`, background: '#FAFAF8',
                    }}>
                      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleXlsxUpload} style={{ display: 'none' }} />
                      {xlsxLoading ? '⏳ Lecture…' : '📊 Joindre Excel GMAO'}
                    </label>
                    {xlsxSummary && (
                      <span style={{ fontSize: 10, color: C.green }}>✓ Excel chargé</span>
                    )}
                  </div>
                  {xlsxSummary && (
                    <div style={{
                      marginTop: 6, fontSize: 10, color: C.textMid,
                      background: C.greenPale, padding: '5px 8px', borderRadius: 4,
                      maxHeight: 60, overflow: 'hidden', fontFamily: 'monospace',
                    }}>
                      {xlsxSummary.slice(0, 300)}{xlsxSummary.length > 300 && '…'}
                    </div>
                  )}
                </div>
              </div>

              {/* Bouton */}
              <button
                style={loading ? S.btnOff : { ...S.btn, width: '100%', padding: '12px 0', letterSpacing: 3 }}
                onClick={handleDiagnose}
                disabled={loading}
              >
                {loading ? '⟳  Analyse SIS en cours…' : '▶  Lancer le diagnostic'}
              </button>
            </div>

            {/* Colonne droite — Décodeur instantané */}
            <div>
              <div style={{ ...S.label, marginBottom: 10 }}>⚡ Décodage instantané</div>
              <DecoderPanel parsed={parsed} faultCode={faultCode} />

              {/* Table FMI mini */}
              {faultCode && parsed?.fmi !== undefined && (
                <div style={{ ...S.card, marginTop: 14 }}>
                  <div style={{ ...S.label, marginBottom: 8 }}>📋 Tous les FMI — procédure type</div>
                  {Object.entries(FMI_DB).map(([n, f]) => (
                    <div key={n} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0',
                      borderBottom: `1px solid ${C.borderLt}`,
                      opacity: parseInt(n) === parsed.fmi ? 1 : 0.45,
                      background: parseInt(n) === parsed.fmi ? f.couleur + '08' : 'transparent',
                    }}>
                      <span style={{
                        fontFamily: 'monospace', fontSize: 10, fontWeight: 800, width: 22,
                        color: f.couleur, flexShrink: 0,
                      }}>
                        {f.icone}
                      </span>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: f.couleur }}>FMI {n.padStart(2,'0')}</div>
                        <div style={{ fontSize: 10, color: C.textMid }}>{f.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Résultat diagnostic LLM ── */}
          {result && (
            <div style={{ ...S.card, marginTop: 14, animation: 'fadeIn 0.3s ease' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
                textTransform: 'uppercase', marginBottom: 14, paddingBottom: 10,
                borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7,
              }}>
                <div style={{ width: 3, height: 11, background: C.sand }} />
                Analyse SIS — CAT 994F · Code {faultCode || 'défaut déclaré'}
              </div>

              <DiagnosticRenderer text={result.diagnostic} />

              {/* Sources */}
              {result.sources?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={S.label}>📚 Sources consultées</div>
                  {result.sources.map((s, i) => {
                    const isSIS = s.toLowerCase().includes('code_bilouche') || s.toLowerCase().includes('renr')
                    const isPDF = s.toLowerCase().includes('.pdf')
                    const icon = isSIS ? '🔧' : isPDF ? '📄' : '📋'
                    return (
                      <div key={i} style={{
                        fontSize: 11, color: C.greenDark, padding: '4px 10px',
                        background: C.greenPale, borderLeft: `3px solid ${C.green}`, marginBottom: 3,
                        borderRadius: 2, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {icon} {s}
                        {isSIS && <span style={{ fontSize: 9, color: C.textMuted, marginLeft: 'auto' }}>SIS CAT</span>}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Bouton export PDF */}
              {result.diagnostic && !result.diagnostic.startsWith('❌') && (
                <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button onClick={handleExportPDF} disabled={exporting} style={{
                    ...S.btn,
                    background: exporting ? C.border : C.greenDark,
                    opacity: exporting ? 0.7 : 1,
                  }}>
                    {exporting ? '⟳  Génération PDF…' : '⬇  Exporter en PDF'}
                  </button>
                  <span style={{ fontSize: 11, color: C.textLight }}>Rapport complet avec sources SIS</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ ONGLET VIMS ══════════════════════ */}
      {activeTab === 'vims' && (
        <div style={{ animation: 'fadeIn 0.25s ease' }}>
          <VimsTable />
        </div>
      )}

      {/* ══════════════════════ ONGLET FMI / MID ══════════════════════ */}
      {activeTab === 'fmi_ref' && (
        <div style={{ animation: 'fadeIn 0.25s ease' }}>
          {/* Table FMI complète */}
          <div style={S.card}>
            <div style={{ ...S.label, marginBottom: 12 }}>
              📋 Table FMI — Failure Mode Identifiers (CHF442.pdf p.8)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.entries(FMI_DB).map(([n, f]) => (
                <div key={n} style={{
                  background: f.couleur + '08', border: `1px solid ${f.couleur}25`,
                  borderLeft: `4px solid ${f.couleur}`, padding: '10px 14px', borderRadius: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: f.couleur, width: 30,
                    }}>{f.icone}</span>
                    <div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>FMI {n.padStart(2,'0')}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: f.couleur }}>{f.label}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }}>{f.action}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Table MID */}
          <div style={S.card}>
            <div style={{ ...S.label, marginBottom: 12 }}>
              🖥 Table MID — Module Identifiers (CHF442.pdf p.9)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.entries(MID_DB).map(([n, m]) => (
                <div key={n} style={{
                  background: m.couleur + '08', border: `1px solid ${m.couleur}25`,
                  borderLeft: `4px solid ${m.couleur}`, padding: '12px 16px', borderRadius: 4,
                }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 800, color: m.couleur }}>
                    MID {n}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>{m.desc}</div>
                  <div style={{ marginTop: 6, fontSize: 10, color: C.textMuted }}>
                    📘 Manuel : <strong>{m.manuel}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
