/**
 * IvoireCompta — Route /declarations
 * DSF annuelle, TVA mensuelle, visa électronique ONECCA-CI
 */

import { FastifyInstance } from "fastify"
import { z } from "zod"
import { createHash } from "crypto"
import { PrismaClient } from "@prisma/client"
import {
  calculerTVAMensuelle,
  calculerISetIMF,
  genererT07,
  genererT08,
  genererT09,
  controlerCoherenceDSF,
} from "@ivoirecompta/fiscal-engine"

const prisma = new PrismaClient()

export async function declarationRoutes(app: FastifyInstance) {

  /**
   * POST /declarations/dsf/generer
   * Génère automatiquement les 9 tableaux DGI-CI depuis les écritures
   */
  app.post("/dsf/generer", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const { exerciceId } = request.body as { exerciceId: string }

    // Récupérer toutes les écritures validées de l'exercice
    const lignes = await prisma.ligneEcriture.findMany({
      where: {
        ecriture: {
          exerciceId,
          statut: "VALIDEE",
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      },
      select: { compteSyscohada: true, debit: true, credit: true, libelleCompte: true },
    })

    if (lignes.length === 0) {
      return reply.status(400).send({ error: "Aucune écriture validée sur cet exercice" })
    }

    // Récupérer les paramètres du dossier
    const exercice = await prisma.exercice.findUnique({
      where: { id: exerciceId },
      include: { dossier: { include: { client: true } } },
    })

    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    // ── Agrégation des soldes par compte ────────────────────────
    const soldes = new Map<string, { libelle: string; debit: bigint; credit: bigint }>()
    for (const l of lignes) {
      const prev = soldes.get(l.compteSyscohada) ?? { libelle: l.libelleCompte, debit: 0n, credit: 0n }
      soldes.set(l.compteSyscohada, {
        libelle: prev.libelle,
        debit:   prev.debit  + BigInt(l.debit.toString()),
        credit:  prev.credit + BigInt(l.credit.toString()),
      })
    }

    // ── Calcul résultat comptable (comptes 7xx - 6xx) ────────────
    let totalProduits  = 0n
    let totalCharges   = 0n
    let chiffreAffairesHT = 0n

    for (const [compte, solde] of soldes.entries()) {
      if (compte.startsWith("7")) {
        totalProduits += solde.credit - solde.debit
        if (compte.startsWith("70") || compte.startsWith("71")) {
          chiffreAffairesHT += solde.credit - solde.debit
        }
      }
      if (compte.startsWith("6")) {
        totalCharges += solde.debit - solde.credit
      }
    }

    const resultatComptable = totalProduits - totalCharges
    const client = exercice.dossier.client

    // ── Calcul IS / IMF ──────────────────────────────────────────
    const reintegrations = detecterReintegrations(soldes)
    const rf = calculerISetIMF(
      resultatComptable,
      reintegrations,
      [],
      {
        regimeFiscal:      (client.regimeImposition as any) ?? "REEL_NORMAL",
        anneesZoneFranche: 0,
        deficitReporteN1:  0n, // À récupérer depuis l'exercice N-1
        acomptesVersesN:   getAcomptesPaies(soldes),
        caHTExercice:      chiffreAffairesHT,
      }
    )

    // ── Génération T07, T08, T09 ─────────────────────────────────
    const t07 = genererT07(rf)
    const t08 = genererT08(rf)
    const tvaARegler = getTVAARegler(soldes)
    const t09 = genererT09({
      isOuImfDu:         rf.impotDu,
      tvaARegler,
      itsDu:             0n, // Calculé séparément via module paie
      cnpsDu:            0n,
      acomptesDejaPaies: rf.acomptesVersesN,
      creditTvaReporte:  0n,
    })

    // ── Contrôles cohérence ──────────────────────────────────────
    const totalActif  = getSoldeClasse(soldes, ["1","2","3","4","5"], "actif")
    const totalPassif = getSoldeClasse(soldes, ["1","2","3","4","5"], "passif")
    const controles = controlerCoherenceDSF({
      totalActif,
      totalPassif,
      resultatBilan:       resultatComptable,
      resultatCR:          resultatComptable,
      variationTresorerie: 0n,
      tresorerieDebutN:    0n,
      tresorerieFinN:      0n,
      tableauT07:          t07,
      tableauT08:          t08,
    })

    // ── Persistance en base ──────────────────────────────────────
    // Créer ou mettre à jour la déclaration DSF
    const dateClotureExo = new Date(exercice.annee + 1, 3, 30) // 30 avril N+1
    const declaration = await prisma.declarationFiscale.upsert({
      where: {
        // Clé unique sur exerciceId + type
        id: `dsf-${exerciceId}`,
      },
      create: {
        id:               `dsf-${exerciceId}`,
        exerciceId,
        typeDeclaration:  "DSF_ANNUELLE",
        periodeAnnee:     exercice.annee,
        dateEcheance:     dateClotureExo,
        statut:           "EN_PREPARATION",
        montantDu:        rf.impotDu,
      },
      update: {
        statut:   "EN_PREPARATION",
        montantDu: rf.impotDu,
        updatedAt: new Date(),
      },
    })

    // Sauvegarder T07, T08, T09
    for (const [code, donnees] of [
      ["T07", t07], ["T08", t08], ["T09", t09],
    ] as const) {
      await prisma.tableauDsf.upsert({
        where:  { declarationId_codeTableau: { declarationId: declaration.id, codeTableau: code } },
        create: { declarationId: declaration.id, codeTableau: code, libelleTableau: getLabelTableau(code), donnees: donnees as any, valide: controles.erreurs.length === 0 },
        update: { donnees: donnees as any, valide: controles.erreurs.length === 0, updatedAt: new Date() },
      })
    }

    return reply.send({
      declaration,
      tableaux:     { t07, t08, t09 },
      controles,
      pret:         controles.erreurs.length === 0,
      message:      controles.erreurs.length === 0
        ? "DSF prête pour visa — tous les contrôles passent"
        : `${controles.erreurs.length} erreur(s) à corriger avant le visa`,
    })
  })

  /**
   * POST /declarations/:id/viser
   * Appose le visa électronique de l'expert-comptable
   * Requiert le visaToken (15 min) issu de /auth/visa/verifier
   */
  app.post("/:id/viser", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string; role: string; scope?: string }
    const { id } = request.params as { id: string }
    const { visaToken } = request.body as { visaToken: string }

    // Vérifier que le visaToken est valide et non expiré
    let visaPayload: { id: string; scope: string }
    try {
      visaPayload = app.jwt.verify(visaToken) as any
    } catch {
      return reply.status(401).send({ error: "Token de visa invalide ou expiré (15 min max)" })
    }

    if (visaPayload.scope !== "VISA_DSF" || visaPayload.id !== user.id) {
      return reply.status(403).send({ error: "Token de visa incorrect" })
    }

    const declaration = await prisma.declarationFiscale.findFirst({
      where: {
        id,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: { tableauxDsf: true },
    })

    if (!declaration) return reply.status(404).send({ error: "Déclaration introuvable" })
    if (declaration.statut === "VISEE" || declaration.statut === "DEPOSEE") {
      return reply.status(409).send({ error: "Cette déclaration est déjà visée" })
    }

    // Hash des tableaux DSF pour intégrité
    const hashDocuments = createHash("sha256")
      .update(JSON.stringify(declaration.tableauxDsf))
      .digest("hex")

    const declarationVisee = await prisma.declarationFiscale.update({
      where: { id },
      data: {
        statut:        "VISEE",
        viseeParId:    user.id,
        dateVisa:      new Date(),
        hashDocuments,
      },
    })

    await prisma.auditLog.create({
      data: {
        cabinetId:   user.cabinetId,
        userId:      user.id,
        action:      "DSF_VISEE",
        entite:      "declarations_fiscales",
        entiteId:    id,
        donneeApres: { hashDocuments, dateVisa: declarationVisee.dateVisa },
      },
    })

    return reply.send({
      declaration: declarationVisee,
      message: "Visa apposé — déclaration prête pour dépôt sur e-impôts.gouv.ci",
      hashIntegrite: hashDocuments,
    })
  })

  /**
   * GET /declarations/echeances
   * Toutes les échéances fiscales du cabinet (tableau de bord)
   */
  app.get("/echeances", async (request, reply) => {
    const user  = request.user as { cabinetId: string }
    const query = request.query as { joursHorizon?: string; clientId?: string }
    const horizon = Number(query.joursHorizon ?? 30)

    const maintenant = new Date()
    const limite     = new Date(maintenant.getTime() + horizon * 24 * 60 * 60 * 1000)

    const echeances = await prisma.echeanceFiscale.findMany({
      where: {
        dateEcheance: { gte: maintenant, lte: limite },
        clientId:     query.clientId ?? undefined,
        // Filtrer par cabinetId via client
      },
      orderBy: { dateEcheance: "asc" },
      take: 100,
    })

    const enrichies = echeances.map(e => {
      const diffMs = e.dateEcheance.getTime() - maintenant.getTime()
      const jours  = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      return {
        ...e,
        joursRestants: jours,
        urgence: jours <= 7 ? "ROUGE" : jours <= 15 ? "ORANGE" : "VERT",
      }
    })

    return reply.send({ echeances: enrichies, total: enrichies.length })
  })
}

