import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"

const prisma = new PrismaClient()

const MoisSchema = z.object({
  exerciceId: z.string().uuid(),
  mois: z.number().int().min(1).max(12),
  annee: z.number().int().min(2000).max(2100),
})

const ValiderSchema = MoisSchema.extend({
  commentaire: z.string().min(3).max(500),
  confirmation: z.boolean(),
})

function periodBounds(annee: number, mois: number) {
  const du = new Date(Date.UTC(annee, mois - 1, 1, 0, 0, 0))
  const au = new Date(Date.UTC(annee, mois, 0, 23, 59, 59))
  return { du, au }
}

function periodKey(exerciceId: string, annee: number, mois: number) {
  return `${exerciceId}:${annee}-${String(mois).padStart(2, "0")}`
}

export async function clotureMensuelleRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const query = request.query as { exerciceId?: string; mois?: string; annee?: string }
    const parsed = MoisSchema.safeParse({
      exerciceId: query.exerciceId,
      mois: Number(query.mois),
      annee: Number(query.annee),
    })
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, mois, annee } = parsed.data

    const exercice = await prisma.exercice.findFirst({
      where: { id: exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { select: { clientId: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const { du, au } = periodBounds(annee, mois)
    const pKey = periodKey(exerciceId, annee, mois)

    const ecritures = await prisma.ecriture.findMany({
      where: {
        exerciceId,
        dateOperation: { gte: du, lte: au },
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: { lignes: true },
    })

    const totalEcritures = ecritures.length
    const ecrituresValidees = ecritures.filter(e => e.statut === "VALIDEE").length
    const totalDebit = ecritures.reduce(
      (s, e) => s + e.lignes.reduce((x, l) => x + Number(l.debit.toString()), 0),
      0
    )
    const totalCredit = ecritures.reduce(
      (s, e) => s + e.lignes.reduce((x, l) => x + Number(l.credit.toString()), 0),
      0
    )
    const ecart = Math.abs(totalDebit - totalCredit)

    const auditRappro = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "RAPPROCHEMENT_MENSUEL_VALIDE",
        entite: "rapprochement_bancaire_mensuel",
        entiteId: `${exerciceId}:${du.toISOString().slice(0, 10)}:${au.toISOString().slice(0, 10)}`,
      },
    })

    const mouvementsNonRapproches = await prisma.mouvementBancaire.count({
      where: {
        exerciceId,
        clientId: exercice.dossier.clientId,
        dateOperation: { gte: du, lte: au },
        statut: { in: ["NON_RAPPROCHE", "A_VERIFIER"] },
      },
    })

    const declarationsUrgentes = await prisma.echeanceFiscale.count({
      where: {
        clientId: exercice.dossier.clientId,
        dateEcheance: { lte: au },
        statut: { in: ["A_FAIRE", "EN_COURS", "EN_RETARD", "PENALISEE"] },
      },
    })

    const piecesAvecReference = ecritures.filter(e => Boolean(e.pieceRef && e.pieceRef.trim())).length
    const verrou = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "CLOTURE_MENSUELLE_VALIDEE",
        entite: "cloture_mensuelle",
        entiteId: pKey,
      },
    })

    const historique = await prisma.auditLog.findMany({
      where: {
        cabinetId: user.cabinetId,
        entite: "cloture_mensuelle",
        entiteId: pKey,
        action: { in: ["CLOTURE_MENSUELLE_VALIDEE", "CLOTURE_MENSUELLE_DEVERROUILLEE"] },
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, createdAt: true, userId: true, donneeApres: true },
      take: 10,
    })

    const checklist = [
      {
        code: "ECRITURES_VALIDEES",
        label: "Toutes les écritures sont validées",
        ok: totalEcritures === ecrituresValidees,
      },
      {
        code: "RAPPROCHEMENT_BANQUE",
        label: "Rapprochement bancaire validé",
        ok: Boolean(auditRappro) && mouvementsNonRapproches === 0,
      },
      {
        code: "BALANCE_EQUILIBREE",
        label: "Balance équilibrée (écart = 0)",
        ok: ecart === 0,
      },
      {
        code: "DECLARATIONS_URGENTES",
        label: "Aucune déclaration urgente non traitée",
        ok: declarationsUrgentes === 0,
      },
      {
        code: "PIECES_MINIMALES",
        label: "Pièces justificatives minimales présentes",
        ok: totalEcritures === 0 ? true : piecesAvecReference / totalEcritures >= 0.8,
      },
    ]

    const anomalies = [
      ...(totalEcritures - ecrituresValidees > 0
        ? [{ type: "Écriture non validée", reference: `${totalEcritures - ecrituresValidees} écriture(s)`, gravite: "Élevée" }]
        : []),
      ...(ecart > 0 ? [{ type: "Écart de balance", reference: `${ecart} FCFA`, gravite: "Élevée" }] : []),
      ...(mouvementsNonRapproches > 0
        ? [{ type: "Mouvement bancaire non rapproché", reference: `${mouvementsNonRapproches} mouvement(s)`, gravite: "Modérée" }]
        : []),
    ]

    return reply.send({
      kpi: {
        ecrituresMois: totalEcritures,
        ecrituresValidees,
        tauxRapprochement: mouvementsNonRapproches === 0 ? 100 : 0,
        ecartDebitCredit: String(ecart),
      },
      checklist,
      anomalies,
      verrouille: Boolean(verrou),
      historique,
    })
  })

  app.post("/valider", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = ValiderSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, mois, annee, commentaire, confirmation } = parsed.data
    if (!confirmation) return reply.status(400).send({ error: "Confirmation requise." })

    const pKey = periodKey(exerciceId, annee, mois)
    const exist = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "CLOTURE_MENSUELLE_VALIDEE",
        entite: "cloture_mensuelle",
        entiteId: pKey,
      },
    })
    if (exist) return reply.send({ ok: true, dejaValide: true })

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "CLOTURE_MENSUELLE_VALIDEE",
        entite: "cloture_mensuelle",
        entiteId: pKey,
        donneeApres: { exerciceId, mois, annee, commentaire, valideLe: new Date().toISOString() },
      },
    })
    return reply.send({ ok: true })
  })

  app.post("/deverrouiller", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string; role: string }
    if (user.role !== "EXPERT_COMPTABLE" && user.role !== "ADMIN_CABINET") {
      return reply.status(403).send({ error: "Action réservée à l'expert-comptable ou admin cabinet." })
    }
    const parsed = MoisSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, mois, annee } = parsed.data
    const pKey = periodKey(exerciceId, annee, mois)

    const verrou = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "CLOTURE_MENSUELLE_VALIDEE",
        entite: "cloture_mensuelle",
        entiteId: pKey,
      },
    })
    if (!verrou) return reply.send({ ok: true, dejaDeverrouille: true })

    await prisma.$transaction([
      prisma.auditLog.delete({ where: { id: verrou.id } }),
      prisma.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId: user.id,
          action: "CLOTURE_MENSUELLE_DEVERROUILLEE",
          entite: "cloture_mensuelle",
          entiteId: pKey,
          donneeApres: { exerciceId, mois, annee, deverrouilleLe: new Date().toISOString() },
        },
      }),
    ])
    return reply.send({ ok: true })
  })
}

