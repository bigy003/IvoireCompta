import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"

const prisma = new PrismaClient()

const MoisSchema = z.object({
  exerciceId: z.string().uuid(),
  mois: z.number().int().min(1).max(12),
  annee: z.number().int().min(2000).max(2100),
})
const DepotSchema = MoisSchema.extend({
  referenceEimpots: z.string().min(3).max(120),
})

function periodBounds(annee: number, mois: number) {
  const du = new Date(Date.UTC(annee, mois - 1, 1, 0, 0, 0))
  const au = new Date(Date.UTC(annee, mois, 0, 23, 59, 59))
  return { du, au }
}

function periodKey(exerciceId: string, annee: number, mois: number) {
  return `${exerciceId}:${annee}-${String(mois).padStart(2, "0")}`
}

function toNum(v: unknown): number {
  return Number((v as { toString?: () => string })?.toString?.() ?? 0)
}

export async function tvaRoutes(app: FastifyInstance) {
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
    const { du, au } = periodBounds(annee, mois)
    const pKey = periodKey(exerciceId, annee, mois)

    const exercice = await prisma.exercice.findFirst({
      where: { id: exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { include: { client: { select: { id: true, nomRaisonSociale: true } } } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const factures = await prisma.facture.findMany({
      where: {
        clientId: exercice.dossier.clientId,
        dateEmission: { gte: du, lte: au },
        statut: { in: ["EMISE", "PARTIELLEMENT_PAYEE", "PAYEE", "EN_RETARD"] },
      },
      select: { sousTotalHt: true, montantTva: true, totalTtc: true },
    })

    const ecritures = await prisma.ecriture.findMany({
      where: {
        exerciceId,
        dateOperation: { gte: du, lte: au },
        statut: "VALIDEE",
      },
      include: { lignes: true },
    })

    const baseCollecteeHt = factures.reduce((s, f) => s + toNum(f.sousTotalHt), 0)
    const tvaCollectee = factures.reduce((s, f) => s + toNum(f.montantTva), 0)
    const ttcCollecte = factures.reduce((s, f) => s + toNum(f.totalTtc), 0)
    const facturesEmises = factures.length

    const tvaDeductible = Math.round(
      ecritures.reduce((s, e) => {
        const surEcriture = e.lignes
          .filter(l => l.compteSyscohada.startsWith("4456"))
          .reduce((x, l) => x + (toNum(l.debit) - toNum(l.credit)), 0)
        return s + Math.max(0, surEcriture)
      }, 0)
    )

    const baseDeductibleHt = Math.round(
      ecritures.reduce((s, e) => {
        const surEcriture = e.lignes
          .filter(l => l.compteSyscohada.startsWith("6"))
          .reduce((x, l) => x + toNum(l.debit), 0)
        return s + surEcriture
      }, 0)
    )

    const netTva = tvaCollectee - tvaDeductible
    const aPayer = Math.max(0, netTva)
    const creditTva = Math.max(0, -netTva)
    const tvaTheorique18 = Math.round((baseCollecteeHt * 18) / 100)
    const ecartCollecteeVsTheorique = Math.abs(tvaCollectee - tvaTheorique18)
    const lignes4456 = ecritures.reduce(
      (s, e) => s + e.lignes.filter(l => l.compteSyscohada.startsWith("4456")).length,
      0
    )
    const ecrituresSansPieceRef = ecritures.filter(e => !e.pieceRef || !e.pieceRef.trim()).length

    const verrou = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "TVA_MENSUELLE_VALIDEE",
        entite: "tva_mensuelle",
        entiteId: pKey,
      },
    })
    const echeanceTva = await prisma.echeanceFiscale.findFirst({
      where: {
        clientId: exercice.dossier.clientId,
        typeDeclaration: "TVA_MENSUELLE",
        dateEcheance: { gte: du, lte: au },
      },
      select: {
        id: true,
        statut: true,
        dateDepot: true,
        referenceDepot: true,
      },
      orderBy: { dateEcheance: "desc" },
    })

    const historique = await prisma.auditLog.findMany({
      where: {
        cabinetId: user.cabinetId,
        entite: "tva_mensuelle",
        entiteId: pKey,
        action: { in: ["TVA_MENSUELLE_VALIDEE", "TVA_MENSUELLE_DEVERROUILLEE"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { action: true, createdAt: true, userId: true },
    })

    return reply.send({
      client: exercice.dossier.client,
      kpi: {
        baseCollecteeHt: String(baseCollecteeHt),
        tvaCollectee: String(tvaCollectee),
        baseDeductibleHt: String(baseDeductibleHt),
        tvaDeductible: String(tvaDeductible),
        ttcCollecte: String(ttcCollecte),
        netTva: String(netTva),
        tvaAPayer: String(aPayer),
        creditTva: String(creditTva),
      },
      controles: [
        {
          code: "COHERENCE_TVA_18",
          label: "Cohérence TVA collectée vs base HT (taux indicatif 18%)",
          ok: ecartCollecteeVsTheorique <= 5,
          detail: `${ecartCollecteeVsTheorique.toLocaleString("fr-FR")} FCFA d'écart`,
        },
        {
          code: "FACTURES_PERIODE",
          label: "Factures émises sur la période",
          ok: facturesEmises > 0,
          detail: `${facturesEmises} facture(s)`,
        },
        {
          code: "TVA_DEDUCTIBLE_COMPTES",
          label: "Écritures avec comptes TVA déductible (4456x)",
          ok: lignes4456 > 0 || tvaDeductible === 0,
          detail: `${lignes4456} ligne(s) 4456x`,
        },
        {
          code: "PIECES_REF",
          label: "Écritures validées avec référence de pièce",
          ok: ecrituresSansPieceRef === 0,
          detail: `${ecrituresSansPieceRef} écriture(s) sans pièce`,
        },
      ],
      depot: {
        echeanceId: echeanceTva?.id ?? null,
        statut: echeanceTva?.statut ?? null,
        dateDepot: echeanceTva?.dateDepot ?? null,
        referenceEimpots: echeanceTva?.referenceDepot ?? null,
      },
      verrouille: Boolean(verrou),
      historique,
    })
  })

  app.post("/valider", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = MoisSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, mois, annee } = parsed.data
    const pKey = periodKey(exerciceId, annee, mois)

    const exist = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "TVA_MENSUELLE_VALIDEE",
        entite: "tva_mensuelle",
        entiteId: pKey,
      },
    })
    if (exist) return reply.send({ ok: true, dejaValide: true })

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "TVA_MENSUELLE_VALIDEE",
        entite: "tva_mensuelle",
        entiteId: pKey,
        donneeApres: { exerciceId, mois, annee, valideLe: new Date().toISOString() },
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
        action: "TVA_MENSUELLE_VALIDEE",
        entite: "tva_mensuelle",
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
          action: "TVA_MENSUELLE_DEVERROUILLEE",
          entite: "tva_mensuelle",
          entiteId: pKey,
          donneeApres: { exerciceId, mois, annee, deverrouilleLe: new Date().toISOString() },
        },
      }),
    ])
    return reply.send({ ok: true })
  })

  app.post("/deposer", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = DepotSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, mois, annee, referenceEimpots } = parsed.data
    const pKey = periodKey(exerciceId, annee, mois)
    const ref = referenceEimpots.trim()

    const exercice = await prisma.exercice.findFirst({
      where: { id: exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { select: { clientId: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const verrou = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "TVA_MENSUELLE_VALIDEE",
        entite: "tva_mensuelle",
        entiteId: pKey,
      },
    })
    if (!verrou) {
      return reply.status(409).send({ error: "Validez d'abord la TVA mensuelle avant dépôt." })
    }

    const { du, au } = periodBounds(annee, mois)
    const echeance = await prisma.echeanceFiscale.findFirst({
      where: {
        clientId: exercice.dossier.clientId,
        typeDeclaration: "TVA_MENSUELLE",
        dateEcheance: { gte: du, lte: au },
      },
      orderBy: { dateEcheance: "desc" },
    })
    if (!echeance) {
      return reply.status(404).send({ error: "Aucune échéance TVA trouvée pour cette période." })
    }

    const up = await prisma.echeanceFiscale.update({
      where: { id: echeance.id },
      data: {
        statut: "FAITE",
        dateDepot: new Date(),
        referenceDepot: ref,
      },
    })

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "TVA_MENSUELLE_DEPOSEE",
        entite: "tva_mensuelle",
        entiteId: pKey,
        donneeApres: { exerciceId, mois, annee, referenceEimpots: ref, echeanceId: up.id },
      },
    })

    return reply.send({
      ok: true,
      depot: {
        echeanceId: up.id,
        statut: up.statut,
        dateDepot: up.dateDepot,
        referenceEimpots: up.referenceDepot,
      },
      message: "TVA marquée déposée (mode dev local).",
    })
  })
}

