import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function exerciceRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user  = request.user as { cabinetId: string }
    const query = request.query as { dossierId?: string }

    const exercices = await prisma.exercice.findMany({
      where: {
        dossierId: query.dossierId,
        dossier: { client: { cabinetId: user.cabinetId } },
      },
      orderBy: { annee: "desc" },
    })
    return reply.send({ exercices })
  })
}