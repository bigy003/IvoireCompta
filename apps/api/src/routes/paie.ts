/**
 * IvoireCompta — Route /paie
 * Génération bulletins de paie CNPS + ITS barème CI
 */

import { FastifyInstance } from "fastify"
import { z } from "zod"
import { PrismaClient } from "@prisma/client"
import { calculerBulletinPaie, calculerRecapCNPS, TAUX_CNPS } from "@ivoirecompta/fiscal-engine"

const prisma = new PrismaClient()

const BulletinSchema = z.object({
  employeId:           z.string().uuid(),
  mois:                z.number().int().min(1).max(12),
  annee:               z.number().int().min(2020),
  primes:              z.record(z.number()).optional(),
  tauxAccidentTravail: z.number().min(0.02).max(0.05).optional(),
  tauxFdfp:            z.number().min(0.004).max(0.012).optional(),
})

const EmployeCreateSchema = z.object({
  clientId:        z.string().uuid(),
  matricule:       z.string().min(1).max(48),
  nom:             z.string().min(1).max(120),
  prenom:          z.string().min(1).max(120),
  dateEmbauche:    z.string().min(8),
  categorieCnps:   z.string().min(1).max(80).optional(),
  codeCategorie:   z.string().min(1).max(16).optional(),
  salaireBase:     z.number().int().min(0),
  primes:          z.record(z.number()).optional(),
  poste:           z.string().max(120).optional().nullable(),
  dateNaissance:   z.string().optional().nullable(),
  actif:           z.boolean().optional(),
})

const EmployePatchSchema = EmployeCreateSchema.omit({ clientId: true, matricule: true }).partial().extend({
  matricule: z.string().min(1).max(48).optional(),
})

function totalPrimes(primes: unknown): number {
  const o = (primes as Record<string, number>) ?? {}
  return Object.values(o).reduce((s, v) => s + (Number(v) || 0), 0)
}

function brutTheorique(salaireBase: { toString(): string }, primes: unknown): bigint {
  return BigInt(Number(salaireBase)) + BigInt(totalPrimes(primes))
}

