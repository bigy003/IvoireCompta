import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"

const prisma = new PrismaClient()

const CreateSchema = z.object({
  clientId: z.string().uuid(),
  sujet: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(["ANOMALIE_COMPTABLE", "PIECE_MANQUANTE", "DECLARATION", "BANQUE", "IMMOBILISATION", "AUTRE"]),
  priorite: z.enum(["HAUTE", "MOYENNE", "BASSE"]),
  statut: z.enum(["OUVERT", "EN_COURS", "BLOQUE", "RESOLU"]).optional(),
  responsableUserId: z.string().uuid().optional().nullable(),
  echeance: z.string().datetime().optional().nullable(),
})

const PatchSchema = z.object({
  sujet: z.string().min(3).max(200).optional(),
  description: z.string().max(2000).optional(),
  type: z.enum(["ANOMALIE_COMPTABLE", "PIECE_MANQUANTE", "DECLARATION", "BANQUE", "IMMOBILISATION", "AUTRE"]).optional(),
  priorite: z.enum(["HAUTE", "MOYENNE", "BASSE"]).optional(),
  statut: z.enum(["OUVERT", "EN_COURS", "BLOQUE", "RESOLU"]).optional(),
  responsableUserId: z.string().uuid().optional().nullable(),
  echeance: z.string().datetime().optional().nullable(),
})

const UploadPieceSchema = z.object({
  nomOriginal: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  base64: z.string().min(4),
})

function storageDir() {
  return join(process.cwd(), "uploads", "points-suspens")
}

async function maybeSeed(cabinetId: string, userId: string) {
  const count = await prisma.pointSuspens.count({ where: { cabinetId } })
  if (count > 0) return
  const [clients, responsables] = await Promise.all([
    prisma.client.findMany({
      where: { cabinetId, actif: true },
      select: { id: true },
      take: 4,
    }),
    prisma.utilisateur.findMany({
      where: { cabinetId, actif: true, role: { in: ["EXPERT_COMPTABLE", "COLLABORATEUR"] } },
      select: { id: true },
      take: 2,
    }),
  ])
  if (clients.length === 0) return
  const now = new Date()
  await prisma.pointSuspens.createMany({
    data: clients.map((c, i) => ({
      cabinetId,
      clientId: c.id,
      sujet: i % 2 === 0 ? "DSF — informations à compléter" : "Écart de balance à analyser",
      description: "",
      type: i % 2 === 0 ? "DECLARATION" : "ANOMALIE_COMPTABLE",
      priorite: i % 3 === 0 ? "HAUTE" : "MOYENNE",
      statut: i % 3 === 0 ? "OUVERT" : "EN_COURS",
      responsableUserId: responsables[i % Math.max(1, responsables.length)]?.id ?? null,
      creeParId: userId,
      echeance: new Date(now.getTime() + (i + 1) * 86400000),
    })),
  })
}

function pointToRow(p: {
  id: string
  sujet: string
  description: string | null
  type: string
  priorite: string
  statut: string
  echeance: Date | null
  updatedAt: Date
  client: { id: string; nomRaisonSociale: string; ncc: string }
  responsableUser: { id: string; prenom: string; nom: string } | null
}) {
  return {
    id: p.id,
    clientId: p.client.id,
    clientNom: p.client.nomRaisonSociale,
    clientNcc: p.client.ncc,
    sujet: p.sujet,
    description: p.description ?? "",
    type: p.type,
    priorite: p.priorite,
    statut: p.statut,
    responsableUserId: p.responsableUser?.id ?? null,
    responsable: p.responsableUser ? `${p.responsableUser.prenom} ${p.responsableUser.nom}` : "Non assigné",
    echeance: p.echeance ? p.echeance.toISOString() : null,
    updatedAt: p.updatedAt.toISOString(),
  }
}

