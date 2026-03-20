import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import jwt from "@fastify/jwt"

const mockPrisma = vi.hoisted(() => ({
  utilisateur: {
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  cabinet: {
    findUnique: vi.fn(),
  },
}))

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}))

vi.mock("otplib", () => ({
  authenticator: {
    verify: vi.fn(),
    generateSecret: vi.fn(),
    keyuri: vi.fn(),
  },
}))

describe("auth visa verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NODE_ENV = "development"
  })

  async function buildApp() {
    const app = Fastify()
    await app.register(jwt, { secret: "test-secret" })
    app.addHook("onRequest", async request => {
      ;(request as unknown as { user: { id: string; role: string; cabinetId: string } }).user = {
        id: "u1",
        role: "EXPERT_COMPTABLE",
        cabinetId: "cab1",
      }
    })
    const { authRoutes } = await import("./auth")
    await app.register(authRoutes, { prefix: "/auth" })
    return app
  }

  it("POST /auth/visa/verifier accepte le code bypass dev 000000", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/auth/visa/verifier",
      payload: { totpCode: "000000" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { visaToken?: string; bypass?: boolean }
    expect(typeof body.visaToken).toBe("string")
    expect(body.bypass).toBe(true)
    await app.close()
  })
})

