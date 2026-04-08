import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"

const prisma = new PrismaClient()

const UpdateJournalSchema = z.object({
  actif: z.boolean().optional(),
  rules: z
    .object({
      pieceObligatoire: z.boolean().optional(),
      libelleObligatoire: z.boolean().optional(),
      interdireMontantNul: z.boolean().optional(),
      autoriserBrouillon: z.boolean().optional(),
      comptesAutorisesUniquement: z.boolean().optional(),
      comptesAutorises: z.array(z.string()).optional(),
    })
    .optional(),
})
const LockSchema = z.object({
  periodLabel: z.string().min(4).max(30),
})

type JournalConfig = {
  actif: boolean
  rules: {
    pieceObligatoire: boolean
    libelleObligatoire: boolean
    interdireMontantNul: boolean
    autoriserBrouillon: boolean
    comptesAutorisesUniquement: boolean
    comptesAutorises: string[]
  }
}

const DEFAULT_CONFIG: JournalConfig = {
  actif: true,
  rules: {
    pieceObligatoire: true,
    libelleObligatoire: true,
    interdireMontantNul: true,
    autoriserBrouillon: true,
    comptesAutorisesUniquement: false,
    comptesAutorises: [],
  },
}

export async function journauxRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user  = request.user as { cabinetId: string }
    const query = request.query as { exerciceId?: string }
    if (!query.exerciceId) return reply.status(400).send({ error: "exerciceId requis" })

    const journaux = await prisma.journal.findMany({
      where: {
        exerciceId: query.exerciceId,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      orderBy: { code: "asc" },
    })
    const ids = journaux.map(j => j.id)
    const configLogs = await prisma.auditLog.findMany({
      where: {
        cabinetId: user.cabinetId,
        action: "JOURNAL_CONFIG_MAJ",
        entite: "journaux",
        entiteId: { in: ids.length ? ids : ["__none__"] },
      },
      orderBy: { createdAt: "desc" },
      select: { entiteId: true, donneeApres: true },
    })
    const mapConfig = new Map<string, JournalConfig>()
    for (const l of configLogs) {
      if (!mapConfig.has(l.entiteId)) {
        mapConfig.set(l.entiteId, {
          ...DEFAULT_CONFIG,
          ...(l.donneeApres as Partial<JournalConfig>),
          rules: {
            ...DEFAULT_CONFIG.rules,
            ...((l.donneeApres as Partial<JournalConfig>)?.rules ?? {}),
          },
        })
      }
    }

    const rows = journaux.map(j => {
      const cfg = mapConfig.get(j.id) ?? DEFAULT_CONFIG
      const anomalies = Number(
        (cfg.rules.comptesAutorisesUniquement && cfg.rules.comptesAutorises.length === 0) ||
        (!cfg.rules.libelleObligatoire && !cfg.rules.pieceObligatoire)
      )
      return {
        id: j.id,
        code: j.code,
        libelle: j.libelle,
        type: j.type,
        actif: cfg.actif,
        verrouille: j.cloture,
        periodLabel: j.periodeClot ?? null,
        rules: cfg.rules,
        anomalies,
      }
    })
    const actifs = rows.filter(r => r.actif).length
    const verrouilles = rows.filter(r => r.verrouille).length
    const reglesConformes = rows.filter(r => r.rules.pieceObligatoire && r.rules.libelleObligatoire && r.rules.interdireMontantNul).length
    const anomalies = rows.reduce((s, r) => s + r.anomalies, 0)

    return reply.send({
      journaux: rows,
      stats: {
        actifs,
        total: rows.length,
        verrouilles,
        reglesObligatoiresPct: rows.length === 0 ? 0 : Math.round((reglesConformes * 100) / rows.length),
        anomalies,
      },
    })
  })

  app.patch("/:id/config", async (request, reply) => {
    const user = request.user as { id?: string; cabinetId: string }
    const id = (request.params as { id: string }).id
    if (!user.id) return reply.status(401).send({ error: "Utilisateur non authentifié" })
    const parsed = UpdateJournalSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })

    const journal = await prisma.journal.findFirst({
      where: { id, exercice: { dossier: { client: { cabinetId: user.cabinetId } } } },
      select: { id: true },
    })
    if (!journal) return reply.status(404).send({ error: "Journal introuvable" })

    const payload = parsed.data
    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "JOURNAL_CONFIG_MAJ",
        entite: "journaux",
        entiteId: id,
        donneeApres: payload,
      },
    })
    return reply.send({ ok: true })
  })

  app.post("/:id/verrouiller", async (request, reply) => {
    const user = request.user as { id?: string; cabinetId: string }
    const id = (request.params as { id: string }).id
    if (!user.id) return reply.status(401).send({ error: "Utilisateur non authentifié" })
    const parsed = LockSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })

    const journal = await prisma.journal.findFirst({
      where: { id, exercice: { dossier: { client: { cabinetId: user.cabinetId } } } },
      select: { id: true },
    })
    if (!journal) return reply.status(404).send({ error: "Journal introuvable" })

    const updated = await prisma.journal.update({
      where: { id },
      data: { cloture: true, periodeClot: parsed.data.periodLabel },
    })
    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "JOURNAL_VERROUILLE",
        entite: "journaux",
        entiteId: id,
        donneeApres: { periodLabel: parsed.data.periodLabel },
      },
    })
    return reply.send({ ok: true, journal: updated })
  })

  app.post("/:id/deverrouiller", async (request, reply) => {
    const user = request.user as { id?: string; cabinetId: string }
    const id = (request.params as { id: string }).id
    if (!user.id) return reply.status(401).send({ error: "Utilisateur non authentifié" })

    const journal = await prisma.journal.findFirst({
      where: { id, exercice: { dossier: { client: { cabinetId: user.cabinetId } } } },
      select: { id: true },
    })
    if (!journal) return reply.status(404).send({ error: "Journal introuvable" })

    const updated = await prisma.journal.update({
      where: { id },
      data: { cloture: false, periodeClot: null },
    })
    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId: user.id,
        action: "JOURNAL_DEVERROUILLE",
        entite: "journaux",
        entiteId: id,
      },
    })
    return reply.send({ ok: true, journal: updated })
  })

  app.get("/:id/historique", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const id = (request.params as { id: string }).id
    const journal = await prisma.journal.findFirst({
      where: { id, exercice: { dossier: { client: { cabinetId: user.cabinetId } } } },
      select: { id: true },
    })
    if (!journal) return reply.status(404).send({ error: "Journal introuvable" })
    const historiqueRaw = await prisma.auditLog.findMany({
      where: {
        cabinetId: user.cabinetId,
        entite: "journaux",
        entiteId: id,
        action: { in: ["JOURNAL_CONFIG_MAJ", "JOURNAL_VERROUILLE", "JOURNAL_DEVERROUILLE"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, createdAt: true, userId: true, donneeApres: true },
    })
    const userIds = [...new Set(historiqueRaw.map(h => h.userId).filter(Boolean) as string[])]
    const users = userIds.length
      ? await prisma.utilisateur.findMany({
          where: { id: { in: userIds }, cabinetId: user.cabinetId },
          select: { id: true, prenom: true, nom: true, email: true },
        })
      : []
    const mapUser = new Map(users.map(u => [u.id, u]))
    const historique = historiqueRaw.map(h => {
      const u = h.userId ? mapUser.get(h.userId) : null
      return {
        ...h,
        user: u
          ? {
              id: u.id,
              nomComplet: `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() || u.email,
              email: u.email,
            }
          : null,
      }
    })
    return reply.send({ historique })
  })
}