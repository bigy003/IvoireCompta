/**
 * IvoireCompta — Route /dashboard
 * Tableau de bord cabinet : KPIs, deadlines, alertes
 */

import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function dashboardRoutes(app: FastifyInstance) {

  /**
   * GET /dashboard
   * Vue d'ensemble du cabinet : clients actifs, échéances, revenus
   */
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const maintenant = new Date()
    const dans30j    = new Date(maintenant.getTime() + 30 * 24 * 60 * 60 * 1000)

    const [
      nbClients,
      nbDossiersEnCours,
      echeancesUrgentes,
      declarationsEnRetard,
      declarationsDeposeesMois,
    ] = await Promise.all([
      // Clients actifs
      prisma.client.count({
        where: { cabinetId: user.cabinetId, actif: true },
      }),
      // Dossiers en cours
      prisma.dossier.count({
        where: { statut: "EN_COURS", client: { cabinetId: user.cabinetId } },
      }),
      // Échéances dans les 30 prochains jours
      prisma.echeanceFiscale.findMany({
        where: {
          dateEcheance: { gte: maintenant, lte: dans30j },
          statut: { in: ["A_FAIRE", "EN_COURS"] },
        },
        orderBy: { dateEcheance: "asc" },
        take: 20,
      }),
      // Déclarations en retard (date dépassée, non déposées)
      prisma.declarationFiscale.count({
        where: {
          dateEcheance: { lt: maintenant },
          statut: { in: ["A_PREPARER", "EN_PREPARATION", "PRETE", "VISEE"] },
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      }),
      // Déclarations déposées ce mois
      prisma.declarationFiscale.count({
        where: {
          statut: "DEPOSEE",
          dateDepot: {
            gte: new Date(maintenant.getFullYear(), maintenant.getMonth(), 1),
          },
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      }),
    ])

    // Enrichir les échéances avec jours restants
    const echeancesEnrichies = echeancesUrgentes.map(e => {
      const jours = Math.ceil((e.dateEcheance.getTime() - maintenant.getTime()) / 86_400_000)
      return { ...e, joursRestants: jours, urgence: jours <= 7 ? "ROUGE" : jours <= 15 ? "ORANGE" : "VERT" }
    })

    return reply.send({
      kpis: {
        nbClients,
        nbDossiersEnCours,
        declarationsEnRetard,
        declarationsDeposeesMois,
        echeancesProchaines: echeancesUrgentes.length,
      },
      echeances:    echeancesEnrichies,
      alertes:      echeancesEnrichies.filter(e => e.urgence === "ROUGE"),
    })
  })
}
