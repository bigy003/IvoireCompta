/**
 * IvoireCompta — Moteur IS & IMF Côte d'Ivoire
 * Loi de finances CI + Code Général des Impôts UEMOA
 */

// ─── Taux IS selon régime ───────────────────────────────────────
export const TAUX_IS = {
  STANDARD:         0.25,   // Taux général
  PME:              0.20,   // CA < 200M FCFA
  MINIER:           0.25,   // Secteur minier (régime spécial)
  ZONE_FRANCHE_0:   0.00,   // ZICI — 8 premières années
  ZONE_FRANCHE_RED: 0.15,   // ZICI — après 8 ans
} as const

// ─── IMF ────────────────────────────────────────────────────────
export const IMF = {
  TAUX:    0.005,       // 0,5% du CA HT
  MINIMUM: 3_000_000n, // 3 000 000 FCFA minimum (bigint FCFA)
} as const

// ─── Acomptes IS ────────────────────────────────────────────────
export const ACOMPTES_IS = {
  NB_ACOMPTES: 3,
  ECHEANCES: [
    { mois: 4, jour: 20, label: "1er acompte" },
    { mois: 7, jour: 20, label: "2ème acompte" },
    { mois: 10, jour: 20, label: "3ème acompte" },
  ],
  ECHEANCE_SOLDE: { mois: 4, jour: 30, label: "Solde IS" },
} as const

// ─── Charges non déductibles (réintégrations) ───────────────────
export const COMPTES_REINTEGRATION = [
  { compte: "671",    libelle: "Amendes, pénalités, majorations fiscales",        motif: "ART_72_CGI" },
  { compte: "6581",   libelle: "Dons > 0,5% du CA",                               motif: "ART_73_CGI" },
  { compte: "6411",   libelle: "Charges personnelles dirigeant",                   motif: "ART_74_CGI" },
  { compte: "6312",   libelle: "Loyers versés à dirigeants (excédent)",            motif: "ART_75_CGI" },
  { compte: "6481",   libelle: "Frais de siège > 10% bénéfice brut CI",           motif: "ART_76_CGI" },
  { compte: "6815",   libelle: "Dotations provisions non admises fiscalement",     motif: "ART_77_CGI" },
  { compte: "6616",   libelle: "Intérêts excédentaires comptes courants associés", motif: "ART_78_CGI" },
] as const

export interface ResultatFiscal {
  // Compte de résultat
  resultatComptable:     bigint
  // Réintégrations
  reintegrationsTotal:   bigint
  reintegrations:        ReintegrationDetail[]
  // Déductions
  deductionsTotal:       bigint
  deductions:            DeductionDetail[]
  // Résultat fiscal
  resultatFiscal:        bigint   // résultat comptable + réintégrations - déductions
  deficitReporteN1:      bigint
  baseImposable:         bigint   // après imputation déficit
  // IS calculé
  tauxIs:                number
  isCalcule:             bigint
  // IMF
  chiffreAffairesHT:     bigint
  imfCalcule:            bigint
  // Impôt dû = MAX(IS, IMF)
  impotDu:               bigint
  modeImposition:        "IS" | "IMF"
  // Acomptes
  acomptesVersesN:       bigint
  soldeAPayerAvril:      bigint
}

export interface ReintegrationDetail {
  compte:    string
  libelle:   string
  montant:   bigint
  motif:     string
}

export interface DeductionDetail {
  libelle:   string
  montant:   bigint
  motif:     string
}

export interface ParametresIS {
  regimeFiscal:      "REEL_NORMAL" | "PME" | "ZONE_FRANCHE_ZICI" | "MINIER"
  anneesZoneFranche: number    // Pertinent si ZONE_FRANCHE_ZICI
  deficitReporteN1:  bigint
  acomptesVersesN:   bigint
  caHTExercice:      bigint
}

/**
 * Calcule le résultat fiscal et l'impôt dû (IS ou IMF)
 * Tableau T07 + T08 de la DSF ivoirienne
 */
export function calculerISetIMF(
  resultatComptable: bigint,
  reintegrations: ReintegrationDetail[],
  deductions: DeductionDetail[],
  params: ParametresIS
): ResultatFiscal {
  const reintegrationsTotal = reintegrations.reduce((s, r) => s + r.montant, 0n)
  const deductionsTotal     = deductions.reduce((s, d) => s + d.montant, 0n)
  const resultatFiscal      = resultatComptable + reintegrationsTotal - deductionsTotal

  // Imputation du déficit reporté (seulement si bénéfice fiscal)
  const baseImposable = resultatFiscal > params.deficitReporteN1
    ? resultatFiscal - params.deficitReporteN1
    : 0n

  // Calcul IS
  const tauxIs = getTauxIS(params)
  const isCalcule = baseImposable > 0n
    ? BigInt(Math.round(Number(baseImposable) * tauxIs))
    : 0n

  // Calcul IMF
  const imfBase    = BigInt(Math.round(Number(params.caHTExercice) * IMF.TAUX))
  const imfCalcule = imfBase < IMF.MINIMUM ? IMF.MINIMUM : imfBase

  // Règle CI : MAX(IS, IMF) — l'IMF est toujours dû même en déficit
  const impotDu      = isCalcule >= imfCalcule ? isCalcule : imfCalcule
  const modeImposition: "IS" | "IMF" = isCalcule >= imfCalcule ? "IS" : "IMF"

  const soldeAPayerAvril = impotDu > params.acomptesVersesN
    ? impotDu - params.acomptesVersesN
    : 0n

  return {
    resultatComptable,
    reintegrationsTotal,
    reintegrations,
    deductionsTotal,
    deductions,
    resultatFiscal,
    deficitReporteN1: params.deficitReporteN1,
    baseImposable,
    tauxIs,
    isCalcule,
    chiffreAffairesHT: params.caHTExercice,
    imfCalcule,
    impotDu,
    modeImposition,
    acomptesVersesN: params.acomptesVersesN,
    soldeAPayerAvril,
  }
}

function getTauxIS(params: ParametresIS): number {
  switch (params.regimeFiscal) {
    case "PME":             return TAUX_IS.PME
    case "MINIER":          return TAUX_IS.MINIER
    case "ZONE_FRANCHE_ZICI":
      return params.anneesZoneFranche <= 8
        ? TAUX_IS.ZONE_FRANCHE_0
        : TAUX_IS.ZONE_FRANCHE_RED
    default:                return TAUX_IS.STANDARD
  }
}

/**
 * Calcule les acomptes IS pour l'année N
 * Basés sur IS de l'année N-1
 */
export function calculerAcomptesIS(isN1: bigint): {
  montantParAcompte: bigint
  total: bigint
  echeances: Array<{ date: string; montant: bigint; label: string }>
} {
  const montantParAcompte = isN1 / 3n
  const echeances = ACOMPTES_IS.ECHEANCES.map(e => ({
    date: `${e.jour.toString().padStart(2, "0")}/${e.mois.toString().padStart(2, "0")}`,
    montant: montantParAcompte,
    label: e.label,
  }))

  return {
    montantParAcompte,
    total: montantParAcompte * 3n,
    echeances,
  }
}

/**
 * Calcule les pénalités de retard IS/IMF
 */
export function calculerPenaliteIS(
  montantDu: bigint,
  moisRetard: number
): bigint {
  const penalite     = montantDu * 25n / 100n
  const interets     = montantDu * BigInt(moisRetard) / 100n
  return penalite + interets
}
