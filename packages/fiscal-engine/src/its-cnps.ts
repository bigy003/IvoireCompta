/**
 * IvoireCompta — Moteur ITS & CNPS Côte d'Ivoire
 * Barème ITS + taux CNPS 2024
 */

// ─── Barème ITS progressif (mensuel) ────────────────────────────
export const BAREME_ITS_MENSUEL = [
  { plancher: 0n,       plafond: 75_000n,     taux: 0.00 },
  { plancher: 75_001n,  plafond: 240_000n,    taux: 0.16 },
  { plancher: 240_001n, plafond: 800_000n,    taux: 0.21 },
  { plancher: 800_001n, plafond: BigInt("9".repeat(18)), taux: 0.24 },
] as const

// ─── Abattements ITS ────────────────────────────────────────────
export const ABATTEMENTS_ITS = {
  FRAIS_PROFESSIONNELS: 0.15,       // 15% du salaire brut
  PAR_ENFANT_CHARGE:    500n,        // 500 FCFA/mois par enfant (max 6)
  NB_ENFANTS_MAX:       6,
} as const

// ─── Taux CNPS 2024 ─────────────────────────────────────────────
export const TAUX_CNPS = {
  // Cotisations employeur
  RETRAITE_EMPLOYEUR:   0.077,  // 7,7%
  PRESTATIONS_FAM:      0.0575, // 5,75%
  ACCIDENT_TRAVAIL_MIN: 0.02,   // 2% minimum
  ACCIDENT_TRAVAIL_MAX: 0.05,   // 5% selon risque
  FDFP_MIN:             0.004,  // 0,4%
  FDFP_MAX:             0.012,  // 1,2%
  // Cotisations salarié
  RETRAITE_SALARIE:     0.032,  // 3,2%
  // Plafond mensuel cotisable
  PLAFOND_MENSUEL:      1_647_315n,  // FCFA
} as const

export interface BulletinCalcule {
  // Entrées
  salaireBrut:          bigint
  nombreEnfants:        number
  tauxAccidentTravail:  number  // selon risque entreprise
  tauxFdfp:             number  // selon taille entreprise
  // Cotisations employeur
  cnpsRetraiteEmployeur: bigint
  cnpsPrestationsFam:   bigint
  cnpsAccidentTravail:  bigint
  cnpsFdfp:             bigint
  totalChargesEmployeur: bigint
  // Cotisations salarié
  cnpsRetraiteSalarie:  bigint
  // ITS
  salaireNetFiscal:     bigint  // après abattement 15%
  abattementEnfants:    bigint
  baseIts:              bigint
  itsParTrancheDetail:  TranchITS[]
  itsTotal:             bigint
  // Net
  netAPayer:            bigint
  coutTotalEmployeur:   bigint  // brut + charges employeur
}

export interface TranchITS {
  taux:     number
  base:     bigint
  montant:  bigint
  label:    string
}

/**
 * Calcule un bulletin de paie complet selon les règles CI
 */
