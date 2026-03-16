/**
 * IvoireCompta — Tests unitaires du moteur fiscal CI
 * Valeurs vérifiées manuellement sur les barèmes DGI-CI officiels
 */

import { describe, it, expect } from "vitest"
import { calculerTVAMensuelle, calculerPenaliteTVA } from "./tva"
import { calculerISetIMF } from "./is-imf"
import { calculerBulletinPaie } from "./its-cnps"
import { genererEcheancesAnnuelles } from "./calendrier-fiscal"

// ─── TVA ──────────────────────────────────────────────────────────

describe("TVA Côte d'Ivoire", () => {
  it("calcule la TVA à reverser correctement", () => {
    const result = calculerTVAMensuelle(
      [
        { compte: "4431000", montantHT: 1_000_000n, taux: 0.18, typeOperation: "COLLECTEE" },
        { compte: "4456000", montantHT: 500_000n,   taux: 0.18, typeOperation: "DEDUCTIBLE" },
      ],
      { creditReporteN1: 0n, prorataDeductionN1: 100, assujettitPartiel: false }
    )
    expect(result.tvaCollectee).toBe(180_000n)   // 1M × 18%
    expect(result.tvaDeductible).toBe(90_000n)   // 500K × 18%
    expect(result.solde).toBe(90_000n)           // à reverser
    expect(result.creditReporte).toBe(0n)
  })

  it("génère un crédit de TVA quand déductible > collectée", () => {
    const result = calculerTVAMensuelle(
      [
        { compte: "4431000", montantHT: 500_000n,   taux: 0.18, typeOperation: "COLLECTEE" },
        { compte: "4451000", montantHT: 2_000_000n, taux: 0.18, typeOperation: "DEDUCTIBLE" },
      ],
      { creditReporteN1: 0n, prorataDeductionN1: 100, assujettitPartiel: false }
    )
    expect(result.solde).toBe(0n)
    expect(result.creditReporte).toBe(270_000n)  // (360K - 90K)
  })

  it("calcule les pénalités de retard TVA", () => {
    const { total } = calculerPenaliteTVA(1_000_000n, 2)
    // 25% de 1M = 250 000 + 2% de 1M = 20 000
    expect(total).toBe(270_000n)
  })

  it("applique le minimum de pénalité TVA (100 000 FCFA)", () => {
    // Montant dû très faible → minimum 100K FCFA
    const { penaliteBase } = calculerPenaliteTVA(200_000n, 0)
    // 25% de 200K = 50 000 < 100 000 → plancher appliqué
    expect(penaliteBase).toBe(100_000n)
  })
})

// ─── IS / IMF ─────────────────────────────────────────────────────

describe("IS et IMF Côte d'Ivoire", () => {
  it("retourne l'IS quand supérieur à l'IMF", () => {
    const result = calculerISetIMF(
      500_000_000n,  // résultat comptable 500M FCFA
      [],            // pas de réintégrations
      [],            // pas de déductions
      {
        regimeFiscal: "REEL_NORMAL",
        anneesZoneFranche: 0,
        deficitReporteN1: 0n,
        acomptesVersesN: 0n,
        caHTExercice: 2_000_000_000n,  // CA 2 milliards
      }
    )
    expect(result.isCalcule).toBe(125_000_000n)  // 500M × 25%
    expect(result.imfCalcule).toBe(10_000_000n)  // 2G × 0.5%
    expect(result.impotDu).toBe(125_000_000n)
    expect(result.modeImposition).toBe("IS")
  })

  it("retourne l'IMF quand IS = 0 (entreprise en déficit)", () => {
    const result = calculerISetIMF(
      -50_000_000n,  // déficit de 50M
      [],
      [],
      {
        regimeFiscal: "REEL_NORMAL",
        anneesZoneFranche: 0,
        deficitReporteN1: 0n,
        acomptesVersesN: 0n,
        caHTExercice: 800_000_000n,  // CA 800M
      }
    )
    expect(result.isCalcule).toBe(0n)
    expect(result.imfCalcule).toBe(4_000_000n)   // 800M × 0.5%
    expect(result.impotDu).toBe(4_000_000n)
    expect(result.modeImposition).toBe("IMF")
  })

  it("applique le minimum IMF (3 000 000 FCFA)", () => {
    const result = calculerISetIMF(
      -100_000_000n,
      [],
      [],
      {
        regimeFiscal: "REEL_NORMAL",
        anneesZoneFranche: 0,
        deficitReporteN1: 0n,
        acomptesVersesN: 0n,
        caHTExercice: 100_000_000n,  // 100M × 0.5% = 500K < 3M
      }
    )
    expect(result.imfCalcule).toBe(3_000_000n)  // plancher appliqué
  })

  it("intègre les réintégrations fiscales dans le résultat", () => {
    const result = calculerISetIMF(
      100_000_000n,
      [{ compte: "671", libelle: "Pénalités fiscales", montant: 5_000_000n, motif: "ART_72_CGI" }],
      [],
      {
        regimeFiscal: "REEL_NORMAL",
        anneesZoneFranche: 0,
        deficitReporteN1: 0n,
        acomptesVersesN: 0n,
        caHTExercice: 500_000_000n,
      }
    )
    expect(result.resultatFiscal).toBe(105_000_000n)   // 100M + 5M réintégré
    expect(result.isCalcule).toBe(26_250_000n)         // 105M × 25%
  })
})

