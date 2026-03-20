import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"

const prisma = new PrismaClient()

const LigneInput = z.object({
  description: z.string().min(1).max(300),
  quantite: z.number().positive(),
  prixUnitaireHt: z.number().int().min(0),
})

const FactureCreateSchema = z.object({
  clientId: z.string().uuid(),
  dateEmission: z.string(),
  dateEcheance: z.string(),
  numero: z.string().min(1).max(60).optional(),
  notes: z.string().max(1000).optional(),
  tvaTaux: z.number().min(0).max(100).optional(),
  statut: z.enum(["BROUILLON", "EMISE"]).optional(),
  lignes: z.array(LigneInput).min(1),
})

const PaiementSchema = z.object({
  datePaiement: z.string(),
  montant: z.number().int().positive(),
  modePaiement: z.enum(["VIREMENT", "CHEQUE", "ESPECES", "MOBILE_MONEY"]),
  reference: z.string().max(120).optional(),
  commentaire: z.string().max(500).optional(),
})

function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}

export async function facturationRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const q = request.query as { clientId?: string; statut?: string; du?: string; au?: string; search?: string }

    const factures = await prisma.facture.findMany({
      where: {
        client: { cabinetId: user.cabinetId },
        clientId: q.clientId || undefined,
        statut: q.statut && q.statut !== "TOUS" ? (q.statut as any) : undefined,
        dateEmission: q.du || q.au ? { gte: q.du ? new Date(q.du) : undefined, lte: q.au ? new Date(`${q.au}T23:59:59`) : undefined } : undefined,
        OR: q.search
          ? [
              { numero: { contains: q.search, mode: "insensitive" } },
              { client: { nomRaisonSociale: { contains: q.search, mode: "insensitive" } } },
            ]
          : undefined,
      },
      include: {
        client: { select: { id: true, nomRaisonSociale: true } },
        lignes: true,
        paiements: true,
      },
      orderBy: { dateEmission: "desc" },
      take: 300,
    })

    const today = new Date()
    const data = factures.map(f => {
      const totalPaye = f.paiements.reduce((s, p) => s + Number(p.montant.toString()), 0)
      const totalTtc = Number(f.totalTtc.toString())
      const reste = Math.max(0, totalTtc - totalPaye)
      let statut = f.statut
      if (reste === 0) statut = "PAYEE"
      else if (totalPaye > 0) statut = "PARTIELLEMENT_PAYEE"
      else if (f.statut !== "BROUILLON" && new Date(f.dateEcheance) < today) statut = "EN_RETARD"

      return {
        id: f.id,
        numero: f.numero,
        dateEmission: f.dateEmission,
        dateEcheance: f.dateEcheance,
        statut,
        notes: f.notes,
        tvaTaux: f.tvaTaux.toString(),
        sousTotalHt: f.sousTotalHt.toString(),
        montantTva: f.montantTva.toString(),
        totalTtc: f.totalTtc.toString(),
        montantPaye: String(totalPaye),
        resteAPayer: String(reste),
        client: f.client,
        lignes: f.lignes.map(l => ({
          id: l.id,
          description: l.description,
          quantite: l.quantite.toString(),
          prixUnitaireHt: l.prixUnitaireHt.toString(),
          totalLigneHt: l.totalLigneHt.toString(),
        })),
      }
    })

    const now = new Date()
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1)
    const caMois = data.filter(f => new Date(f.dateEmission) >= debutMois).reduce((s, f) => s + Number(f.totalTtc), 0)
    const impayes = data.reduce((s, f) => s + Number(f.resteAPayer), 0)
    const totalTtc = data.reduce((s, f) => s + Number(f.totalTtc), 0)
    const totalPaye = data.reduce((s, f) => s + Number(f.montantPaye), 0)

    return reply.send({
      factures: data,
      kpi: {
        caMois: String(caMois),
        facturesEmises: data.filter(f => f.statut !== "BROUILLON").length,
        impayes: String(impayes),
        tauxEncaissement: totalTtc === 0 ? 0 : Math.round((totalPaye * 100) / totalTtc),
      },
    })
  })

  app.post("/", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = FactureCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const body = parsed.data

    const client = await prisma.client.findFirst({ where: { id: body.clientId, cabinetId: user.cabinetId } })
    if (!client) return reply.status(404).send({ error: "Client introuvable" })

    const prefix = `${new Date(body.dateEmission).getFullYear()}-`
    const count = await prisma.facture.count({ where: { client: { cabinetId: user.cabinetId } } })
    const numero = body.numero?.trim() || `${prefix}${String(count + 1).padStart(4, "0")}`
    const tvaTaux = body.tvaTaux ?? Number(client.tauxTVA.toString() || "18")
    const sousTotalHt = body.lignes.reduce((s, l) => s + Math.round(l.quantite * l.prixUnitaireHt), 0)
    const montantTva = Math.round((sousTotalHt * tvaTaux) / 100)
    const totalTtc = sousTotalHt + montantTva

    const facture = await prisma.facture.create({
      data: {
        clientId: body.clientId,
        creeParId: user.id,
        numero,
        dateEmission: new Date(body.dateEmission),
        dateEcheance: new Date(body.dateEcheance),
        statut: body.statut ?? "BROUILLON",
        tvaTaux,
        sousTotalHt,
        montantTva,
        totalTtc,
        montantPaye: 0,
        resteAPayer: totalTtc,
        notes: body.notes,
        lignes: {
          create: body.lignes.map((l, i) => ({
            description: l.description,
            quantite: l.quantite,
            prixUnitaireHt: l.prixUnitaireHt,
            totalLigneHt: Math.round(l.quantite * l.prixUnitaireHt),
            ordre: i,
          })),
        },
      },
      include: { client: { select: { id: true, nomRaisonSociale: true } }, lignes: true, paiements: true },
    })

    return reply.status(201).send({ facture })
  })

  app.post("/:id/paiements", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const { id } = request.params as { id: string }
    const parsed = PaiementSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const data = parsed.data

    const facture = await prisma.facture.findFirst({
      where: { id, client: { cabinetId: user.cabinetId } },
      include: { paiements: true },
    })
    if (!facture) return reply.status(404).send({ error: "Facture introuvable" })

    const totalPaye = facture.paiements.reduce((s, p) => s + Number(p.montant.toString()), 0)
    const prochainTotal = totalPaye + data.montant
    const totalTtc = Number(facture.totalTtc.toString())
    if (prochainTotal > totalTtc) {
      return reply.status(409).send({ error: "Montant de paiement supérieur au reste à payer." })
    }

    const paiement = await prisma.$transaction(async tx => {
      const p = await tx.paiementFacture.create({
        data: {
          factureId: id,
          creeParId: user.id,
          datePaiement: new Date(data.datePaiement),
          montant: data.montant,
          modePaiement: data.modePaiement,
          reference: data.reference,
          commentaire: data.commentaire,
        },
      })

      const reste = totalTtc - prochainTotal
      await tx.facture.update({
        where: { id },
        data: {
          montantPaye: prochainTotal,
          resteAPayer: reste,
          statut: reste === 0 ? "PAYEE" : "PARTIELLEMENT_PAYEE",
        },
      })
      return p
    })

    return reply.status(201).send({ paiement: { ...paiement, montant: paiement.montant.toString() } })
  })

  app.get("/:id/pdf", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const facture = await prisma.facture.findFirst({
      where: { id, client: { cabinetId: user.cabinetId } },
      include: { client: true, lignes: true, paiements: true },
    })
    if (!facture) return reply.status(404).send({ error: "Facture introuvable" })

    return reply.send({
      facture: {
        id: facture.id,
        numero: facture.numero,
        client: facture.client.nomRaisonSociale,
        dateEmission: ymd(facture.dateEmission),
        dateEcheance: ymd(facture.dateEcheance),
        sousTotalHt: facture.sousTotalHt.toString(),
        montantTva: facture.montantTva.toString(),
        totalTtc: facture.totalTtc.toString(),
        montantPaye: facture.montantPaye.toString(),
        resteAPayer: facture.resteAPayer.toString(),
        statut: facture.statut,
        notes: facture.notes,
        lignes: facture.lignes.map(l => ({
          description: l.description,
          quantite: l.quantite.toString(),
          prixUnitaireHt: l.prixUnitaireHt.toString(),
          totalLigneHt: l.totalLigneHt.toString(),
        })),
      },
    })
  })
}

