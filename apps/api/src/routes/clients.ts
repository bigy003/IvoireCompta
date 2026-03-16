import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function clientRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const clients = await prisma.client.findMany({
      where: { cabinetId: user.cabinetId, actif: true },
      orderBy: { nomRaisonSociale: "asc" },
    })
    return reply.send({ clients })
  })

  app.post("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const data = request.body as {
      ncc: string
      nomRaisonSociale: string
      formeJuridique?: string
      regimeImposition?: string
      assujettitTVA?: boolean
      email?: string
      telephone?: string
    }
    const client = await prisma.client.create({
      data: { ...data, cabinetId: user.cabinetId },
    })
    return reply.status(201).send({ client })
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
}