// ─── ITS / CNPS ───────────────────────────────────────────────────

describe("ITS et CNPS Côte d'Ivoire", () => {
  it("calcule un bulletin pour salaire dans la tranche 16%", () => {
    // Salaire brut 150 000 FCFA (tranche 75 001 - 240 000)
    const bulletin = calculerBulletinPaie(150_000n, 0)
    // Net fiscal = 150 000 - 22 500 (15%) = 127 500
    // ITS : 127 500 - 75 000 = 52 500 dans tranche 16% = 8 400
    expect(bulletin.salaireNetFiscal).toBe(127_500n)
    expect(bulletin.itsTotal).toBe(8_400n)
  })

  it("applique les abattements enfants à charge", () => {
    const sans = calculerBulletinPaie(300_000n, 0)
    const avec  = calculerBulletinPaie(300_000n, 3)
    // 3 enfants × 500 = 1 500 FCFA d'abattement → ITS réduit
    expect(avec.itsTotal).toBeLessThan(sans.itsTotal)
    expect(avec.abattementEnfants).toBe(1_500n)
  })

  it("plafonne les cotisations CNPS au plafond légal", () => {
    // Salaire très élevé — plafond CNPS = 1 647 315 FCFA
    const bulletin = calculerBulletinPaie(5_000_000n, 0)
    // Les cotisations CNPS ne doivent pas dépasser le plafond × taux
    const cnpsMaxAttendu = BigInt(Math.round(1_647_315 * 0.032))
    expect(bulletin.cnpsRetraiteSalarie).toBe(cnpsMaxAttendu)
  })

  it("calcule correctement le net à payer", () => {
    const bulletin = calculerBulletinPaie(500_000n, 2)
    const netAttendu = bulletin.salaireBrut
      - bulletin.cnpsRetraiteSalarie
      - bulletin.itsTotal
    expect(bulletin.netAPayer).toBe(netAttendu)
  })
})

// ─── Calendrier fiscal ────────────────────────────────────────────

describe("Calendrier fiscal", () => {
  it("génère 12 échéances TVA pour un exercice annuel", () => {
    const echeances = genererEcheancesAnnuelles(2025, {
      assujettitTVA: true,
      regimeFiscal: "REEL_NORMAL",
      aDesEmployes: false,
      dateClotureExo: new Date(2025, 11, 31),
    })
    const tva = echeances.filter(e => e.type === "TVA_MENSUELLE")
    expect(tva).toHaveLength(12)
  })

  it("génère 3 acomptes IS pour le régime réel", () => {
    const echeances = genererEcheancesAnnuelles(2025, {
      assujettitTVA: false,
      regimeFiscal: "REEL_NORMAL",
      aDesEmployes: false,
      dateClotureExo: new Date(2025, 11, 31),
    })
    const acomptes = echeances.filter(e =>
      e.type === "IS_ACOMPTE_1" || e.type === "IS_ACOMPTE_2" || e.type === "IS_ACOMPTE_3"
    )
    expect(acomptes).toHaveLength(3)
    // 1er acompte : 20 avril
    expect(acomptes[0].dateEcheance.getDate()).toBe(20)
    expect(acomptes[0].dateEcheance.getMonth()).toBe(3) // avril = index 3
  })

  it("place la DSF à 4 mois après clôture exercice", () => {
    const echeances = genererEcheancesAnnuelles(2025, {
      assujettitTVA: false,
      regimeFiscal: "REEL_NORMAL",
      aDesEmployes: false,
      dateClotureExo: new Date(2025, 11, 31), // 31 déc
    })
    const dsf = echeances.find(e => e.type === "DSF_ANNUELLE")
    // Clôture 31/12 → DSF 30 avril N+1
    expect(dsf?.dateEcheance.getMonth()).toBe(3) // avril
    expect(dsf?.dateEcheance.getDate()).toBe(30)
  })
})
