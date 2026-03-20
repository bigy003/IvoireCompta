import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"

const prisma = new PrismaClient()

const ImportRowSchema = z.object({
  dateOperation: z.string().min(1),
  libelle: z.string().min(1).max(300),
  reference: z.string().max(120).optional(),
  debit: z.number().int().min(0).default(0),
  credit: z.number().int().min(0).default(0),
  solde: z.number().int().optional(),
})

const ImportSchema = z.object({
  clientId: z.string().uuid(),
  exerciceId: z.string().uuid(),
  rows: z.array(ImportRowSchema).min(1),
})

const MatchSchema = z.object({
  mouvementId: z.string().uuid(),
  ecritureId: z.string().uuid(),
  montant: z.number().int().min(0).optional(),
  commentaire: z.string().max(400).optional(),
})

const ValiderMoisSchema = z.object({
  exerciceId: z.string().uuid(),
  du: z.string().min(10),
  au: z.string().min(10),
})

function asInt(v: string | number | bigint): number {
  if (typeof v === "number") return v
  if (typeof v === "bigint") return Number(v)
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? 0 : n
}

function net(debit: number, credit: number): number {
  return debit - credit
}

function montantBanqueDepuisLignes(
  lignes: Array<{ compteSyscohada: string; debit: { toString(): string } | string; credit: { toString(): string } | string }>
): number {
  // On prend les lignes de banque (52x) pour avoir le montant réellement passé en banque.
  const lignesBanque = lignes.filter(l => l.compteSyscohada.startsWith("52"))
  if (lignesBanque.length === 0) return 0
  return lignesBanque.reduce((s, l) => {
    const d = asInt(typeof l.debit === "string" ? l.debit : l.debit.toString())
    const c = asInt(typeof l.credit === "string" ? l.credit : l.credit.toString())
    return s + Math.abs(d - c)
  }, 0)
}