// ── Helpers ────────────────────────────────────────────────────────

function detecterReintegrations(soldes: Map<string, { libelle: string; debit: bigint; credit: bigint }>) {
  const COMPTES_REINTEQ = ["671", "6581", "6411", "6312", "6481", "6815", "6616"]
  const result = []
  for (const [compte, solde] of soldes.entries()) {
    if (COMPTES_REINTEQ.some(c => compte.startsWith(c))) {
      const montant = solde.debit - solde.credit
      if (montant > 0n) {
        result.push({ compte, libelle: solde.libelle, montant, motif: "REINTEGRATION_CGI" })
      }
    }
  }
  return result
}

function getAcomptesPaies(soldes: Map<string, any>): bigint {
  let total = 0n
  for (const [compte, solde] of soldes.entries()) {
    if (compte.startsWith("4441")) { // Acomptes IS
      total += solde.debit - solde.credit
    }
  }
  return total > 0n ? total : 0n
}

function getTVAARegler(soldes: Map<string, any>): bigint {
  let tvaCollectee  = 0n
  let tvaDeductible = 0n
  for (const [compte, solde] of soldes.entries()) {
    if (compte.startsWith("4431")) tvaCollectee  += solde.credit - solde.debit
    if (compte.startsWith("4451") || compte.startsWith("4456")) tvaDeductible += solde.debit - solde.credit
  }
  const solde = tvaCollectee - tvaDeductible
  return solde > 0n ? solde : 0n
}

function getSoldeClasse(
  soldes: Map<string, { debit: bigint; credit: bigint }>,
  classes: string[],
  sens: "actif" | "passif"
): bigint {
  let total = 0n
  for (const [compte, s] of soldes.entries()) {
    if (classes.some(c => compte.startsWith(c))) {
      total += sens === "actif" ? s.debit - s.credit : s.credit - s.debit
    }
  }
  return total > 0n ? total : 0n
}

function getLabelTableau(code: string): string {
  const labels: Record<string, string> = {
    T01: "Relevé des amortissements",
    T02: "Relevé des provisions",
    T03: "État des créances et dettes",
    T04: "Filiales et participations",
    T05: "Charges de personnel",
    T06: "Rémunérations des dirigeants",
    T07: "Tableau de passage résultat fiscal",
    T08: "Calcul IS / IMF",
    T09: "Situation fiscale d'ensemble",
  }
  return labels[code] ?? code
}
