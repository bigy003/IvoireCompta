/**
 * IvoireCompta — Moteur TVA Côte d'Ivoire
 * Règles DGI-CI en vigueur (mise à jour 2024)
 */

export const TAUX_TVA_CI = {
  NORMAL:     0.18,  // Taux général
  EXPORT:     0.00,  // Exportations exonérées
  ASSURANCE:  0.10,  // Taxe sur les assurances
  HOTELLERIE: 0.10,  // Secteur hôtelier
  TELECOM:    0.10,  // Télécommunications
} as const

/** Codes NAE exonérés de TVA en CI (liste non exhaustive — à compléter DGI) */
export const CODES_NAE_EXONERES = new Set([
  "0111", // Cultures céréalières
  "0112", // Légumes, maraîchage
  "4631", // Commerce de gros alimentaire de base
  "8610", // Activités hospitalières
  "8621", // Médecine générale
  "5813", // Édition de journaux
  "6419", // Autres activités bancaires
])

export interface LigneTVA {
  compte: string
  montantHT: bigint  // FCFA = entier (bigint pour éviter les flottants)
  taux: number
  typeOperation: "COLLECTEE" | "DEDUCTIBLE" | "EXONEREE" | "HORS_CHAMP"
}

export interface ResultatTVA {
  tvaCollectee:   bigint
  tvaDeductible:  bigint
  solde:          bigint   // positif = à reverser, négatif = crédit
  creditReporte:  bigint
  prorataDeduction: number // 0-100
  lignes:         LigneTVA[]
}

export interface ParametresTVA {
  creditReporteN1: bigint
  prorataDeductionN1: number  // % calculé sur N-1
  assujettitPartiel: boolean
}

/**
 * Calcule la déclaration TVA mensuelle
 * Comptes SYSCOHADA utilisés :
 *   4431xx — TVA collectée
 *   4451xx — TVA déductible sur immobilisations
 *   4456xx — TVA déductible sur ABS (biens et services)
 *   4458xx — TVA en attente de déduction
 */
export function calculerTVAMensuelle(
  lignes: LigneTVA[],
  params: ParametresTVA
): ResultatTVA {
  let tvaCollectee  = 0n
  let tvaDeductible = 0n

  for (const ligne of lignes) {
    if (ligne.typeOperation === "COLLECTEE") {
      tvaCollectee += BigInt(Math.round(Number(ligne.montantHT) * ligne.taux))
    } else if (ligne.typeOperation === "DEDUCTIBLE") {
      const deductible = BigInt(Math.round(Number(ligne.montantHT) * ligne.taux))
      // Appliquer le prorata si assujetti partiel
      const prorata = params.assujettitPartiel
        ? params.prorataDeductionN1 / 100
        : 1
      tvaDeductible += BigInt(Math.round(Number(deductible) * prorata))
    }
  }

  const solde = tvaCollectee - tvaDeductible - params.creditReporteN1
  const creditReporte = solde < 0n ? -solde : 0n

  return {
    tvaCollectee,
    tvaDeductible,
    solde: solde > 0n ? solde : 0n,
    creditReporte,
    prorataDeduction: params.prorataDeductionN1,
    lignes,
  }
}

/**
 * Calcule le prorata de déduction annuel
 * Utilisé pour les assujettis partiels
 */
export function calculerProrataDeduction(
  caHtTaxable: bigint,
  caHtTotal: bigint
): number {
  if (caHtTotal === 0n) return 0
  const ratio = Number(caHtTaxable) / Number(caHtTotal)
  // Arrondi au supérieur à l'unité (règle DGI-CI)
  return Math.ceil(ratio * 100)
}

/**
 * Calcule les pénalités de retard TVA
 * - 25% du montant dû (minimum 100 000 FCFA)
 * - 1% par mois de retard
 */
export function calculerPenaliteTVA(
  montantDu: bigint,
  moisRetard: number
): { penaliteBase: bigint; interetsRetard: bigint; total: bigint } {
  const MINIMUM_PENALITE = 100_000n

  const penaliteBase = montantDu * 25n / 100n
  const penaliteEffective = penaliteBase < MINIMUM_PENALITE
    ? MINIMUM_PENALITE
    : penaliteBase

  const interetsRetard = montantDu * BigInt(moisRetard) / 100n

  return {
    penaliteBase: penaliteEffective,
    interetsRetard,
    total: penaliteEffective + interetsRetard,
  }
}

/**
 * Détermine le type d'opération TVA selon le compte SYSCOHADA
 */
export function getTypeOperationTVA(
  compte: string
): "COLLECTEE" | "DEDUCTIBLE" | "NEUTRE" {
  if (compte.startsWith("4431")) return "COLLECTEE"
  if (compte.startsWith("4451") || compte.startsWith("4456") || compte.startsWith("4458"))
    return "DEDUCTIBLE"
  return "NEUTRE"
}