export async function rapprochementRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const query = request.query as {
      exerciceId?: string
      du?: string
      au?: string
      statut?: "TOUS" | "NON_RAPPROCHE" | "A_VERIFIER" | "RAPPROCHE" | "IGNORE"
      search?: string
      compte?: string
    }

    if (!query.exerciceId) return reply.status(400).send({ error: "exerciceId requis" })

    const exercice = await prisma.exercice.findFirst({
      where: { id: query.exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { select: { clientId: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const du = query.du ? new Date(query.du) : undefined
    const au = query.au ? new Date(`${query.au}T23:59:59`) : undefined

    const filtreStatut =
      query.statut === "RAPPROCHE"
        ? { OR: [{ statut: "RAPPROCHE" as const }, { rapprochements: { some: {} } }] }
        : query.statut === "NON_RAPPROCHE"
          ? { AND: [{ statut: "NON_RAPPROCHE" as const }, { rapprochements: { none: {} } }] }
          : query.statut && query.statut !== "TOUS"
            ? { statut: query.statut }
            : {}

    const mouvements = await prisma.mouvementBancaire.findMany({
      where: {
        exerciceId: query.exerciceId,
        clientId: exercice.dossier.clientId,
        dateOperation: (du || au) ? { gte: du, lte: au } : undefined,
        OR: query.search
          ? [
              { libelle: { contains: query.search, mode: "insensitive" } },
              { reference: { contains: query.search, mode: "insensitive" } },
            ]
          : undefined,
        ...filtreStatut,
      },
      include: {
        rapprochements: {
          include: {
            ecriture: { include: { journal: { select: { code: true } } } },
          },
          orderBy: { rapprocheLe: "desc" },
        },
      },
      orderBy: [{ dateOperation: "desc" }, { createdAt: "desc" }],
      take: 500,
    })

    const ecritures = await prisma.ecriture.findMany({
      where: {
        exerciceId: query.exerciceId,
        statut: "VALIDEE",
        dateOperation: (du || au) ? { gte: du, lte: au } : undefined,
        AND: [
          { lignes: { some: { compteSyscohada: { startsWith: "52" } } } },
          ...(query.compte ? [{ lignes: { some: { compteSyscohada: { startsWith: query.compte } } } }] : []),
        ],
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: {
        journal: { select: { code: true } },
        lignes: true,
      },
      orderBy: { dateOperation: "desc" },
      take: 500,
    })

    const mouvementsOut = mouvements.map(m => ({
      id: m.id,
      dateOperation: m.dateOperation,
      libelle: m.libelle,
      reference: m.reference,
      debit: m.debit.toString(),
      credit: m.credit.toString(),
      solde: m.solde?.toString() ?? null,
      statut: m.rapprochements.length > 0 ? "RAPPROCHE" : m.statut,
      net: (BigInt(m.debit.toString()) - BigInt(m.credit.toString())).toString(),
      rapprochements: m.rapprochements.map(r => ({
        id: r.id,
        ecritureId: r.ecritureId,
        montantRapproche: r.montantRapproche.toString(),
        commentaire: r.commentaire,
        rapprocheLe: r.rapprocheLe,
        ecriture: {
          id: r.ecriture.id,
          dateOperation: r.ecriture.dateOperation,
          libelle: r.ecriture.libelle,
          pieceRef: r.ecriture.pieceRef,
          journal: r.ecriture.journal?.code ?? "—",
        },
      })),
    }))

    const ecrituresOut = ecritures.map(e => {
      const debit = e.lignes.reduce((s, l) => s + asInt(l.debit.toString()), 0)
      const credit = e.lignes.reduce((s, l) => s + asInt(l.credit.toString()), 0)
      const montantBanque = montantBanqueDepuisLignes(e.lignes)
      return {
        id: e.id,
        dateOperation: e.dateOperation,
        libelle: e.libelle,
        pieceRef: e.pieceRef,
        journal: e.journal?.code ?? "—",
        debit: String(debit),
        credit: String(credit),
        net: String(net(debit, credit)),
        montantBanque: String(montantBanque),
      }
    })

    const totalMouvements = mouvementsOut.length
    const rapproches = mouvementsOut.filter(m => m.statut === "RAPPROCHE" || m.rapprochements.length > 0).length
    const totalNetMouvements = mouvementsOut.reduce((s, m) => s + asInt(m.net), 0)
    const totalNetEcritures = ecrituresOut.reduce((s, e) => s + asInt(e.net), 0)
    const verrou = query.du && query.au
      ? await prisma.auditLog.findFirst({
          where: {
            cabinetId: user.cabinetId,
            action: "RAPPROCHEMENT_MENSUEL_VALIDE",
            entite: "rapprochement_bancaire_mensuel",
            entiteId: `${query.exerciceId}:${query.du}:${query.au}`,
          },
        })
      : null

    return reply.send({
      mouvements: mouvementsOut,
      ecritures: ecrituresOut,
      stats: {
        mouvements: totalMouvements,
        ecritures: ecrituresOut.length,
        tauxRapprochement: totalMouvements === 0 ? 0 : Math.round((rapproches * 100) / totalMouvements),
        ecartRestant: String(Math.abs(totalNetMouvements - totalNetEcritures)),
        verrouille: Boolean(verrou),
      },
    })
  })

  app.post("/valider-mois", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = ValiderMoisSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, du, au } = parsed.data

    const exercice = await prisma.exercice.findFirst({
      where: { id: exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { select: { clientId: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const periodKey = `${exerciceId}:${du}:${au}`
    const dejaValide = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "RAPPROCHEMENT_MENSUEL_VALIDE",
        entite: "rapprochement_bancaire_mensuel",
        entiteId: periodKey,
      },
    })
    if (dejaValide) return reply.send({ ok: true, dejaValide: true })

    const mouvements = await prisma.mouvementBancaire.findMany({
      where: {
        exerciceId,
        clientId: exercice.dossier.clientId,
        dateOperation: { gte: new Date(du), lte: new Date(`${au}T23:59:59`) },
      },
      include: { rapprochements: { select: { id: true } } },
    })

    const nonValides = mouvements.filter(m => !(m.statut === "RAPPROCHE" || m.statut === "IGNORE" || m.rapprochements.length > 0))
    if (nonValides.length > 0) {
      return reply.status(409).send({
        error: "Tous les mouvements doivent être rapprochés (ou ignorés) avant validation.",
        restants: nonValides.length,
      })
    }

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "RAPPROCHEMENT_MENSUEL_VALIDE",
        entite: "rapprochement_bancaire_mensuel",
        entiteId: periodKey,
        donneeApres: {
          exerciceId,
          du,
          au,
          mouvements: mouvements.length,
          valides: mouvements.length - nonValides.length,
          valideLe: new Date().toISOString(),
        },
      },
    })

    return reply.send({ ok: true, mouvements: mouvements.length })
  })

  app.post("/deverrouiller-mois", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string; role: string }
    if (user.role !== "EXPERT_COMPTABLE" && user.role !== "ADMIN_CABINET") {
      return reply.status(403).send({ error: "Action réservée à l'expert-comptable ou admin cabinet." })
    }

    const parsed = ValiderMoisSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const { exerciceId, du, au } = parsed.data

    const exercice = await prisma.exercice.findFirst({
      where: { id: exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      select: { id: true },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const periodKey = `${exerciceId}:${du}:${au}`
    const verrou = await prisma.auditLog.findFirst({
      where: {
        cabinetId: user.cabinetId,
        action: "RAPPROCHEMENT_MENSUEL_VALIDE",
        entite: "rapprochement_bancaire_mensuel",
        entiteId: periodKey,
      },
    })

    if (!verrou) return reply.send({ ok: true, dejaDeverrouille: true })

    await prisma.$transaction([
      prisma.auditLog.delete({ where: { id: verrou.id } }),
      prisma.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId: user.id,
          action: "RAPPROCHEMENT_MENSUEL_DEVERROUILLE",
          entite: "rapprochement_bancaire_mensuel",
          entiteId: periodKey,
          donneeApres: {
            exerciceId,
            du,
            au,
            deverrouilleLe: new Date().toISOString(),
          },
        },
      }),
    ])

    return reply.send({ ok: true })
  })

  app.post("/import-csv", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const parsed = ImportSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const data = parsed.data

    const exercice = await prisma.exercice.findFirst({
      where: { id: data.exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { select: { clientId: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })
    if (exercice.dossier.clientId !== data.clientId) {
      return reply.status(400).send({ error: "clientId/exerciceId incohérents" })
    }

    const created = await prisma.$transaction(
      data.rows.map(r =>
        prisma.mouvementBancaire.create({
          data: {
            clientId: data.clientId,
            exerciceId: data.exerciceId,
            dateOperation: new Date(r.dateOperation),
            libelle: r.libelle,
            reference: r.reference,
            debit: r.debit,
            credit: r.credit,
            solde: r.solde,
            source: "CSV",
          },
        })
      )
    )

    return reply.status(201).send({ imported: created.length })
  })

  app.post("/match", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = MatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const data = parsed.data

    const mouvement = await prisma.mouvementBancaire.findFirst({
      where: {
        id: data.mouvementId,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
    })
    if (!mouvement) return reply.status(404).send({ error: "Mouvement introuvable" })

    const ecriture = await prisma.ecriture.findFirst({
      where: {
        id: data.ecritureId,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: { lignes: true },
    })
    if (!ecriture) return reply.status(404).send({ error: "Écriture introuvable" })

    const montantParDefaut = Math.abs(
      ecriture.lignes.reduce((s, l) => s + asInt(l.debit.toString()) - asInt(l.credit.toString()), 0)
    )

    const res = await prisma.$transaction(async tx => {
      const rapprochement = await tx.rapprochementBancaire.create({
        data: {
          mouvementId: data.mouvementId,
          ecritureId: data.ecritureId,
          creeParId: user.id,
          montantRapproche: data.montant ?? montantParDefaut,
          commentaire: data.commentaire,
        },
      })
      await tx.mouvementBancaire.update({
        where: { id: data.mouvementId },
        data: { statut: "RAPPROCHE" },
      })
      return rapprochement
    })

    return reply.status(201).send({
      rapprochement: {
        ...res,
        montantRapproche: res.montantRapproche.toString(),
      },
    })
  })

  app.post("/unmatch/:mouvementId", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const params = request.params as { mouvementId: string }

    const mouvement = await prisma.mouvementBancaire.findFirst({
      where: {
        id: params.mouvementId,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
    })
    if (!mouvement) return reply.status(404).send({ error: "Mouvement introuvable" })

    await prisma.$transaction([
      prisma.rapprochementBancaire.deleteMany({ where: { mouvementId: params.mouvementId } }),
      prisma.mouvementBancaire.update({
        where: { id: params.mouvementId },
        data: { statut: "NON_RAPPROCHE" },
      }),
    ])

    return reply.send({ ok: true })
  })

  app.post("/auto-match", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const body = request.body as { exerciceId?: string; du?: string; au?: string }
    if (!body.exerciceId) return reply.status(400).send({ error: "exerciceId requis" })

    const exercice = await prisma.exercice.findFirst({
      where: { id: body.exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { select: { clientId: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const du = body.du ? new Date(body.du) : undefined
    const au = body.au ? new Date(`${body.au}T23:59:59`) : undefined

    const mouvements = await prisma.mouvementBancaire.findMany({
      where: {
        exerciceId: body.exerciceId,
        clientId: exercice.dossier.clientId,
        statut: "NON_RAPPROCHE",
        dateOperation: (du || au) ? { gte: du, lte: au } : undefined,
      },
      orderBy: { dateOperation: "asc" },
      take: 300,
    })

    const ecritures = await prisma.ecriture.findMany({
      where: {
        exerciceId: body.exerciceId,
        statut: "VALIDEE",
        dateOperation: (du || au) ? { gte: du, lte: au } : undefined,
        lignes: { some: { compteSyscohada: { startsWith: "52" } } },
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: { lignes: true },
      take: 800,
    })

    const candidats = ecritures.map(e => {
      const montant = montantBanqueDepuisLignes(e.lignes)
      return { id: e.id, date: e.dateOperation, montant, pieceRef: e.pieceRef ?? "", libelle: e.libelle ?? "" }
    })
    const ecrituresDejaUtilisees = new Set<string>()

    let matches = 0
    for (const m of mouvements) {
      const montantMouvement = Math.abs(asInt(m.debit.toString()) - asInt(m.credit.toString()))
      const mDate = new Date(m.dateOperation).getTime()
      const reference = (m.reference ?? "").trim().toLowerCase()
      const libelle = (m.libelle ?? "").trim().toLowerCase()

      // 1) Priorité à la référence (pièce) si présente
      let candidat = reference
        ? candidats.find(c =>
            !ecrituresDejaUtilisees.has(c.id) &&
            c.montant === montantMouvement &&
            c.pieceRef.trim().toLowerCase() === reference
          )
        : undefined

      // 2) Sinon montant + libellé proche + date proche (tolérance élargie)
      if (!candidat) {
        candidat = candidats.find(c => {
          if (ecrituresDejaUtilisees.has(c.id)) return false
          if (c.montant !== montantMouvement) return false
          const d = Math.abs(new Date(c.date).getTime() - mDate)
          const procheDate = d <= 45 * 24 * 60 * 60 * 1000
          const cLib = c.libelle.trim().toLowerCase()
          const procheLibelle = libelle.length >= 6 && (cLib.includes(libelle.slice(0, 10)) || libelle.includes(cLib.slice(0, 10)))
          return procheDate || procheLibelle
        })
      }

      // 3) Dernier fallback: montant seul
      if (!candidat) {
        candidat = candidats.find(c => !ecrituresDejaUtilisees.has(c.id) && c.montant === montantMouvement)
      }
      if (!candidat) continue

      await prisma.$transaction([
        prisma.rapprochementBancaire.create({
          data: {
            mouvementId: m.id,
            ecritureId: candidat.id,
            creeParId: user.id,
            montantRapproche: montantMouvement,
            commentaire: "Auto-rapprochement (montant + proximité de date)",
          },
        }),
        prisma.mouvementBancaire.update({
          where: { id: m.id },
          data: { statut: "RAPPROCHE" },
        }),
      ])
      ecrituresDejaUtilisees.add(candidat.id)
      matches += 1
    }

    return reply.send({ matches })
  })
}

