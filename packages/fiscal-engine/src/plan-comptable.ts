/**
 * IvoireCompta — Plan comptable SYSCOHADA révisé 2018
 * Comptes principaux utilisés en Côte d'Ivoire
 */

export interface ComptesSyscohada {
  numero: string
  libelle: string
  classe: number
  type: "BILAN" | "RESULTAT" | "SPECIAL"
}

export const CLASSES_SYSCOHADA = {
  1: "Comptes de ressources durables",
  2: "Comptes d'actif immobilisé",
  3: "Comptes de stocks",
  4: "Comptes de tiers",
  5: "Comptes de trésorerie",
  6: "Comptes de charges",
  7: "Comptes de produits",
  8: "Comptes des autres charges et produits",
  9: "Comptes des engagements hors bilan",
} as const

export const COMPTES_TVA_CI = {
  COLLECTEE:         "4431",
  DEDUCTIBLE_IMMO:   "4451",
  DEDUCTIBLE_ABS:    "4456",
  EN_ATTENTE:        "4458",
  CREDIT_REPORTE:    "4432",
} as const

export const COMPTES_IS_CI = {
  ACOMPTES:          "4441",
  IS_A_PAYER:        "4442",
  IMF_A_PAYER:       "4443",
} as const

export const COMPTES_TIERS = {
  FOURNISSEURS:      "401",
  CLIENTS:           "411",
  PERSONNEL:         "421",
  ETAT_TVA:          "443",
  ETAT_IS:           "444",
  CNPS:              "431",
} as const

/**
 * Détermine la classe d'un compte SYSCOHADA
 */
export function getClasseCompte(numero: string): number {
  return parseInt(numero.charAt(0))
}

/**
 * Détermine si un compte est de bilan ou de résultat
 */
export function getTypeCompte(numero: string): "BILAN" | "RESULTAT" | "SPECIAL" {
  const classe = getClasseCompte(numero)
  if (classe >= 1 && classe <= 5) return "BILAN"
  if (classe >= 6 && classe <= 7) return "RESULTAT"
  return "SPECIAL"
}

/**
 * Vérifie qu'un numéro de compte est valide SYSCOHADA
 * (entre 1 et 9 chiffres, commence par 1-9)
 */
export function isCompteValide(numero: string): boolean {
  return /^[1-9]\d{0,8}$/.test(numero)
}
