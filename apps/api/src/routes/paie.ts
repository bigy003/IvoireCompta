/**
 * IvoireCompta — Route /paie
 * Génération bulletins de paie CNPS + ITS barème CI
 */

import { FastifyInstance } from "fastify"
import { z } from "zod"
import { PrismaClient } from "@prisma/client"
import { calculerBulletinPaie, calculerRecapCNPS } from "@ivoirecompta/fiscal-engine"

const prisma = new PrismaClient()

const BulletinSchema = z.object({
  employeId:           z.string().uuid(),
  mois:                z.number().int().min(1).max(12),
  annee:               z.number().int().min(2020),
  primes:              z.record(z.number()).optional(),
  tauxAccidentTravail: z.number().min(0.02).max(0.05).optional(),
  tauxFdfp:            z.number().min(0.004).max(0.012).optional(),
})

export async function paieRoutes(app: FastifyInstance) {

  /**
   * POST /paie/bulletins/generer
   * Calcule et sauvegarde un bulletin de paie
   */
  app.post("/bulletins/generer", async (request, reply) => {
    const user   = request.user as { cabinetId: string }
    const parsed = BulletinSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })

    const data = parsed.data

    const employe = await prisma.employe.findFirst({
      where: { id: data.employeId, client: { cabinetId: user.cabinetId }, actif: true },
    })
    if (!employe) return reply.status(404).send({ error: "Employé introuvable" })

    // Vérifier qu'il n'existe pas déjà
    const existant = await prisma.bulletinPaie.findUnique({
      where: { employeId_mois_annee: { employeId: data.employeId, mois: data.mois, annee: data.annee } },
    })
    if (existant) {
      return reply.status(409).send({ error: `Bulletin ${data.mois}/${data.annee} déjà généré pour cet employé` })
    }

    // Calcul des primes
    const primesObj  = (employe.primes as Record<string, number>) ?? {}
    const primesSupp = data.primes ?? {}
    const totalPrimes = Object.values({ ...primesObj, ...primesSupp }).reduce((s, v) => s + v, 0)
    const salaireBrut = BigInt(Number(employe.salaireBase) + totalPrimes)

    const bulletin = calculerBulletinPaie(
      salaireBrut,
      0, // TODO: récupérer nombre enfants depuis employe.avantages
      data.tauxAccidentTravail,
      data.tauxFdfp,
    )

    // Persister
    const bulletinSauve = await prisma.bulletinPaie.create({
      data: {
        employeId:             data.employeId,
        mois:                  data.mois,
        annee:                 data.annee,
        salaireBrut:           salaireBrut,
        cotisationCnpsAt:      bulletin.cnpsAccidentTravail,
        cotisationCnpsPf:      bulletin.cnpsPrestationsFam,
        cotisationCnpsRe:      bulletin.cnpsRetraiteEmployeur,
        cotisationFdfp:        bulletin.cnpsFdfp,
        cotisationCnpsSal:     bulletin.cnpsRetraiteSalarie,
        impotIts:              bulletin.itsTotal,
        netAPayer:             bulletin.netAPayer,
        salaireNetFiscal:      bulletin.salaireNetFiscal,
        abattementEnfants:     bulletin.abattementEnfants,
        nombreEnfants:         0,
        genere:                true,
      },
    })

    return reply.status(201).send({
      bulletin: bulletinSauve,
      detail:   bulletin,
    })
  })

  /**
   * POST /paie/recap-cnps
   * Récapitulatif CNPS mensuel pour un client (base de déclaration)
   */
  app.post("/recap-cnps", async (request, reply) => {
    const user  = request.user as { cabinetId: string }
    const { clientId, mois, annee } = request.body as { clientId: string; mois: number; annee: number }

    const bulletins = await prisma.bulletinPaie.findMany({
      where: {
        mois,
        annee,
        employe: { clientId, client: { cabinetId: user.cabinetId } },
      },
      include: { employe: { select: { nom: true, prenom: true, matricule: true } } },
    })

    if (bulletins.length === 0) {
      return reply.status(404).send({ error: "Aucun bulletin trouvé pour ce mois" })
    }

    const bulletinsCalc = bulletins.map(b => ({
      salaireBrut:           BigInt(b.salaireBrut.toString()),
      nombreEnfants:         b.nombreEnfants,
      tauxAccidentTravail:   0.02,
      tauxFdfp:              0.004,
      cnpsRetraiteEmployeur: BigInt(b.cotisationCnpsRe.toString()),
      cnpsPrestationsFam:    BigInt(b.cotisationCnpsPf.toString()),
      cnpsAccidentTravail:   BigInt(b.cotisationCnpsAt.toString()),
      cnpsFdfp:              BigInt(b.cotisationFdfp.toString()),
      totalChargesEmployeur: BigInt(b.cotisationCnpsRe.toString()) + BigInt(b.cotisationCnpsPf.toString()) + BigInt(b.cotisationCnpsAt.toString()) + BigInt(b.cotisationFdfp.toString()),
      cnpsRetraiteSalarie:   BigInt(b.cotisationCnpsSal.toString()),
      salaireNetFiscal:      BigInt(b.salaireNetFiscal.toString()),
      abattementEnfants:     BigInt(b.abattementEnfants.toString()),
      baseIts:               0n,
      itsParTrancheDetail:   [],
      itsTotal:              BigInt(b.impotIts.toString()),
      netAPayer:             BigInt(b.netAPayer.toString()),
      coutTotalEmployeur:    0n,
    }))

    const recap = calculerRecapCNPS(bulletinsCalc)

    return reply.send({
      mois,
      annee,
      nbSalaries:            recap.nbSalaries,
      totalBrut:             recap.totalBrut.toString(),
      totalCnpsEmployeur:    recap.totalCnpsEmployeur.toString(),
      totalCnpsSalarie:      recap.totalCnpsSalarie.toString(),
      totalIts:              recap.totalIts.toString(),
      totalNetAPayer:        recap.totalNetAPayer.toString(),
      bulletins,
    })
  })
}
