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
}