export async function pointsSuspensRoutes(app: FastifyInstance) {
  app.get("/pieces/:pieceId/view", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { pieceId } = request.params as { pieceId: string }
    const piece = await prisma.pointSuspensPiece.findUnique({
      where: { id: pieceId },
      include: {
        point: { select: { cabinetId: true } },
      },
    })
    if (!piece || piece.point.cabinetId !== user.cabinetId) {
      return reply.status(404).send({ error: "Pièce introuvable." })
    }

    const base = resolve(storageDir())
    const fullPath = resolve(base, piece.cheminStockage)
    if (!fullPath.startsWith(base)) {
      return reply.status(400).send({ error: "Chemin de pièce invalide." })
    }

    let data: Buffer
    try {
      data = await readFile(fullPath)
    } catch {
      return reply.status(404).send({ error: "Fichier introuvable sur le serveur." })
    }

    return reply
      .header("Content-Type", piece.mimeType || "application/octet-stream")
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(piece.nomOriginal)}"`)
      .send(data)
  })

  app.get("/pieces/:pieceId/download", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { pieceId } = request.params as { pieceId: string }
    const piece = await prisma.pointSuspensPiece.findUnique({
      where: { id: pieceId },
      include: {
        point: { select: { cabinetId: true } },
      },
    })
    if (!piece || piece.point.cabinetId !== user.cabinetId) {
      return reply.status(404).send({ error: "Pièce introuvable." })
    }

    const base = resolve(storageDir())
    const fullPath = resolve(base, piece.cheminStockage)
    if (!fullPath.startsWith(base)) {
      return reply.status(400).send({ error: "Chemin de pièce invalide." })
    }

    let data: Buffer
    try {
      data = await readFile(fullPath)
    } catch {
      return reply.status(404).send({ error: "Fichier introuvable sur le serveur." })
    }

    return reply
      .header("Content-Type", piece.mimeType || "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(piece.nomOriginal)}"`)
      .send(data)
  })

  app.delete("/pieces/:pieceId", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { pieceId } = request.params as { pieceId: string }
    const piece = await prisma.pointSuspensPiece.findUnique({
      where: { id: pieceId },
      include: {
        point: { select: { cabinetId: true } },
      },
    })
    if (!piece || piece.point.cabinetId !== user.cabinetId) {
      return reply.status(404).send({ error: "Pièce introuvable." })
    }

    const base = resolve(storageDir())
    const fullPath = resolve(base, piece.cheminStockage)
    if (fullPath.startsWith(base)) {
      try {
        await unlink(fullPath)
      } catch {
        // toléré: si déjà supprimé du disque, on nettoie quand même la base
      }
    }

    await prisma.pointSuspensPiece.delete({ where: { id: pieceId } })
    return reply.send({ message: "Pièce supprimée." })
  })

  app.get("/responsables", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const users = await prisma.utilisateur.findMany({
      where: {
        cabinetId: user.cabinetId,
        actif: true,
        role: { in: ["EXPERT_COMPTABLE", "COLLABORATEUR"] },
      },
      select: { id: true, prenom: true, nom: true, role: true },
      orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    })
    return reply.send({
      responsables: users.map(u => ({ id: u.id, nom: `${u.prenom} ${u.nom}`, role: u.role })),
    })
  })

  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string; id: string }
    await maybeSeed(user.cabinetId, user.id)

    const q = request.query as {
      clientId?: string
      type?: string
      priorite?: string
      statut?: string
      responsableUserId?: string
      q?: string
      page?: string
      perPage?: string
    }
    const page = Math.max(1, Number(q.page ?? 1))
    const perPage = Math.min(100, Math.max(5, Number(q.perPage ?? 10)))
    const search = (q.q ?? "").trim()

    const where = {
      cabinetId: user.cabinetId,
      clientId: q.clientId || undefined,
      type: (q.type as any) || undefined,
      priorite: (q.priorite as any) || undefined,
      statut: (q.statut as any) || undefined,
      responsableUserId: q.responsableUserId || undefined,
      OR: search
        ? [
            { sujet: { contains: search, mode: "insensitive" as const } },
            { client: { nomRaisonSociale: { contains: search, mode: "insensitive" as const } } },
            { client: { ncc: { contains: search, mode: "insensitive" as const } } },
          ]
        : undefined,
    }

    const [total, points, now, allForKpi] = await Promise.all([
      prisma.pointSuspens.count({ where }),
      prisma.pointSuspens.findMany({
        where,
        include: {
          client: { select: { id: true, nomRaisonSociale: true, ncc: true } },
          responsableUser: { select: { id: true, prenom: true, nom: true } },
        },
        orderBy: [{ updatedAt: "desc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      Promise.resolve(new Date()),
      prisma.pointSuspens.findMany({
        where: { cabinetId: user.cabinetId },
        include: {
          client: { select: { id: true, nomRaisonSociale: true, ncc: true } },
          responsableUser: { select: { id: true, prenom: true, nom: true } },
        },
      }),
    ])

    const rows = points.map(pointToRow)
    const kpis = {
      ouverts: allForKpi.filter(x => x.statut === "OUVERT").length,
      enCours: allForKpi.filter(x => x.statut === "EN_COURS").length,
      bloques: allForKpi.filter(x => x.statut === "BLOQUE").length,
      resolus30j: allForKpi.filter(x => x.resolvedAt && (now.getTime() - x.resolvedAt.getTime()) <= 30 * 86400000).length,
    }
    const actionsRecommandees = allForKpi
      .filter(x => x.statut !== "RESOLU")
      .sort((a, b) => {
        const score = (x: (typeof allForKpi)[number]) =>
          (x.priorite === "HAUTE" ? 30 : x.priorite === "MOYENNE" ? 20 : 10) +
          (x.statut === "BLOQUE" ? 20 : x.statut === "OUVERT" ? 10 : 5)
        return score(b) - score(a)
      })
      .slice(0, 5)
      .map(x => ({
        id: x.id,
        clientNom: x.client.nomRaisonSociale,
        sujet: x.sujet,
        priorite: x.priorite,
        echeance: x.echeance ? x.echeance.toISOString() : null,
      }))
    const slaRetard = allForKpi.filter(
      x => x.statut !== "RESOLU" && (now.getTime() - x.updatedAt.getTime()) > 7 * 86400000
    ).length

    return reply.send({ kpis, rows, total, page, perPage, actionsRecommandees, slaRetard })
  })

  app.post("/", async (request, reply) => {
    const user = request.user as { cabinetId: string; id: string }
    const parsed = CreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: "Données invalides" })
    const d = parsed.data
    const c = await prisma.client.findFirst({
      where: { id: d.clientId, cabinetId: user.cabinetId, actif: true },
      select: { id: true },
    })
    if (!c) return reply.status(404).send({ error: "Client introuvable" })

    if (d.responsableUserId) {
      const ru = await prisma.utilisateur.findFirst({
        where: {
          id: d.responsableUserId,
          cabinetId: user.cabinetId,
          actif: true,
          role: { in: ["EXPERT_COMPTABLE", "COLLABORATEUR"] },
        },
        select: { id: true },
      })
      if (!ru) return reply.status(400).send({ error: "Responsable invalide." })
    }

    const point = await prisma.pointSuspens.create({
      data: {
        cabinetId: user.cabinetId,
        clientId: d.clientId,
        sujet: d.sujet.trim(),
        description: d.description?.trim() || null,
        type: d.type,
        priorite: d.priorite,
        statut: d.statut ?? "OUVERT",
        responsableUserId: d.responsableUserId ?? null,
        creeParId: user.id,
        echeance: d.echeance ? new Date(d.echeance) : null,
        resolvedAt: d.statut === "RESOLU" ? new Date() : null,
      },
      include: {
        client: { select: { id: true, nomRaisonSociale: true, ncc: true } },
        responsableUser: { select: { id: true, prenom: true, nom: true } },
      },
    })
    return reply.status(201).send({ point: pointToRow(point) })
  })

  app.patch("/:id", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const parsed = PatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: "Données invalides" })
    const existing = await prisma.pointSuspens.findFirst({ where: { id, cabinetId: user.cabinetId } })
    if (!existing) return reply.status(404).send({ error: "Point introuvable" })

    const d = parsed.data
    if (d.responsableUserId) {
      const ru = await prisma.utilisateur.findFirst({
        where: {
          id: d.responsableUserId,
          cabinetId: user.cabinetId,
          actif: true,
          role: { in: ["EXPERT_COMPTABLE", "COLLABORATEUR"] },
        },
        select: { id: true },
      })
      if (!ru) return reply.status(400).send({ error: "Responsable invalide." })
    }

    const next = await prisma.pointSuspens.update({
      where: { id },
      data: {
        sujet: d.sujet?.trim(),
        description: d.description?.trim(),
        type: d.type,
        priorite: d.priorite,
        statut: d.statut,
        responsableUserId: d.responsableUserId,
        echeance: d.echeance ? new Date(d.echeance) : d.echeance === null ? null : undefined,
        resolvedAt:
          d.statut === "RESOLU" && !existing.resolvedAt
            ? new Date()
            : d.statut && d.statut !== "RESOLU"
              ? null
              : undefined,
      },
      include: {
        client: { select: { id: true, nomRaisonSociale: true, ncc: true } },
        responsableUser: { select: { id: true, prenom: true, nom: true } },
      },
    })
    return reply.send({ point: pointToRow(next) })
  })

  app.post("/:id/resoudre", async (request, reply) => {
    const user = request.user as { cabinetId: string; role: string; id: string }
    if (user.role !== "EXPERT_COMPTABLE" && user.role !== "COLLABORATEUR") {
      return reply.status(403).send({ error: "Seuls les experts et collaborateurs peuvent clôturer un point." })
    }
    const { id } = request.params as { id: string }
    const existing = await prisma.pointSuspens.findFirst({ where: { id, cabinetId: user.cabinetId } })
    if (!existing) return reply.status(404).send({ error: "Point introuvable" })
    const point = await prisma.pointSuspens.update({
      where: { id },
      data: {
        statut: "RESOLU",
        resolvedAt: new Date(),
        resoluParId: user.id,
      },
      include: {
        client: { select: { id: true, nomRaisonSociale: true, ncc: true } },
        responsableUser: { select: { id: true, prenom: true, nom: true } },
      },
    })
    return reply.send({ point: pointToRow(point), message: "Point marqué comme résolu." })
  })

  app.post("/:id/pieces", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const parsed = UploadPieceSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: "Payload pièce invalide." })
    const p = parsed.data

    const point = await prisma.pointSuspens.findFirst({ where: { id, cabinetId: user.cabinetId } })
    if (!point) return reply.status(404).send({ error: "Point introuvable" })

    const buffer = Buffer.from(p.base64, "base64")
    if (buffer.length === 0) return reply.status(400).send({ error: "Fichier vide." })
    if (buffer.length > 8 * 1024 * 1024) return reply.status(400).send({ error: "Fichier trop volumineux (> 8MB)." })

    const safeName = p.nomOriginal.replace(/[^\w.\-]/g, "_")
    const filename = `${Date.now()}_${safeName}`
    const dir = storageDir()
    await mkdir(dir, { recursive: true })
    const fullPath = join(dir, filename)
    await writeFile(fullPath, buffer)

    const piece = await prisma.pointSuspensPiece.create({
      data: {
        pointId: id,
        nomOriginal: p.nomOriginal,
        mimeType: p.mimeType,
        tailleOctets: buffer.length,
        cheminStockage: filename,
      },
    })
    return reply.status(201).send({ piece })
  })

  app.get("/:id/pieces", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const point = await prisma.pointSuspens.findFirst({ where: { id, cabinetId: user.cabinetId } })
    if (!point) return reply.status(404).send({ error: "Point introuvable" })
    const pieces = await prisma.pointSuspensPiece.findMany({
      where: { pointId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, nomOriginal: true, mimeType: true, tailleOctets: true, createdAt: true },
    })
    return reply.send({ pieces })
  })
}

