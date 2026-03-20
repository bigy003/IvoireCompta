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

/** BigInt non sérialisable en JSON → provoque 500 si on renvoie t07–t09 bruts */
function jsonSansBigInt<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))
}

export async function declarationRoutes(app: FastifyInstance) {

  /**
   * POST /declarations/dsf/generer
   * Génère automatiquement les 9 tableaux DGI-CI depuis les écritures
   */
  app.post("/dsf/generer", async (request, reply) => {
    try {
    const user = request.user as { id: string; cabinetId: string }
    const { exerciceId } = request.body as { exerciceId: string }
    if (!exerciceId || typeof exerciceId !== "string") {
      return reply.status(400).send({ error: "exerciceId requis (UUID de l’exercice comptable)" })
    }

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
    if (exercice.dossier.client.cabinetId !== user.cabinetId) {
      return reply.status(403).send({ error: "Cet exercice n’appartient pas à votre cabinet" })
    }

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
        montantDu:        rf.impotDu.toString(),
      },
      update: {
        statut:    "EN_PREPARATION",
        montantDu: rf.impotDu.toString(),
        updatedAt: new Date(),
      },
    })

    const t07j = jsonSansBigInt(t07)
    const t08j = jsonSansBigInt(t08)
    const t09j = jsonSansBigInt(t09)

    for (const [code, donnees] of [
      ["T07", t07j], ["T08", t08j], ["T09", t09j],
    ] as const) {
      await prisma.tableauDsf.upsert({
        where:  { declarationId_codeTableau: { declarationId: declaration.id, codeTableau: code } },
        create: { declarationId: declaration.id, codeTableau: code, libelleTableau: getLabelTableau(code), donnees: donnees as object, valide: controles.erreurs.length === 0 },
        update: { donnees: donnees as object, valide: controles.erreurs.length === 0, updatedAt: new Date() },
      })
    }

    const declarationJson = {
      id:             declaration.id,
      exerciceId:     declaration.exerciceId,
      typeDeclaration: declaration.typeDeclaration,
      periodeAnnee:   declaration.periodeAnnee,
      statut:         declaration.statut,
      montantDu:      declaration.montantDu != null ? declaration.montantDu.toString() : null,
      dateEcheance:   declaration.dateEcheance.toISOString(),
      updatedAt:      declaration.updatedAt.toISOString(),
    }

    return reply.send({
      declaration: declarationJson,
      tableaux:    { t07: t07j, t08: t08j, t09: t09j },
      controles,
      pret:        controles.erreurs.length === 0,
      message:     controles.erreurs.length === 0
        ? "DSF prête pour visa — tous les contrôles passent"
        : `${controles.erreurs.length} erreur(s) à corriger avant le visa`,
    })
    } catch (err) {
      request.log.error(err)
      const msg = err instanceof Error ? err.message : "Erreur serveur lors de la génération DSF"
      return reply.status(500).send({ error: msg })
    }
  })

  /**
   * GET /declarations/dsf/exercice/:exerciceId
   * Tableaux T07–T09 enregistrés après génération
   */
  app.get("/dsf/exercice/:exerciceId", async (request, reply) => {
    const user       = request.user as { cabinetId: string }
    const exerciceId = (request.params as { exerciceId: string }).exerciceId

    const ex = await prisma.exercice.findFirst({
      where: { id: exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      select: {
        id:    true,
        annee: true,
        dossier: {
          select: { client: { select: { nomRaisonSociale: true, ncc: true } } },
        },
      },
    })
    if (!ex) return reply.status(404).send({ error: "Exercice introuvable" })

    const declId = `dsf-${exerciceId}`
    const decl   = await prisma.declarationFiscale.findFirst({
      where:   { id: declId },
      include: { tableauxDsf: { orderBy: { codeTableau: "asc" } } },
    })
    if (!decl?.tableauxDsf.length) {
      return reply.status(404).send({ error: "Aucune DSF générée pour cet exercice — utilisez « Générer DSF »." })
    }

    return reply.send({
      exercice: {
        id:        ex.id,
        annee:     ex.annee,
        clientNom: ex.dossier.client.nomRaisonSociale,
        clientNcc: ex.dossier.client.ncc,
      },
      declaration: {
        id:        decl.id,
        statut:    decl.statut,
        montantDu: decl.montantDu?.toString() ?? null,
        referenceEimpots: decl.referenceEimpots ?? null,
        dateDepot: decl.dateDepot?.toISOString() ?? null,
        dateVisa: decl.dateVisa?.toISOString() ?? null,
        updatedAt: decl.updatedAt,
      },
      tableaux: decl.tableauxDsf.map(t => ({
        code:    t.codeTableau,
        libelle: t.libelleTableau,
        valide:  t.valide,
        donnees: t.donnees,
      })),
    })
  })

  /** Marque la DSF comme prête (sans visa) */
  app.post("/:id/prete", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const { id } = request.params as { id: string }
    const decl = await prisma.declarationFiscale.findFirst({
      where: {
        id,
        typeDeclaration: "DSF_ANNUELLE",
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: { tableauxDsf: true },
    })
    if (!decl) return reply.status(404).send({ error: "Déclaration introuvable" })
    if (!decl.tableauxDsf.length) return reply.status(409).send({ error: "Générez d'abord la DSF" })
    if (decl.statut === "DEPOSEE" || decl.statut === "ACCEPTEE")
      return reply.status(409).send({ error: "Déclaration déjà déposée" })

    const updated = await prisma.declarationFiscale.update({
      where: { id },
      data: { statut: "PRETE", updatedAt: new Date() },
    })
    return reply.send({ declaration: updated, message: "DSF marquée prête pour visa/dépôt." })
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

  /** Marque la DSF comme déposée (MVP) */
  app.post("/:id/deposer", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const { id } = request.params as { id: string }
    const { referenceEimpots } = request.body as { referenceEimpots?: string }
    const ref = (referenceEimpots ?? "").trim()
    if (!ref) return reply.status(400).send({ error: "referenceEimpots requis" })

    const decl = await prisma.declarationFiscale.findFirst({
      where: {
        id,
        typeDeclaration: "DSF_ANNUELLE",
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: { exercice: { include: { dossier: { include: { client: true } } } } },
    })
    if (!decl) return reply.status(404).send({ error: "Déclaration introuvable" })
    if (decl.statut === "DEPOSEE" || decl.statut === "ACCEPTEE")
      return reply.status(409).send({ error: "Déclaration déjà déposée" })

    const dep = await prisma.$transaction(async tx => {
      const d = await tx.declarationFiscale.update({
        where: { id },
        data: {
          statut: "DEPOSEE",
          dateDepot: new Date(),
          referenceEimpots: ref,
          updatedAt: new Date(),
        },
      })
      await tx.echeanceFiscale.updateMany({
        where: {
          clientId: decl.exercice.dossier.client.id,
          typeDeclaration: "DSF_ANNUELLE",
          periodeLabel: `DSF-${decl.periodeAnnee}`,
        },
        data: { statut: "FAITE" },
      })
      return d
    })

    return reply.send({
      declaration: dep,
      message: "DSF déposée (MVP) et échéance marquée « faite ».",
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

  /**
   * GET /declarations/pilotage
   * Vue DSF & déclarations : toutes les échéances du cabinet + KPIs + exerciceId pour DSF
   */
  app.get("/pilotage", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const clients = await prisma.client.findMany({
      where: { cabinetId: user.cabinetId, actif: true },
      select: { id: true, nomRaisonSociale: true, ncc: true },
    })
    const clientIds = clients.map(c => c.id)
    if (clientIds.length === 0) {
      return reply.send({
        kpis: { aFaire: 0, urgentes: 0, deposees: 0 },
        lignes: [],
      })
    }

    const rows = await prisma.echeanceFiscale.findMany({
      where: { clientId: { in: clientIds } },
      orderBy: [{ dateEcheance: "asc" }, { clientId: "asc" }],
    })

    const exercices = await prisma.exercice.findMany({
      where: { dossier: { clientId: { in: clientIds } } },
      select: { id: true, annee: true, dossier: { select: { clientId: true } } },
    })
    const exParClientAnnee = new Map<string, string>()
    for (const ex of exercices) {
      exParClientAnnee.set(`${ex.dossier.clientId}:${ex.annee}`, ex.id)
    }

    const maintenant = new Date()
    const debutJour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())

    const nomPar = Object.fromEntries(clients.map(c => [c.id, c.nomRaisonSociale]))
    const nccPar = Object.fromEntries(clients.map(c => [c.id, c.ncc]))

    const lignes = rows.map(r => {
      let exerciceId: string | null = null
      if (r.typeDeclaration === "DSF_ANNUELLE") {
        const m = r.periodeLabel.match(/DSF-(\d{4})/i)
        if (m) {
          exerciceId = exParClientAnnee.get(`${r.clientId}:${parseInt(m[1], 10)}`) ?? null
        }
      }

      const joursRestants = Math.ceil((r.dateEcheance.getTime() - maintenant.getTime()) / 86_400_000)

      let uiStatut: "DEPOSEE" | "EN_RETARD" | "URGENT" | "A_FAIRE"
      if (r.statut === "FAITE") {
        uiStatut = "DEPOSEE"
      } else if (r.dateEcheance < debutJour || r.statut === "EN_RETARD") {
        uiStatut = "EN_RETARD"
      } else if (joursRestants <= 7) {
        uiStatut = "URGENT"
      } else {
        uiStatut = "A_FAIRE"
      }

      return {
        id: r.id,
        clientId: r.clientId,
        clientNom: nomPar[r.clientId] ?? "—",
        clientNcc: nccPar[r.clientId] ?? "—",
        typeDeclaration: r.typeDeclaration,
        periodeLabel: r.periodeLabel,
        dateEcheance: r.dateEcheance.toISOString(),
        joursRestants,
        statutEcheance: r.statut,
        uiStatut,
        exerciceId,
      }
    })

    const deposees = lignes.filter(l => l.uiStatut === "DEPOSEE").length
    const urgentes = lignes.filter(l => l.uiStatut === "EN_RETARD" || l.uiStatut === "URGENT").length
    const aFaire = lignes.filter(l => l.uiStatut === "A_FAIRE").length

    return reply.send({ kpis: { aFaire, urgentes, deposees }, lignes })
  })

  /**
   * GET /declarations/notifications/preview
   * Prévisualise les alertes J-30 / J-15 / J-7 à déclencher
   */
  app.get("/notifications/preview", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const now = new Date()
    const clients = await prisma.client.findMany({
      where: { cabinetId: user.cabinetId, actif: true },
      select: { id: true, nomRaisonSociale: true, ncc: true },
    })
    const clientIds = clients.map(c => c.id)
    if (clientIds.length === 0) {
      return reply.send({
        destinataires: { email: null, whatsapp: null },
        parametres: { j30: true, j15: true, j7: true },
        total: 0,
        alerts: [],
      })
    }
    const clientParId = Object.fromEntries(
      clients.map(c => [c.id, { nom: c.nomRaisonSociale, ncc: c.ncc }])
    )
    const p = await prisma.parametreCabinet.findUnique({
      where: { cabinetId: user.cabinetId },
      select: {
        alerteJ30: true,
        alerteJ15: true,
        alerteJ7: true,
        emailAlertes: true,
        whatsappAlertes: true,
      },
    })
    const enabled = {
      j30: p?.alerteJ30 ?? true,
      j15: p?.alerteJ15 ?? true,
      j7: p?.alerteJ7 ?? true,
    }

    const rows = await prisma.echeanceFiscale.findMany({
      where: {
        clientId: { in: clientIds },
        statut: { in: ["A_FAIRE", "EN_COURS", "EN_RETARD"] },
      },
      orderBy: { dateEcheance: "asc" },
    })

    const alerts = rows
      .map(r => {
        const joursRestants = Math.ceil((r.dateEcheance.getTime() - now.getTime()) / 86_400_000)
        const seuil = seuilAlerte(joursRestants)
        if (!seuil) return null
        if (seuil === "J30" && (!enabled.j30 || r.alerteJ30)) return null
        if (seuil === "J15" && (!enabled.j15 || r.alerteJ15)) return null
        if (seuil === "J7" && (!enabled.j7 || r.alerteJ7)) return null
        return {
          echeanceId: r.id,
          clientId: r.clientId,
          clientNom: clientParId[r.clientId]?.nom ?? "—",
          clientNcc: clientParId[r.clientId]?.ncc ?? "—",
          typeDeclaration: r.typeDeclaration,
          periodeLabel: r.periodeLabel,
          dateEcheance: r.dateEcheance,
          joursRestants,
          seuil,
        }
      })
      .filter(Boolean)

    return reply.send({
      destinataires: { email: p?.emailAlertes ?? null, whatsapp: p?.whatsappAlertes ?? null },
      parametres: enabled,
      total: alerts.length,
      alerts,
    })
  })

  /** Prépare une déclaration non-DSF pour dépôt e-impôts (MVP) */
  app.post("/echeances/:id/preparer", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const { id } = request.params as { id: string }
    const e = await prisma.echeanceFiscale.findUnique({ where: { id } })
    if (!e) return reply.status(404).send({ error: "Échéance introuvable" })
    if (e.typeDeclaration === "DSF_ANNUELLE")
      return reply.status(409).send({ error: "Utilisez le workflow DSF pour cette échéance." })
    const client = await prisma.client.findFirst({ where: { id: e.clientId, cabinetId: user.cabinetId } })
    if (!client) return reply.status(403).send({ error: "Accès refusé à cette échéance" })
    if (e.statut === "FAITE") return reply.status(409).send({ error: "Échéance déjà déposée" })

    const up = await prisma.echeanceFiscale.update({
      where: { id },
      data: { statut: "EN_COURS" },
    })
    return reply.send({ echeance: up, message: "Déclaration marquée « en cours de dépôt »." })
  })

  /** Marque une déclaration non-DSF comme déposée (MVP e-impôts) */
  app.post("/echeances/:id/deposer", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const { id } = request.params as { id: string }
    const { referenceEimpots } = request.body as { referenceEimpots?: string }
    const ref = (referenceEimpots ?? "").trim()
    if (!ref) return reply.status(400).send({ error: "referenceEimpots requis" })

    const e = await prisma.echeanceFiscale.findUnique({ where: { id } })
    if (!e) return reply.status(404).send({ error: "Échéance introuvable" })
    if (e.typeDeclaration === "DSF_ANNUELLE")
      return reply.status(409).send({ error: "Utilisez le workflow DSF pour cette échéance." })
    const client = await prisma.client.findFirst({ where: { id: e.clientId, cabinetId: user.cabinetId } })
    if (!client) return reply.status(403).send({ error: "Accès refusé à cette échéance" })

    const up = await prisma.echeanceFiscale.update({
      where: { id },
      data: { statut: "FAITE", dateDepot: new Date(), referenceDepot: ref },
    })
    return reply.send({ echeance: up, message: "Déclaration marquée déposée (e-impôts)." })
  })

  /**
   * POST /declarations/notifications/run
   * MVP : marque les alertes comme "envoyées" (sans transport email/wa)
   */
  app.post("/notifications/run", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const now = new Date()
    const clients = await prisma.client.findMany({
      where: { cabinetId: user.cabinetId, actif: true },
      select: { id: true },
    })
    const clientIds = clients.map(c => c.id)
    if (clientIds.length === 0) {
      return reply.send({
        message: "Aucun client actif pour traiter des alertes.",
        compteurs: { j30: 0, j15: 0, j7: 0, total: 0 },
      })
    }
    const p = await prisma.parametreCabinet.findUnique({
      where: { cabinetId: user.cabinetId },
      select: { alerteJ30: true, alerteJ15: true, alerteJ7: true },
    })
    const enabled = {
      j30: p?.alerteJ30 ?? true,
      j15: p?.alerteJ15 ?? true,
      j7: p?.alerteJ7 ?? true,
    }
    const rows = await prisma.echeanceFiscale.findMany({
      where: {
        clientId: { in: clientIds },
        statut: { in: ["A_FAIRE", "EN_COURS", "EN_RETARD"] },
      },
      select: {
        id: true,
        clientId: true,
        typeDeclaration: true,
        periodeLabel: true,
        dateEcheance: true,
        alerteJ30: true,
        alerteJ15: true,
        alerteJ7: true,
      },
    })

    let j30 = 0
    let j15 = 0
    let j7 = 0
    for (const r of rows) {
      const joursRestants = Math.ceil((r.dateEcheance.getTime() - now.getTime()) / 86_400_000)
      const seuil = seuilAlerte(joursRestants)
      if (seuil === "J30" && enabled.j30 && !r.alerteJ30) {
        await prisma.echeanceFiscale.update({ where: { id: r.id }, data: { alerteJ30: true } })
        j30++
      }
      if (seuil === "J15" && enabled.j15 && !r.alerteJ15) {
        await prisma.echeanceFiscale.update({ where: { id: r.id }, data: { alerteJ15: true } })
        j15++
      }
      if (seuil === "J7" && enabled.j7 && !r.alerteJ7) {
        await prisma.echeanceFiscale.update({ where: { id: r.id }, data: { alerteJ7: true } })
        j7++
      }
    }

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "ALERTES_ECHEANCES_RUN",
        entite: "echeances_fiscales",
        entiteId: "batch",
        donneeApres: { j30, j15, j7, total: j30 + j15 + j7 },
      },
    })

    return reply.send({
      message: "Traitement des alertes terminé (MVP, marquage uniquement).",
      compteurs: { j30, j15, j7, total: j30 + j15 + j7 },
    })
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

function seuilAlerte(joursRestants: number): "J30" | "J15" | "J7" | null {
  if (joursRestants <= 7) return "J7"
  if (joursRestants <= 15) return "J15"
  if (joursRestants <= 30) return "J30"
  return null
}
