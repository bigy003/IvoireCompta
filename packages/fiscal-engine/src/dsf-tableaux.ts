/**
 * IvoireCompta — Générateur des 9 tableaux additionnels DGI-CI
 * Spécifiques à la Côte d'Ivoire (non requis par les autres pays OHADA)
 */

import { ResultatFiscal } from "./is-imf"

// ─── Types communs ───────────────────────────────────────────────

export interface LigneEcritureFlat {
  compte:  string
  libelle: string
  debit:   bigint
  credit:  bigint
  date:    Date
  journal: string
  pieceRef?: string
}

// ─── T01 : Relevé des amortissements ────────────────────────────

export interface LigneAmortissement {
  designationBien:    string
  dateAcquisition:    Date
  valeurOrigine:      bigint
  dureeUtilite:       number    // années
  tauxAmortissement:  number    // ex: 0.20 pour 20%
  amortissementsN1:   bigint    // Cumul N-1
  dotationN:          bigint    // Dotation exercice
  amortissementsCum:  bigint    // Cumul total
  valeureNette:       bigint    // VNA = valeurOrigine - amortissementsCum
  compte:             string    // 2xxx
}

export interface TableauT01 {
  code:    "T01"
  lignes:  LigneAmortissement[]
  totaux: {
    valeurOrigine:     bigint
    amortissementsN1:  bigint
    dotationN:         bigint
    amortissementsCum: bigint
    valeurNette:       bigint
  }
}

// ─── T02 : Relevé des provisions ────────────────────────────────

export interface LigneProvision {
  nature:       string
  compteProvision: string    // 39xxx, 49xxx, 59xxx
  soldeN1:      bigint
  dotation:     bigint
  reprise:      bigint
  soldeN:       bigint
  admiseFiscal: boolean
}

export interface TableauT02 {
  code:    "T02"
  lignes:  LigneProvision[]
  totaux: { soldeN1: bigint; dotation: bigint; reprise: bigint; soldeN: bigint }
}

// ─── T03 : État des créances et dettes ──────────────────────────

export interface LigneCreanceDette {
  nature:         string
  compte:         string
  montantBrut:    bigint
  provision:      bigint
  montantNet:     bigint
  echeanceMoins1an: bigint
  echeancePlus1an:  bigint
}

export interface TableauT03 {
  code:     "T03"
  creances: LigneCreanceDette[]
  dettes:   LigneCreanceDette[]
}

// ─── T07 : Tableau de passage résultat comptable → fiscal ────────

export interface TableauT07 {
  code:                "T07"
  resultatComptable:   bigint
  reintegrations: Array<{ libelle: string; montant: bigint; motif: string }>
  deductions:     Array<{ libelle: string; montant: bigint; motif: string }>
  resultatFiscal:      bigint
  deficitReporte:      bigint
  baseImposable:       bigint
}

// ─── T08 : Calcul IS / IMF ───────────────────────────────────────

export interface TableauT08 {
  code:              "T08"
  baseImposable:     bigint
  tauxIs:            number
  isCalcule:         bigint
  chiffreAffairesHT: bigint
  imfCalcule:        bigint
  impotDu:           bigint
  modeImposition:    "IS" | "IMF"
  acomptesVersesN:   bigint
  soldeAPayerAvril:  bigint
}

// ─── T09 : Situation fiscale d'ensemble ─────────────────────────

export interface TableauT09 {
  code:                 "T09"
  isOuImfDu:            bigint
  tvaARegler:           bigint
  itsDu:                bigint
  cnpsDu:               bigint
  totalImpotsDus:       bigint
  acomptesDejaPaies:    bigint
  soldeNet:             bigint
  creditTvaReporte:     bigint
  contentieuxFiscaux:   Array<{ nature: string; montant: bigint; statut: string }>
}

// ─── Générateurs ─────────────────────────────────────────────────

/**
 * Génère T07 depuis le résultat fiscal calculé
 */
