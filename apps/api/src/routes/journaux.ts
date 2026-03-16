import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function journauxRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user  = request.user as { cabinetId: string }
    const query = request.query as { exerciceId?: string }

    const journaux = await prisma.journal.findMany({
      where: {
        exerciceId: query.exerciceId,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      orderBy: { code: "asc" },
    })
    return reply.send({ journaux })
  })
}