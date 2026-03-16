/**
 * IvoireCompta — API Backend
 * Fastify + TypeScript + Prisma
 */

import Fastify from "fastify"
import cors    from "@fastify/cors"
import jwt     from "@fastify/jwt"
import rateLimit from "@fastify/rate-limit"

import { authRoutes }        from "./routes/auth"
import { ecritureRoutes }    from "./routes/ecritures"
import { declarationRoutes } from "./routes/declarations"
import { clientRoutes }      from "./routes/clients"
import { dashboardRoutes }   from "./routes/dashboard"
import { paieRoutes }        from "./routes/paie"
import { exerciceRoutes }    from "./routes/exercices"
import { journauxRoutes }    from "./routes/journaux"

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "warn" : "info",
  },
})

await app.register(cors, {
  origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
  credentials: true,
})

await app.register(jwt, {
  secret: process.env.JWT_SECRET!,
  sign:   { expiresIn: "8h" },
})

await app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
})

app.addHook("onRequest", async (request, reply) => {
  const publicRoutes = ["/auth/login", "/auth/refresh", "/health"]
  if (publicRoutes.some(r => request.url.startsWith(r))) return
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ error: "Non authentifie" })
  }
})

await app.register(authRoutes,        { prefix: "/auth" })
await app.register(clientRoutes,      { prefix: "/clients" })
await app.register(ecritureRoutes,    { prefix: "/ecritures" })
await app.register(declarationRoutes, { prefix: "/declarations" })
await app.register(dashboardRoutes,   { prefix: "/dashboard" })
await app.register(paieRoutes,        { prefix: "/paie" })
await app.register(exerciceRoutes,    { prefix: "/exercices" })
await app.register(journauxRoutes,    { prefix: "/journaux" })

app.get("/health", async () => ({ status: "ok", version: "0.1.0", app: "IvoireCompta API" }))

try {
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" })
  console.log("IvoireCompta API demarree sur le port", process.env.PORT ?? 4000)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}