/**
 * IvoireCompta — Route /dashboard
 * Tableau de bord cabinet : KPIs, deadlines, alertes
 */

import { FastifyInstance } from "fastify"
import { PrismaClient, StatutDossier } from "@prisma/client"

const prisma = new PrismaClient()

function moisCle(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function sixDerniersMois() {
  const d = new Date()
  const out: { cle: string; label: string }[] = []
  for (let i = 5; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push({
      cle: moisCle(x),
      label: x.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    })
  }
  return out
}

export async function dashboardRoutes(app: FastifyInstance) {
  /**
   * GET /dashboard
   * Vue d'ensemble du cabinet : clients, dossiers, échéances, activité
   */
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const maintenant = new Date()
    const dans30j = new Date(maintenant.getTime() + 30 * 24 * 60 * 60 * 1000)
    const debut6mois = new Date(maintenant.getFullYear(), maintenant.getMonth() - 5, 1)

    const clientsCabinet = await prisma.client.findMany({
      where: { cabinetId: user.cabinetId, actif: true },
      select: { id: true },
    })
    const clientIds = clientsCabinet.map(c => c.id)

    const dossiersVides = {
      EN_COURS: 0,
      SUSPENDU: 0,
      CLOTURE: 0,
      ARCHIVE: 0,
    }

    if (clientIds.length === 0) {
      const moisLabels = sixDerniersMois()
      return reply.send({
        kpis: {
          nbClients: 0,
          nbDossiersEnCours: 0,
          declarationsEnRetard: 0,
          declarationsDeposeesMois: 0,
          echeancesProchaines: 0,
          ecrituresBrouillon: 0,
        },
        dossiersParStatut: dossiersVides,
        activiteMensuelle: moisLabels.map(({ cle, label }) => ({
          periode: cle,
          label,
          declarationsDeposees: 0,
          ecrituresValidees: 0,
        })),
        echeances: [],
        alertes: [],
      })
    }

    const [
      nbClients,
      nbDossiersEnCours,
      echeancesUrgentes,
      declarationsEnRetard,
      declarationsDeposeesMois,
      dossiersGroup,
      ecrituresBrouillon,
      depos6m,
      validees6m,
    ] = await Promise.all([
      prisma.client.count({
        where: { cabinetId: user.cabinetId, actif: true },
      }),
      prisma.dossier.count({
        where: { statut: "EN_COURS", client: { cabinetId: user.cabinetId } },
      }),
      prisma.echeanceFiscale.findMany({
        where: {
          clientId: { in: clientIds },
          dateEcheance: { gte: maintenant, lte: dans30j },
          statut: { in: ["A_FAIRE", "EN_COURS"] },
        },
        orderBy: { dateEcheance: "asc" },
        take: 20,
      }),
      prisma.declarationFiscale.count({
        where: {
          dateEcheance: { lt: maintenant },
          statut: { in: ["A_PREPARER", "EN_PREPARATION", "PRETE", "VISEE"] },
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      }),
      prisma.declarationFiscale.count({
        where: {
          statut: { in: ["DEPOSEE", "ACCEPTEE"] },
          dateDepot: {
            gte: new Date(maintenant.getFullYear(), maintenant.getMonth(), 1),
          },
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      }),
      prisma.dossier.groupBy({
        by: ["statut"],
        where: { client: { cabinetId: user.cabinetId } },
        _count: true,
      }),
      prisma.ecriture.count({
        where: {
          statut: "BROUILLON",
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      }),
      prisma.declarationFiscale.findMany({
        where: {
          statut: { in: ["DEPOSEE", "ACCEPTEE"] },
          dateDepot: { gte: debut6mois },
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
        select: { dateDepot: true },
      }),
      prisma.ecriture.findMany({
        where: {
          statut: "VALIDEE",
          valideeLe: { gte: debut6mois },
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
        select: { valideeLe: true },
      }),
    ])

    const dossiersParStatut = { ...dossiersVides }
    for (const row of dossiersGroup) {
      const s = row.statut as StatutDossier
      if (s in dossiersParStatut) {
        dossiersParStatut[s] = row._count
      }
    }

    const depParMois: Record<string, number> = {}
    const ecritParMois: Record<string, number> = {}
    for (const { cle } of sixDerniersMois()) {
      depParMois[cle] = 0
      ecritParMois[cle] = 0
    }
    for (const d of depos6m) {
      if (d.dateDepot) {
        const k = moisCle(d.dateDepot)
        if (k in depParMois) depParMois[k]++
      }
    }
    for (const e of validees6m) {
      if (e.valideeLe) {
        const k = moisCle(e.valideeLe)
        if (k in ecritParMois) ecritParMois[k]++
      }
    }

    const activiteMensuelle = sixDerniersMois().map(({ cle, label }) => ({
      periode: cle,
      label,
      declarationsDeposees: depParMois[cle] ?? 0,
      ecrituresValidees: ecritParMois[cle] ?? 0,
    }))

    const echeanceClientIds = [...new Set(echeancesUrgentes.map(e => e.clientId))]
    const clientsNom = await prisma.client.findMany({
      where: { id: { in: echeanceClientIds } },
      select: { id: true, nomRaisonSociale: true },
    })
    const nomParClient = Object.fromEntries(clientsNom.map(c => [c.id, c.nomRaisonSociale]))

    const echeancesEnrichies = echeancesUrgentes.map(e => {
      const jours = Math.ceil((e.dateEcheance.getTime() - maintenant.getTime()) / 86_400_000)
      return {
        id: e.id,
        clientId: e.clientId,
        clientNom: nomParClient[e.clientId] ?? "Client",
        typeDeclaration: e.typeDeclaration,
        periodeLabel: e.periodeLabel,
        dateEcheance: e.dateEcheance.toISOString(),
        statut: e.statut,
        joursRestants: jours,
        urgence: jours <= 7 ? "ROUGE" : jours <= 15 ? "ORANGE" : "VERT",
      }
    })

    return reply.send({
      kpis: {
        nbClients,
        nbDossiersEnCours,
        declarationsEnRetard,
        declarationsDeposeesMois,
        echeancesProchaines: echeancesUrgentes.length,
        ecrituresBrouillon,
      },
      dossiersParStatut,
      activiteMensuelle,
      echeances: echeancesEnrichies,
      alertes: echeancesEnrichies.filter(e => e.urgence === "ROUGE"),
    })
  })

  /**
   * GET /dashboard/etat-dossier
   * Vue "Etat du dossier" : sante des dossiers par client + actions
   */
  app.get("/etat-dossier", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const now = new Date()
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const currentYear = now.getFullYear()

    const clients = await prisma.client.findMany({
      where: { cabinetId: user.cabinetId, actif: true },
      select: { id: true, nomRaisonSociale: true, ncc: true },
    })
    const clientIds = clients.map(c => c.id)
    if (clientIds.length === 0) {
      return reply.send({
        kpis: {
          bonneSante: 0,
          aRisque: 0,
          enRetard: 0,
          echeances7j: 0,
          declarationsRetard: 0,
        },
        rows: [],
        actionsRecommandees: [],
      })
    }

    const dossiers = await prisma.dossier.findMany({
      where: { clientId: { in: clientIds } },
      select: { id: true, clientId: true, statut: true, updatedAt: true },
    })
    const dossierIds = dossiers.map(d => d.id)
    if (dossierIds.length === 0) {
      return reply.send({
        kpis: {
          bonneSante: 0,
          aRisque: 0,
          enRetard: 0,
          echeances7j: 0,
          declarationsRetard: 0,
        },
        rows: [],
        actionsRecommandees: [],
      })
    }

    const exercices = await prisma.exercice.findMany({
      where: { dossierId: { in: dossierIds } },
      select: { id: true, dossierId: true, annee: true, updatedAt: true },
    })
    const exIds = exercices.map(x => x.id)

    const [brouillons, ecrituresRecentes, declarationsRetardRows, declarationsDsf, echeances7Rows] =
      exIds.length === 0
        ? [[], [], [], [], []] as const
        : await Promise.all([
            prisma.ecriture.groupBy({
              by: ["exerciceId"],
              where: { exerciceId: { in: exIds }, statut: "BROUILLON" },
              _count: true,
            }),
            prisma.ecriture.groupBy({
              by: ["exerciceId"],
              where: { exerciceId: { in: exIds } },
              _max: { updatedAt: true },
            }),
            prisma.declarationFiscale.groupBy({
              by: ["exerciceId"],
              where: {
                exerciceId: { in: exIds },
                dateEcheance: { lt: now },
                statut: { in: ["A_PREPARER", "EN_PREPARATION", "PRETE", "VISEE"] },
              },
              _count: true,
            }),
            prisma.declarationFiscale.findMany({
              where: {
                exerciceId: { in: exIds },
                typeDeclaration: "DSF_ANNUELLE",
                periodeAnnee: currentYear,
              },
              select: { exerciceId: true, statut: true },
            }),
            prisma.echeanceFiscale.groupBy({
              by: ["clientId"],
              where: {
                clientId: { in: clientIds },
                dateEcheance: { gte: now, lte: in7d },
                statut: { in: ["A_FAIRE", "EN_COURS", "EN_RETARD"] },
              },
              _count: true,
            }),
          ])

    const byClient = Object.fromEntries(clients.map(c => [c.id, c]))
    const exByDossier = new Map<string, { id: string; annee: number }[]>()
    for (const ex of exercices) {
      const arr = exByDossier.get(ex.dossierId) ?? []
      arr.push({ id: ex.id, annee: ex.annee })
      exByDossier.set(ex.dossierId, arr)
    }
    const brouillonByEx = new Map(brouillons.map(r => [r.exerciceId, r._count]))
    const retardByEx = new Map(declarationsRetardRows.map(r => [r.exerciceId, r._count]))
    const recentByEx = new Map(ecrituresRecentes.map(r => [r.exerciceId, r._max.updatedAt ?? null]))
    const dsfByEx = new Map(declarationsDsf.map(r => [r.exerciceId, r.statut]))
    const echeance7ByClient = new Map(echeances7Rows.map(r => [r.clientId, r._count]))

    const rows = dossiers.map(d => {
      const exList = [...(exByDossier.get(d.id) ?? [])].sort((a, b) => b.annee - a.annee)
      const exCurrent = exList.find(x => x.annee === currentYear)
      const selectedEx = exCurrent ?? exList[0] ?? null
      const exId = selectedEx?.id ?? null

      const ecrituresBrouillon = exId ? brouillonByEx.get(exId) ?? 0 : 0
      const declarationsRetard = exId ? retardByEx.get(exId) ?? 0 : 0
      const echeancesProches = echeance7ByClient.get(d.clientId) ?? 0
      const dsfRaw = exId ? dsfByEx.get(exId) : null

      let dsfStatut: "A_JOUR" | "EN_PREPARATION" | "RETARD_DSF" | "NON_DEMARRE" = "NON_DEMARRE"
      if (dsfRaw === "DEPOSEE" || dsfRaw === "ACCEPTEE") dsfStatut = "A_JOUR"
      else if (dsfRaw === "A_PREPARER" || dsfRaw === "EN_PREPARATION" || dsfRaw === "PRETE" || dsfRaw === "VISEE")
        dsfStatut = "EN_PREPARATION"
      else if (declarationsRetard > 0) dsfStatut = "RETARD_DSF"

      const lastActivity =
        (exId ? recentByEx.get(exId) : null) ?? d.updatedAt ?? null

      let statutGlobal: "EN_BONNE_SANTE" | "A_RISQUE" | "EN_RETARD" | "CLOTURE" = "EN_BONNE_SANTE"
      if (d.statut === "CLOTURE" || d.statut === "ARCHIVE") statutGlobal = "CLOTURE"
      else if (declarationsRetard > 0 || dsfStatut === "RETARD_DSF") statutGlobal = "EN_RETARD"
      else if (echeancesProches > 0 || ecrituresBrouillon >= 8 || d.statut === "SUSPENDU") statutGlobal = "A_RISQUE"

      return {
        clientId: d.clientId,
        clientNom: byClient[d.clientId]?.nomRaisonSociale ?? "—",
        clientNcc: byClient[d.clientId]?.ncc ?? "—",
        dossierId: d.id,
        dossierStatut: d.statut,
        statutGlobal,
        ecrituresBrouillon,
        echeancesProches,
        declarationsRetard,
        dsfStatut,
        derniereActivite: lastActivity ? new Date(lastActivity).toISOString() : null,
      }
    })

    const actionsRecommandees = rows
      .filter(r => r.statutGlobal === "EN_RETARD" || r.statutGlobal === "A_RISQUE")
      .sort((a, b) => {
        const score = (x: (typeof rows)[number]) =>
          (x.statutGlobal === "EN_RETARD" ? 10 : 5) + x.declarationsRetard * 3 + x.echeancesProches * 2 + x.ecrituresBrouillon
        return score(b) - score(a)
      })
      .slice(0, 6)
      .map(r => ({
        clientId: r.clientId,
        clientNom: r.clientNom,
        motif:
          r.declarationsRetard > 0
            ? `${r.declarationsRetard} déclaration(s) en retard`
            : r.echeancesProches > 0
              ? `${r.echeancesProches} échéance(s) <= 7 jours`
              : `${r.ecrituresBrouillon} écriture(s) brouillon`,
        niveau: r.statutGlobal,
      }))

    return reply.send({
      kpis: {
        bonneSante: rows.filter(r => r.statutGlobal === "EN_BONNE_SANTE").length,
        aRisque: rows.filter(r => r.statutGlobal === "A_RISQUE").length,
        enRetard: rows.filter(r => r.statutGlobal === "EN_RETARD").length,
        echeances7j: rows.reduce((s, r) => s + r.echeancesProches, 0),
        declarationsRetard: rows.reduce((s, r) => s + r.declarationsRetard, 0),
      },
      rows,
      actionsRecommandees,
    })
  })
}
