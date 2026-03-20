import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"

const mockPrisma = vi.hoisted(() => ({
  declarationFiscale: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  echeanceFiscale: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}))

vi.mock("@ivoirecompta/fiscal-engine", () => ({
  calculerTVAMensuelle: vi.fn(),
  calculerISetIMF: vi.fn(),
  genererT07: vi.fn(),
  genererT08: vi.fn(),
  genererT09: vi.fn(),
  controlerCoherenceDSF: vi.fn(),
}))

describe("workflow DSF API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function buildApp() {
    const app = Fastify()
    app.addHook("onRequest", async request => {
      ;(request as unknown as { user: { id: string; cabinetId: string } }).user = {
        id: "u1",
        cabinetId: "cab1",
      }
    })
    const { declarationRoutes } = await import("./declarations")
    await app.register(declarationRoutes, { prefix: "/declarations" })
    return app
  }

  it("POST /declarations/:id/prete passe la DSF en PRETE", async () => {
    mockPrisma.declarationFiscale.findFirst.mockResolvedValue({
      id: "dsf-ex1",
      tableauxDsf: [{ id: "t07" }],
      statut: "EN_PREPARATION",
    })
    mockPrisma.declarationFiscale.update.mockResolvedValue({
      id: "dsf-ex1",
      statut: "PRETE",
    })

    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/declarations/dsf-ex1/prete",
    })
    expect(res.statusCode).toBe(200)
    expect(mockPrisma.declarationFiscale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dsf-ex1" },
        data: expect.objectContaining({ statut: "PRETE" }),
      })
    )
    await app.close()
  })

  it("POST /declarations/:id/deposer met DEPOSEE et marque l'échéance FAITE", async () => {
    mockPrisma.declarationFiscale.findFirst.mockResolvedValue({
      id: "dsf-ex1",
      statut: "VISEE",
      periodeAnnee: 2026,
      exercice: { dossier: { client: { id: "c1" } } },
    })
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
      cb(mockPrisma as unknown as typeof mockPrisma)
    )
    mockPrisma.declarationFiscale.update.mockResolvedValue({
      id: "dsf-ex1",
      statut: "DEPOSEE",
    })
    mockPrisma.echeanceFiscale.updateMany.mockResolvedValue({ count: 1 })

    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/declarations/dsf-ex1/deposer",
      payload: { referenceEimpots: "EIMP-2026-001" },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.declarationFiscale.update).toHaveBeenCalled()
    expect(mockPrisma.echeanceFiscale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { statut: "FAITE" },
        where: expect.objectContaining({
          clientId: "c1",
          typeDeclaration: "DSF_ANNUELLE",
          periodeLabel: "DSF-2026",
        }),
      })
    )
    await app.close()
  })
})