export function genererT07(rf: ResultatFiscal): TableauT07 {
  return {
    code:              "T07",
    resultatComptable: rf.resultatComptable,
    reintegrations:    rf.reintegrations,
    deductions:        rf.deductions,
    resultatFiscal:    rf.resultatFiscal,
    deficitReporte:    rf.deficitReporteN1,
    baseImposable:     rf.baseImposable,
  }
}

/**
 * Génère T08 depuis le résultat fiscal calculé
 */
export function genererT08(rf: ResultatFiscal): TableauT08 {
  return {
    code:              "T08",
    baseImposable:     rf.baseImposable,
    tauxIs:            rf.tauxIs,
    isCalcule:         rf.isCalcule,
    chiffreAffairesHT: rf.chiffreAffairesHT,
    imfCalcule:        rf.imfCalcule,
    impotDu:           rf.impotDu,
    modeImposition:    rf.modeImposition,
    acomptesVersesN:   rf.acomptesVersesN,
    soldeAPayerAvril:  rf.soldeAPayerAvril,
  }
}

/**
 * Génère T09 — situation fiscale d'ensemble
 */
export function genererT09(params: {
  isOuImfDu:         bigint
  tvaARegler:        bigint
  itsDu:             bigint
  cnpsDu:            bigint
  acomptesDejaPaies: bigint
  creditTvaReporte:  bigint
}): TableauT09 {
  const totalImpotsDus = params.isOuImfDu + params.tvaARegler
                       + params.itsDu + params.cnpsDu
  const soldeNet = totalImpotsDus - params.acomptesDejaPaies

  return {
    code:              "T09",
    isOuImfDu:         params.isOuImfDu,
    tvaARegler:        params.tvaARegler,
    itsDu:             params.itsDu,
    cnpsDu:            params.cnpsDu,
    totalImpotsDus,
    acomptesDejaPaies: params.acomptesDejaPaies,
    soldeNet,
    creditTvaReporte:  params.creditTvaReporte,
    contentieuxFiscaux: [],
  }
}

/**
 * Contrôles de cohérence avant dépôt DSF
 * Retourne la liste des erreurs bloquantes et avertissements
 */
export function controlerCoherenceDSF(params: {
  totalActif:        bigint
  totalPassif:       bigint
  resultatBilan:     bigint
  resultatCR:        bigint
  variationTresorerie: bigint
  tresorerieDebutN:  bigint
  tresorerieFinN:    bigint
  tableauT07:        TableauT07
  tableauT08:        TableauT08
}): { erreurs: string[]; avertissements: string[] } {
  const erreurs: string[] = []
  const avert:   string[] = []

  // BLOQUANT : Bilan équilibré
  if (params.totalActif !== params.totalPassif) {
    erreurs.push(
      `Bilan déséquilibré : Actif ${fmt(params.totalActif)} ≠ Passif ${fmt(params.totalPassif)}`
    )
  }

  // BLOQUANT : Résultat bilan = résultat CR
  if (params.resultatBilan !== params.resultatCR) {
    erreurs.push(
      `Résultat bilan ${fmt(params.resultatBilan)} ≠ résultat compte de résultat ${fmt(params.resultatCR)}`
    )
  }

  // BLOQUANT : Cohérence TFT
  const variationAttendue = params.tresorerieFinN - params.tresorerieDebutN
  if (params.variationTresorerie !== variationAttendue) {
    erreurs.push(
      `TFT incohérent : variation calculée ${fmt(params.variationTresorerie)} ≠ variation bilan ${fmt(variationAttendue)}`
    )
  }

  // BLOQUANT : T07 → T08 cohérents
  if (params.tableauT07.baseImposable !== params.tableauT08.baseImposable) {
    erreurs.push("T07 et T08 incohérents : base imposable différente")
  }

  // AVERTISSEMENT : IMF mode — signal important
  if (params.tableauT08.modeImposition === "IMF") {
    avert.push(
      `Entreprise en perte : IMF retenu (${fmt(params.tableauT08.imfCalcule)} FCFA) au lieu de l'IS`
    )
  }

  return { erreurs, avertissements: avert }
}

function fmt(n: bigint): string {
  return Number(n).toLocaleString("fr-CI") + " FCFA"
}