async function clientDuCabinet(clientId: string, cabinetId: string) {
  return prisma.client.findFirst({
    where: { id: clientId, cabinetId },
    select: { id: true },
  })
}

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
      where: { id: data.employeId, client: { cabinetId: user.cabinetId } },
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

    const tAt = data.tauxAccidentTravail ?? TAUX_CNPS.ACCIDENT_TRAVAIL_MIN
    const tFd = data.tauxFdfp ?? TAUX_CNPS.FDFP_MIN
    const bulletin = calculerBulletinPaie(salaireBrut, 0, tAt, tFd)

    const dec = (n: bigint) => n.toString()
    let bulletinSauve
    try {
      bulletinSauve = await prisma.bulletinPaie.create({
        data: {
          employeId:         data.employeId,
          mois:              data.mois,
          annee:             data.annee,
          salaireBrut:       dec(salaireBrut),
          cotisationCnpsAt:  dec(bulletin.cnpsAccidentTravail),
          cotisationCnpsPf:  dec(bulletin.cnpsPrestationsFam),
          cotisationCnpsRe:  dec(bulletin.cnpsRetraiteEmployeur),
          cotisationFdfp:    dec(bulletin.cnpsFdfp),
          cotisationCnpsSal: dec(bulletin.cnpsRetraiteSalarie),
          impotIts:          dec(bulletin.itsTotal),
          netAPayer:         dec(bulletin.netAPayer),
          salaireNetFiscal:  dec(bulletin.salaireNetFiscal),
          abattementEnfants: dec(bulletin.abattementEnfants),
          nombreEnfants:     0,
          genere:            true,
        },
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "P2002") {
        return reply.status(409).send({
          error: `Bulletin ${data.mois}/${data.annee} déjà généré pour cet employé`,
        })
      }
      throw e
    }

    const detailJson = JSON.parse(
      JSON.stringify(bulletin, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    )
    return reply.status(201).send({
      bulletin: bulletinSauve,
      detail:   detailJson,
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

  /**
   * GET /paie/employes?clientId=
   */
  app.get("/employes", async (request, reply) => {
    const user     = request.user as { cabinetId: string }
    const clientId = (request.query as { clientId?: string }).clientId
    if (!clientId) return reply.status(400).send({ error: "clientId requis" })
    const ok = await clientDuCabinet(clientId, user.cabinetId)
    if (!ok) return reply.status(404).send({ error: "Client introuvable" })

    const employes = await prisma.employe.findMany({
      where: { clientId },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    })
    return reply.send({
      employes: employes.map(e => ({
        ...e,
        salaireBase: e.salaireBase.toString(),
        primes:      e.primes,
        brutTheorique: brutTheorique(e.salaireBase, e.primes).toString(),
      })),
    })
  })

  /**
   * POST /paie/employes
   */
  app.post("/employes", async (request, reply) => {
    const user   = request.user as { cabinetId: string }
    const parsed = EmployeCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const d = parsed.data
    const ok = await clientDuCabinet(d.clientId, user.cabinetId)
    if (!ok) return reply.status(404).send({ error: "Client introuvable" })

    const emb = new Date(d.dateEmbauche)
    if (Number.isNaN(emb.getTime())) return reply.status(400).send({ error: "dateEmbauche invalide" })

    try {
      const employe = await prisma.employe.create({
        data: {
          clientId:       d.clientId,
          matricule:      d.matricule.trim(),
          nom:            d.nom.trim(),
          prenom:         d.prenom.trim(),
          dateEmbauche:   emb,
          categorieCnps:  d.categorieCnps ?? "Salarié",
          codeCategorie:  d.codeCategorie ?? "C1",
          salaireBase:    d.salaireBase,
          primes:         d.primes ?? {},
          poste:          d.poste?.trim() || null,
          dateNaissance:  d.dateNaissance ? new Date(d.dateNaissance) : null,
          actif:          d.actif ?? true,
        },
      })
      return reply.status(201).send({
        employe: {
          ...employe,
          salaireBase: employe.salaireBase.toString(),
          brutTheorique: brutTheorique(employe.salaireBase, employe.primes).toString(),
        },
      })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === "P2002") return reply.status(409).send({ error: "Matricule déjà utilisé pour ce client" })
      throw e
    }
  })

  /**
   * PATCH /paie/employes/:id
   */
  app.patch("/employes/:id", async (request, reply) => {
    const user   = request.user as { cabinetId: string }
    const id     = (request.params as { id: string }).id
    const parsed = EmployePatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const d = parsed.data

    const exist = await prisma.employe.findFirst({
      where: { id, client: { cabinetId: user.cabinetId } },
    })
    if (!exist) return reply.status(404).send({ error: "Employé introuvable" })

    const data: Record<string, unknown> = {}
    if (d.matricule !== undefined) data.matricule = d.matricule.trim()
    if (d.nom !== undefined) data.nom = d.nom.trim()
    if (d.prenom !== undefined) data.prenom = d.prenom.trim()
    if (d.dateEmbauche !== undefined) {
      const t = new Date(d.dateEmbauche)
      if (Number.isNaN(t.getTime())) return reply.status(400).send({ error: "dateEmbauche invalide" })
      data.dateEmbauche = t
    }
    if (d.categorieCnps !== undefined) data.categorieCnps = d.categorieCnps
    if (d.codeCategorie !== undefined) data.codeCategorie = d.codeCategorie
    if (d.salaireBase !== undefined) data.salaireBase = d.salaireBase
    if (d.primes !== undefined) data.primes = d.primes
    if (d.poste !== undefined) data.poste = d.poste?.trim() || null
    if (d.dateNaissance !== undefined)
      data.dateNaissance = d.dateNaissance ? new Date(d.dateNaissance) : null
    if (d.actif !== undefined) data.actif = d.actif

    try {
      const employe = await prisma.employe.update({ where: { id }, data: data as object })
      return reply.send({
        employe: {
          ...employe,
          salaireBase: employe.salaireBase.toString(),
          brutTheorique: brutTheorique(employe.salaireBase, employe.primes).toString(),
        },
      })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === "P2002") return reply.status(409).send({ error: "Matricule déjà utilisé pour ce client" })
      throw e
    }
  })

  /**
   * GET /paie/synthese?clientId=&mois=&annee=
   */
  app.get("/synthese", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const q    = request.query as { clientId?: string; mois?: string; annee?: string }
    if (!q.clientId) return reply.status(400).send({ error: "clientId requis" })
    const mois  = Math.min(12, Math.max(1, parseInt(q.mois ?? `${new Date().getMonth() + 1}`, 10) || 1))
    const annee = parseInt(q.annee ?? `${new Date().getFullYear()}`, 10) || new Date().getFullYear()

    const ok = await clientDuCabinet(q.clientId, user.cabinetId)
    if (!ok) return reply.status(404).send({ error: "Client introuvable" })

    const [tous, actifs, idsRows] = await Promise.all([
      prisma.employe.count({ where: { clientId: q.clientId } }),
      prisma.employe.count({ where: { clientId: q.clientId, actif: true } }),
      prisma.employe.findMany({
        where: { clientId: q.clientId },
        select: { id: true },
      }),
    ])
    const idsEmployes = idsRows.map(r => r.id)
    const bulletins =
      idsEmployes.length === 0
        ? []
        : await prisma.bulletinPaie.findMany({
            where: { mois, annee, employeId: { in: idsEmployes } },
            select: { salaireBrut: true, employeId: true },
          })

    const idsBulletin = new Set(bulletins.map(b => b.employeId))
    const actifsList = await prisma.employe.findMany({
      where: { clientId: q.clientId, actif: true },
      select: { id: true, salaireBase: true, primes: true },
    })
    const actifsSansBulletin = actifsList.filter(e => !idsBulletin.has(e.id))

    let masseBrute = 0n
    let sourceBrut: "bulletins" | "projecte" = "projecte"
    if (bulletins.length > 0) {
      sourceBrut = "bulletins"
      for (const b of bulletins) masseBrute += BigInt(b.salaireBrut.toString())
    } else {
      for (const e of actifsList) masseBrute += brutTheorique(e.salaireBase, e.primes)
    }

    const grouped =
      idsEmployes.length === 0
        ? []
        : await prisma.bulletinPaie.groupBy({
            by:    ["mois", "annee"],
            where: { employeId: { in: idsEmployes } },
          })
    const periodes = grouped
      .sort((a, b) => b.annee - a.annee || b.mois - a.mois)
      .slice(0, 8)
      .map(p => ({ mois: p.mois, annee: p.annee }))

    const declarationsEnAttente = actifsSansBulletin.length

    return reply.send({
      nbEmployesTotal:      tous,
      nbEmployesActifs:     actifs,
      periode:              { mois, annee },
      masseSalarialeBrute:  masseBrute.toString(),
      sourceBrut,
      bulletinsGeneres:     bulletins.length,
      employesSansBulletin: actifsSansBulletin.length,
      declarationsEnAttente,
      recapCnpsDisponible:  bulletins.length > 0 && actifsSansBulletin.length === 0,
      periodesRecentes:     periodes,
    })
  })

  /**
   * GET /paie/periode?clientId=&mois=&annee=
   * Détail bulletins + salariés sans bulletin pour l’onglet Déclarations
   */
  app.get("/periode", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const q    = request.query as { clientId?: string; mois?: string; annee?: string }
    if (!q.clientId) return reply.status(400).send({ error: "clientId requis" })
    const mois  = Math.min(12, Math.max(1, parseInt(q.mois ?? "1", 10) || 1))
    const annee = parseInt(q.annee ?? `${new Date().getFullYear()}`, 10) || new Date().getFullYear()

    const ok = await clientDuCabinet(q.clientId, user.cabinetId)
    if (!ok) return reply.status(404).send({ error: "Client introuvable" })

    const idsTous = await prisma.employe.findMany({
      where: { clientId: q.clientId },
      select: { id: true },
    })
    const idList = idsTous.map(r => r.id)
    const [bulletins, employesActifs] = await Promise.all([
      idList.length === 0
        ? Promise.resolve([])
        : prisma.bulletinPaie.findMany({
            where: { mois, annee, employeId: { in: idList } },
            include: {
              employe: { select: { id: true, nom: true, prenom: true, matricule: true, poste: true } },
            },
            orderBy: { id: "asc" },
          }),
      prisma.employe.findMany({
        where: { clientId: q.clientId, actif: true },
        select: { id: true, nom: true, prenom: true, matricule: true, poste: true },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      }),
    ])
    const ids = new Set(bulletins.map(b => b.employeId))
    const sansBulletin = employesActifs.filter(e => !ids.has(e.id))

    return reply.send({
      bulletins: bulletins.map(b => ({
        id:           b.id,
        employeId:    b.employeId,
        matricule:    b.employe.matricule,
        nomComplet:   `${b.employe.prenom} ${b.employe.nom}`,
        poste:        b.employe.poste,
        salaireBrut:  b.salaireBrut.toString(),
        netAPayer:    b.netAPayer.toString(),
        impotIts:     b.impotIts.toString(),
      })),
      sansBulletin,
    })
  })
}