export function calculerBulletinPaie(
  salaireBrut: bigint,
  nombreEnfants: number,
  tauxAccidentTravail: number = TAUX_CNPS.ACCIDENT_TRAVAIL_MIN,
  tauxFdfp: number = TAUX_CNPS.FDFP_MIN
): BulletinCalcule {
  // ── Plafonnement assiette CNPS ────────────────────────────────
  const assietteCnps = salaireBrut > TAUX_CNPS.PLAFOND_MENSUEL
    ? TAUX_CNPS.PLAFOND_MENSUEL
    : salaireBrut

  // ── Cotisations employeur ────────────────────────────────────
  const cnpsRetraiteEmployeur = arrondir(assietteCnps, TAUX_CNPS.RETRAITE_EMPLOYEUR)
  const cnpsPrestationsFam    = arrondir(assietteCnps, TAUX_CNPS.PRESTATIONS_FAM)
  const cnpsAccidentTravail   = arrondir(assietteCnps, tauxAccidentTravail)
  const cnpsFdfp              = arrondir(assietteCnps, tauxFdfp)
  const totalChargesEmployeur = cnpsRetraiteEmployeur + cnpsPrestationsFam
                              + cnpsAccidentTravail + cnpsFdfp

  // ── Cotisations salarié ──────────────────────────────────────
  const cnpsRetraiteSalarie = arrondir(assietteCnps, TAUX_CNPS.RETRAITE_SALARIE)

  // ── Calcul ITS ───────────────────────────────────────────────
  // 1. Abattement 15% frais professionnels sur salaire brut
  const abattementFraisPro = arrondir(salaireBrut, ABATTEMENTS_ITS.FRAIS_PROFESSIONNELS)
  let salaireNetFiscal = salaireBrut - abattementFraisPro

  // 2. Abattement enfants à charge (max 6)
  const nbEnfantsEffectif = Math.min(nombreEnfants, ABATTEMENTS_ITS.NB_ENFANTS_MAX)
  const abattementEnfants = ABATTEMENTS_ITS.PAR_ENFANT_CHARGE * BigInt(nbEnfantsEffectif)
  const baseIts = salaireNetFiscal > abattementEnfants
    ? salaireNetFiscal - abattementEnfants
    : 0n

  // 3. Application barème progressif
  const { itsTotal, itsParTrancheDetail } = appliquerBaremeITS(baseIts)

  // ── Net à payer ──────────────────────────────────────────────
  const netAPayer = salaireBrut - cnpsRetraiteSalarie - itsTotal
  const coutTotalEmployeur = salaireBrut + totalChargesEmployeur

  return {
    salaireBrut,
    nombreEnfants,
    tauxAccidentTravail,
    tauxFdfp,
    cnpsRetraiteEmployeur,
    cnpsPrestationsFam,
    cnpsAccidentTravail,
    cnpsFdfp,
    totalChargesEmployeur,
    cnpsRetraiteSalarie,
    salaireNetFiscal,
    abattementEnfants,
    baseIts,
    itsParTrancheDetail,
    itsTotal,
    netAPayer,
    coutTotalEmployeur,
  }
}

function appliquerBaremeITS(base: bigint): {
  itsTotal: bigint
  itsParTrancheDetail: TranchITS[]
} {
  let itsTotal = 0n
  const detail: TranchITS[] = []
  let reste = base

  for (const tranche of BAREME_ITS_MENSUEL) {
    if (reste <= 0n) break
    if (tranche.taux === 0) {
      reste = reste > tranche.plafond ? reste - tranche.plafond : 0n
      continue
    }

    const largeurTranche = tranche.plafond - tranche.plancher + 1n
    const montantDansTranche = reste < largeurTranche ? reste : largeurTranche
    const impotTranche = arrondir(montantDansTranche, tranche.taux)

    detail.push({
      taux: tranche.taux,
      base: montantDansTranche,
      montant: impotTranche,
      label: `${(tranche.plancher).toLocaleString()} → ${tranche.taux * 100}%`,
    })

    itsTotal += impotTranche
    reste -= montantDansTranche
  }

  return { itsTotal, itsParTrancheDetail: detail }
}

/** Arrondir à l'entier FCFA (pas de centimes en CI) */
function arrondir(base: bigint, taux: number): bigint {
  return BigInt(Math.round(Number(base) * taux))
}

/**
 * Génère le récapitulatif mensuel CNPS pour un client
 * (Base de la déclaration CNPS mensuelle)
 */
export function calculerRecapCNPS(bulletins: BulletinCalcule[]): {
  totalBrut:             bigint
  totalCnpsEmployeur:    bigint
  totalCnpsSalarie:      bigint
  totalIts:              bigint
  totalNetAPayer:        bigint
  nbSalaries:            number
} {
  return bulletins.reduce((acc, b) => ({
    totalBrut:          acc.totalBrut          + b.salaireBrut,
    totalCnpsEmployeur: acc.totalCnpsEmployeur + b.totalChargesEmployeur,
    totalCnpsSalarie:   acc.totalCnpsSalarie   + b.cnpsRetraiteSalarie,
    totalIts:           acc.totalIts           + b.itsTotal,
    totalNetAPayer:     acc.totalNetAPayer     + b.netAPayer,
    nbSalaries:         acc.nbSalaries         + 1,
  }), {
    totalBrut: 0n, totalCnpsEmployeur: 0n, totalCnpsSalarie: 0n,
    totalIts: 0n, totalNetAPayer: 0n, nbSalaries: 0,
  })
}
