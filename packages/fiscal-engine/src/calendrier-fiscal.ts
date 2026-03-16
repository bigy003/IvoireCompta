/**
 * IvoireCompta — Calendrier fiscal automatique
 * Génère toutes les échéances selon le régime du client
 */

export type TypeDeclaration =
  | "TVA_MENSUELLE"
  | "IS_ACOMPTE_1" | "IS_ACOMPTE_2" | "IS_ACOMPTE_3"
  | "IS_SOLDE" | "IMF"
  | "DSF_ANNUELLE"
  | "CNPS_MENSUELLE"
  | "ITS_MENSUEL"
  | "PATENTE"

export interface Echeance {
  type:         TypeDeclaration
  label:        string
  dateEcheance: Date
  periodeLabel: string   // "TVA-2025-03"
  priorite:     "CRITIQUE" | "IMPORTANTE" | "NORMALE"
}

/**
 * Génère toutes les échéances fiscales d'une année
 * pour un client selon son régime
 */
export function genererEcheancesAnnuelles(
  annee: number,
  options: {
    assujettitTVA:  boolean
    regimeFiscal:   "REEL_NORMAL" | "PME" | "BIC_SIMPLIFIE" | "BNC"
    aDesEmployes:   boolean
    dateClotureExo: Date   // Date de clôture de l'exercice (souvent 31/12)
  }
): Echeance[] {
  const echeances: Echeance[] = []

  // ── TVA mensuelle (si assujetti) ──────────────────────────────
  if (options.assujettitTVA) {
    for (let mois = 1; mois <= 12; mois++) {
      const moisDeclaration = mois === 12 ? 1 : mois + 1
      const anneeDeclaration = mois === 12 ? annee + 1 : annee
      echeances.push({
        type:         "TVA_MENSUELLE",
        label:        `TVA — ${nomMois(mois)} ${annee}`,
        dateEcheance: new Date(anneeDeclaration, moisDeclaration - 1, 15),
        periodeLabel: `TVA-${annee}-${String(mois).padStart(2, "0")}`,
        priorite:     "CRITIQUE",
      })
    }
  }

  // ── Acomptes IS (régime réel) ─────────────────────────────────
  if (options.regimeFiscal === "REEL_NORMAL" || options.regimeFiscal === "PME") {
    echeances.push(
      { type: "IS_ACOMPTE_1", label: `1er acompte IS ${annee}`, dateEcheance: new Date(annee, 3, 20), periodeLabel: `IS-ACOMPTE1-${annee}`, priorite: "CRITIQUE" },
      { type: "IS_ACOMPTE_2", label: `2ème acompte IS ${annee}`, dateEcheance: new Date(annee, 6, 20), periodeLabel: `IS-ACOMPTE2-${annee}`, priorite: "CRITIQUE" },
      { type: "IS_ACOMPTE_3", label: `3ème acompte IS ${annee}`, dateEcheance: new Date(annee, 9, 20), periodeLabel: `IS-ACOMPTE3-${annee}`, priorite: "CRITIQUE" },
    )
  }

  // ── DSF + solde IS (4 mois après clôture exercice) ───────────
  const anneeClot = options.dateClotureExo.getFullYear()
  const moisClot  = options.dateClotureExo.getMonth() // 0-based
  const dateDepotDsf = new Date(anneeClot + (moisClot >= 9 ? 1 : 0), (moisClot + 4) % 12, 30)

  echeances.push({
    type:         "DSF_ANNUELLE",
    label:        `DSF — Exercice ${anneeClot}`,
    dateEcheance: dateDepotDsf,
    periodeLabel: `DSF-${anneeClot}`,
    priorite:     "CRITIQUE",
  })
  echeances.push({
    type:         "IS_SOLDE",
    label:        `Solde IS — Exercice ${anneeClot}`,
    dateEcheance: dateDepotDsf,
    periodeLabel: `IS-SOLDE-${anneeClot}`,
    priorite:     "CRITIQUE",
  })

  // ── Patente (janvier) ─────────────────────────────────────────
  echeances.push({
    type:         "PATENTE",
    label:        `Déclaration patente ${annee}`,
    dateEcheance: new Date(annee, 0, 31),
    periodeLabel: `PATENTE-${annee}`,
    priorite:     "IMPORTANTE",
  })

  // ── CNPS + ITS mensuels (si employés) ────────────────────────
  if (options.aDesEmployes) {
    for (let mois = 1; mois <= 12; mois++) {
      const moisDeclaration = mois === 12 ? 1 : mois + 1
      const anneeDeclaration = mois === 12 ? annee + 1 : annee
      const dernierJour = new Date(anneeDeclaration, moisDeclaration, 0).getDate()

      echeances.push({
        type:         "CNPS_MENSUELLE",
        label:        `CNPS — ${nomMois(mois)} ${annee}`,
        dateEcheance: new Date(anneeDeclaration, moisDeclaration - 1, dernierJour),
        periodeLabel: `CNPS-${annee}-${String(mois).padStart(2, "0")}`,
        priorite:     "IMPORTANTE",
      })
      echeances.push({
        type:         "ITS_MENSUEL",
        label:        `ITS — ${nomMois(mois)} ${annee}`,
        dateEcheance: new Date(anneeDeclaration, moisDeclaration - 1, 15),
        periodeLabel: `ITS-${annee}-${String(mois).padStart(2, "0")}`,
        priorite:     "IMPORTANTE",
      })
    }
  }

  return echeances.sort((a, b) => a.dateEcheance.getTime() - b.dateEcheance.getTime())
}

/**
 * Retourne les échéances à moins de N jours
 * Utilisé pour le tableau de bord des alertes
 */
export function getEcheancesImminentes(
  echeances: Echeance[],
  joursHorizon = 30
): Array<Echeance & { joursRestants: number; urgence: "ROUGE" | "ORANGE" | "VERT" }> {
  const maintenant = new Date()
  return echeances
    .map(e => {
      const diff = e.dateEcheance.getTime() - maintenant.getTime()
      const joursRestants = Math.ceil(diff / (1000 * 60 * 60 * 24))
      return {
        ...e,
        joursRestants,
        urgence: joursRestants <= 7 ? "ROUGE"
               : joursRestants <= 15 ? "ORANGE"
               : "VERT" as "ROUGE" | "ORANGE" | "VERT",
      }
    })
    .filter(e => e.joursRestants >= 0 && e.joursRestants <= joursHorizon)
    .sort((a, b) => a.joursRestants - b.joursRestants)
}

function nomMois(m: number): string {
  const noms = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"]
  return noms[m - 1] ?? String(m)
}
