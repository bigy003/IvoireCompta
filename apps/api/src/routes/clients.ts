import { FastifyInstance } from "fastify"
import { Prisma, PrismaClient } from "@prisma/client"
import {
  creerMissionComptablePourClient,
  garantirComptabiliteClient,
} from "../lib/comptabilite-init.js"
import { genererEcheancesAnnuelles } from "@ivoirecompta/fiscal-engine"

const prisma = new PrismaClient()

function normaliserRegime(
  r?: string
): "REEL_NORMAL" | "PME" | "BIC_SIMPLIFIE" | "BNC" {
  if (r === "BIC_SIMPLIFIE" || r === "BNC") return r
  // Les régimes non mappés explicitement basculent en réel pour calendrier MVP
  if (r === "REEL_NORMAL" || r === "REEL_SIMPLIFIE" || r === "ZONE_FRANCHE_ZICI") return "REEL_NORMAL"
  return "REEL_NORMAL"
}

async function creerEcheancesClientSiAbsentes(
  tx: Prisma.TransactionClient,
  client: { id: string; assujettitTVA: boolean; regimeImposition: string | null },
  annee: number
) {
  const echeances = genererEcheancesAnnuelles(annee, {
    assujettitTVA: Boolean(client.assujettitTVA),
    regimeFiscal: normaliserRegime(client.regimeImposition ?? undefined),
    aDesEmployes: false,
    dateClotureExo: new Date(annee, 11, 31),
  })
  const now = new Date()
  for (const e of echeances) {
    const exist = await tx.echeanceFiscale.findFirst({
      where: {
        clientId: client.id,
        typeDeclaration: e.type as any,
        periodeLabel: e.periodeLabel,
      },
      select: { id: true },
    })
    if (exist) continue
    await tx.echeanceFiscale.create({
      data: {
        clientId: client.id,
        typeDeclaration: e.type as any,
        periodeLabel: e.periodeLabel,
        dateEcheance: e.dateEcheance,
        statut: e.dateEcheance < now ? "EN_RETARD" : "A_FAIRE",
      },
    })
  }
}

export async function clientRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const tous = (request.query as { tous?: string }).tous === "1"
    const clients = await prisma.client.findMany({
      where: tous ? { cabinetId: user.cabinetId } : { cabinetId: user.cabinetId, actif: true },
      orderBy: { nomRaisonSociale: "asc" },
    })
    return reply.send({ clients })
  })

  app.post("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const body = request.body as {
      ncc: string
      nomRaisonSociale: string
      formeJuridique?: string
      regimeImposition?: string
      assujettitTVA?: boolean
      email?: string
      telephone?: string
    }
    const { ncc, nomRaisonSociale, ...rest } = body
    const annee = new Date().getFullYear()

    const client = await prisma.$transaction(async tx => {
      const c = await tx.client.create({
        data: {
          cabinetId: user.cabinetId,
          ncc,
          nomRaisonSociale,
          ...rest,
        },
      })
      await creerMissionComptablePourClient(tx, c.id, annee)
      await creerEcheancesClientSiAbsentes(
        tx,
        {
          id: c.id,
          assujettitTVA: c.assujettitTVA,
          regimeImposition: c.regimeImposition as unknown as string,
        },
        annee
      )
      return c
    })

    return reply.status(201).send({
      client,
      comptabilite: { exerciceAnnee: annee, message: "Dossier, exercice et journaux créés." },
    })
  })

  /** Clients créés avant l’auto-init : prépare dossier + exercice année en cours + journaux */
  app.post("/:id/initialiser-comptabilite", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const client = await prisma.client.findFirst({
      where: { id, cabinetId: user.cabinetId },
    })
    if (!client) return reply.status(404).send({ error: "Client introuvable" })
    const r = await garantirComptabiliteClient(prisma, client.id)
    await prisma.$transaction(async tx => {
      await creerEcheancesClientSiAbsentes(
        tx,
        {
          id: client.id,
          assujettitTVA: client.assujettitTVA,
          regimeImposition: client.regimeImposition as unknown as string,
        },
        r.annee
      )
    })
    return reply.send({
      ok: true,
      dossierId: r.dossierId,
      exerciceId: r.exerciceId,
      annee: r.annee,
      modifie: r.cree,
    })
  })

  app.get("/:id", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const client = await prisma.client.findFirst({
      where: { id, cabinetId: user.cabinetId },
      include: { dossiers: true },
    })
    if (!client) return reply.status(404).send({ error: "Client introuvable" })
    return reply.send({ client })
  })

  app.patch("/:id", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const body = request.body as Partial<{
      ncc: string
      nomRaisonSociale: string
      formeJuridique: string
      regimeImposition: string
      assujettitTVA: boolean
      email: string
      telephone: string
      actif: boolean
    }>

    /* Inclut les clients inactifs (sinon impossible de les réactiver) */
    const existing = await prisma.client.findFirst({
      where: { id, cabinetId: user.cabinetId },
    })
    if (!existing) return reply.status(404).send({ error: "Client introuvable" })

    const data: Record<string, unknown> = {}
    if (body.nomRaisonSociale !== undefined) data.nomRaisonSociale = String(body.nomRaisonSociale).trim()
    if (body.ncc !== undefined) data.ncc = String(body.ncc).trim()
    if (body.formeJuridique !== undefined) data.formeJuridique = body.formeJuridique
    if (body.regimeImposition !== undefined) data.regimeImposition = body.regimeImposition
    if (body.assujettitTVA !== undefined) data.assujettitTVA = body.assujettitTVA
    if (body.email !== undefined)
      data.email = String(body.email).trim() === "" ? null : String(body.email).trim()
    if (body.telephone !== undefined)
      data.telephone = String(body.telephone).trim() === "" ? null : String(body.telephone).trim()
    if (body.actif !== undefined) data.actif = Boolean(body.actif)

    if (Object.keys(data).length === 0) {
      return reply.send({ client: existing })
    }

    try {
      const client = await prisma.client.update({
        where: { id },
        data: data as Parameters<typeof prisma.client.update>[0]["data"],
      })
      return reply.send({ client })
    } catch (e: unknown) {
      const err = e as { code?: string }
      if (err.code === "P2002") {
        return reply.status(409).send({ error: "Ce NCC est déjà utilisé pour un autre client." })
      }
      throw e
    }
  })

  /** Désactive le client (soft delete) — conserve dossiers et historique comptable */
  app.delete("/:id", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const client = await prisma.client.findFirst({
      where: { id, cabinetId: user.cabinetId, actif: true },
    })
    if (!client) return reply.status(404).send({ error: "Client introuvable" })
    await prisma.client.update({ where: { id }, data: { actif: false } })
    return reply.send({ ok: true })
  })
}
