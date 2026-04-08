import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { JOURNAUX_DEF } from "../lib/comptabilite-init"

const prisma = new PrismaClient()

const CheckOuvertureSchema = z.object({
  dossierId: z.string().uuid(),
  exerciceSourceId: z.string().uuid(),
  anneeCible: z.coerce.number().int().min(2000).max(2100),
  dateDebut: z.string().min(10),
  dateFin: z.string().min(10),
})

const OpenOuvertureSchema = CheckOuvertureSchema.extend({
  options: z.object({
    reprendreSoldesGeneraux: z.boolean().default(true),
    reprendreSoldesAuxiliaires: z.boolean().default(true),
    creerANouveaux: z.boolean().default(true),
  }),
})

type Controle = {
  code: string
  controle: string
  statut: "BLOQUANT" | "ALERTE" | "OK"
  detail: string
}

function asInt(v: string | number | bigint): number {
  if (typeof v === "number") return v
  if (typeof v === "bigint") return Number(v)
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? 0 : n
}

function getPreviewReprise(rows: Array<{ compteSyscohada: string; debit: unknown; credit: unknown }>) {
  const map = new Map<string, number>()
  for (const r of rows) {
    const compte = String(r.compteSyscohada || "").trim()
    if (!compte) continue
    const d = asInt((r.debit as { toString(): string }).toString())
    const c = asInt((r.credit as { toString(): string }).toString())
    const net = d - c
    map.set(compte, (map.get(compte) ?? 0) + net)
  }
  const soldes = [...map.entries()]
    .map(([compte, net]) => ({ compte, net }))
    .filter(x => x.net !== 0)

  const totalDebit = soldes.reduce((s, x) => s + (x.net > 0 ? x.net : 0), 0)
  const totalCredit = soldes.reduce((s, x) => s + (x.net < 0 ? Math.abs(x.net) : 0), 0)
  return { soldes, totalDebit, totalCredit, ecart: Math.abs(totalDebit - totalCredit) }
}

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

  app.post("/ouverture/check", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const parsed = CheckOuvertureSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const body = parsed.data

    const dossier = await prisma.dossier.findFirst({
      where: { id: body.dossierId, client: { cabinetId: user.cabinetId } },
      include: { client: { select: { id: true, nomRaisonSociale: true } } },
    })
    if (!dossier) return reply.status(404).send({ error: "Dossier introuvable" })

    const source = await prisma.exercice.findFirst({
      where: { id: body.exerciceSourceId, dossierId: body.dossierId },
      include: { journaux: { select: { code: true } } },
    })
    if (!source) return reply.status(404).send({ error: "Exercice source introuvable" })

    const debut = new Date(body.dateDebut)
    const fin = new Date(body.dateFin)
    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || debut >= fin) {
      return reply.status(400).send({ error: "Dates invalides." })
    }

    const cibleExistante = await prisma.exercice.findFirst({
      where: { dossierId: body.dossierId, annee: body.anneeCible },
      select: { id: true },
    })

    const lignes = await prisma.ligneEcriture.findMany({
      where: { ecriture: { exerciceId: source.id, statut: "VALIDEE" } },
      select: { compteSyscohada: true, debit: true, credit: true },
      take: 20000,
    })
    const reprise = getPreviewReprise(lignes)

    const nbBrouillons = await prisma.ecriture.count({
      where: { exerciceId: source.id, statut: "BROUILLON" },
    })
    const nbMouvementsNonRapproches = await prisma.mouvementBancaire.count({
      where: {
        exerciceId: source.id,
        statut: { in: ["NON_RAPPROCHE", "A_VERIFIER"] },
      },
    })
    const hasDefaultJournaux = JOURNAUX_DEF.every(j => source.journaux.some(x => x.code === j.code))

    const controles: Controle[] = [
      {
        code: "CT-01",
        controle: "Exercice source clôturé",
        statut: source.cloture || source.statut === "CLOTURE" ? "OK" : "BLOQUANT",
        detail: source.cloture || source.statut === "CLOTURE" ? "Exercice source clôturé." : "Clôturez l'exercice source avant ouverture.",
      },
      {
        code: "CT-02",
        controle: "Exercice cible inexistant",
        statut: cibleExistante ? "BLOQUANT" : "OK",
        detail: cibleExistante ? "Un exercice existe déjà pour l'année cible." : "Aucun doublon détecté.",
      },
      {
        code: "CT-03",
        controle: "Journaux minimum présents",
        statut: hasDefaultJournaux ? "OK" : "ALERTE",
        detail: hasDefaultJournaux ? "Journaux de base disponibles." : "Certains journaux de base manquent sur la source.",
      },
      {
        code: "CT-04",
        controle: "Écritures en brouillon",
        statut: nbBrouillons > 0 ? "ALERTE" : "OK",
        detail: nbBrouillons > 0 ? `${nbBrouillons} écriture(s) en brouillon.` : "Aucun brouillon.",
      },
      {
        code: "CT-05",
        controle: "Rapprochements bancaires",
        statut: nbMouvementsNonRapproches > 0 ? "ALERTE" : "OK",
        detail: nbMouvementsNonRapproches > 0 ? `${nbMouvementsNonRapproches} mouvement(s) non rapproché(s).` : "Rapprochements à jour.",
      },
      {
        code: "CT-06",
        controle: "Balance reprise équilibrée",
        statut: reprise.ecart === 0 ? "OK" : "BLOQUANT",
        detail: reprise.ecart === 0 ? "Débit = Crédit." : `Écart de ${reprise.ecart.toLocaleString("fr-FR")} FCFA.`,
      },
    ]

    const stats = {
      bloquants: controles.filter(c => c.statut === "BLOQUANT").length,
      alertes: controles.filter(c => c.statut === "ALERTE").length,
      comptesAReprendre: reprise.soldes.length,
      totalDebit: reprise.totalDebit,
      totalCredit: reprise.totalCredit,
      ecart: reprise.ecart,
    }

    return reply.send({
      selection: {
        clientId: dossier.client.id,
        clientNom: dossier.client.nomRaisonSociale,
        dossierId: dossier.id,
        exerciceSourceId: source.id,
        exerciceSourceAnnee: source.annee,
        anneeCible: body.anneeCible,
        dateDebut: body.dateDebut,
        dateFin: body.dateFin,
      },
      controles,
      stats,
      conseils: [
        "Validez toutes les écritures de l'exercice source.",
        "Finalisez les rapprochements bancaires critiques.",
        "Confirmez que la balance est à zéro d'écart.",
      ],
    })
  })

  app.post("/ouverture", async (request, reply) => {
    const user = request.user as { id?: string; cabinetId: string }
    const parsed = OpenOuvertureSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const body = parsed.data
    if (!user.id) return reply.status(401).send({ error: "Utilisateur non authentifié." })
    const userId = user.id

    const dossier = await prisma.dossier.findFirst({
      where: { id: body.dossierId, client: { cabinetId: user.cabinetId } },
      include: { client: { select: { id: true } } },
    })
    if (!dossier) return reply.status(404).send({ error: "Dossier introuvable" })
    const source = await prisma.exercice.findFirst({
      where: { id: body.exerciceSourceId, dossierId: body.dossierId },
    })
    if (!source) return reply.status(404).send({ error: "Exercice source introuvable" })
    if (!(source.cloture || source.statut === "CLOTURE")) {
      return reply.status(409).send({ error: "Exercice source non clôturé." })
    }
    const exist = await prisma.exercice.findFirst({
      where: { dossierId: body.dossierId, annee: body.anneeCible },
      select: { id: true },
    })
    if (exist) return reply.status(409).send({ error: "Exercice cible déjà existant." })

    let ouverture: { cible: { id: string }; repriseMeta: { comptes: number; totalDebit: number; totalCredit: number; ecart: number } }
    try {
      ouverture = await prisma.$transaction(async tx => {
      const cible = await tx.exercice.create({
        data: {
          dossierId: body.dossierId,
          annee: body.anneeCible,
          dateDebut: new Date(body.dateDebut),
          dateFin: new Date(body.dateFin),
          statut: "OUVERT",
        },
      })

      await tx.journal.createMany({
        data: [
          ...JOURNAUX_DEF.map(j => ({
            exerciceId: cible.id,
            code: j.code,
            libelle: j.libelle,
            type: j.type,
          })),
          { exerciceId: cible.id, code: "AN", libelle: "Journal des à-nouveaux", type: "A_NOUVEAU" as const },
        ],
      })

      let repriseMeta = { comptes: 0, totalDebit: 0, totalCredit: 0, ecart: 0 }
      if (body.options.reprendreSoldesGeneraux && body.options.creerANouveaux) {
        const lignesSource = await tx.ligneEcriture.findMany({
          where: { ecriture: { exerciceId: source.id, statut: "VALIDEE" } },
          select: { compteSyscohada: true, debit: true, credit: true },
          take: 20000,
        })
        const reprise = getPreviewReprise(lignesSource)
        repriseMeta = {
          comptes: reprise.soldes.length,
          totalDebit: reprise.totalDebit,
          totalCredit: reprise.totalCredit,
          ecart: reprise.ecart,
        }
        if (reprise.ecart !== 0) {
          throw new Error("BALANCE_NOT_BALANCED")
        }
        if (reprise.soldes.length > 0) {
          const journalAn = await tx.journal.findFirst({
            where: { exerciceId: cible.id, code: "AN" },
            select: { id: true },
          })
          if (!journalAn) throw new Error("JOURNAL_AN_MISSING")
          const ecritureAn = await tx.ecriture.create({
            data: {
              exerciceId: cible.id,
              journalId: journalAn.id,
              saisiParId: userId,
              dateOperation: new Date(body.dateDebut),
              libelle: `A-nouveaux ${body.anneeCible}`,
              pieceRef: `AN-${body.anneeCible}`,
              statut: "VALIDEE",
              valideeLe: new Date(),
            },
          })
          await tx.ligneEcriture.createMany({
            data: reprise.soldes.map((s, idx) => ({
              ecritureId: ecritureAn.id,
              compteSyscohada: s.compte,
              libelleCompte: `Reprise solde ${s.compte}`,
              debit: s.net > 0 ? s.net : 0,
              credit: s.net < 0 ? Math.abs(s.net) : 0,
              ordre: idx + 1,
            })),
          })
        }
      }

      await tx.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId: userId,
          action: "EXERCICE_OUVERT",
          entite: "exercices",
          entiteId: cible.id,
          donneeApres: {
            dossierId: body.dossierId,
            exerciceSourceId: source.id,
            exerciceCibleId: cible.id,
            anneeCible: body.anneeCible,
            options: body.options,
            reprise: repriseMeta,
          },
        },
      })

        return { cible, repriseMeta }
      })
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message
      if (msg === "BALANCE_NOT_BALANCED") {
        return reply.status(409).send({ error: "Balance non équilibrée, reprise impossible." })
      }
      if (msg === "JOURNAL_AN_MISSING") {
        return reply.status(500).send({ error: "Journal AN introuvable pour l'exercice cible." })
      }
      throw e
    }

    return reply.status(201).send({
      ok: true,
      exercice: ouverture.cible,
      reprise: ouverture.repriseMeta,
    })
  })

  app.post("/:id/cloturer", async (request, reply) => {
    const user = request.user as { id?: string; cabinetId: string; role?: string }
    const id = (request.params as { id: string }).id
    if (!user.id) return reply.status(401).send({ error: "Utilisateur non authentifié." })
    if (user.role !== "EXPERT_COMPTABLE" && user.role !== "ADMIN_CABINET") {
      return reply.status(403).send({ error: "Action réservée à l'expert-comptable ou admin cabinet." })
    }

    const exercice = await prisma.exercice.findFirst({
      where: { id, dossier: { client: { cabinetId: user.cabinetId } } },
      select: { id: true, annee: true, statut: true, cloture: true },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })
    if (exercice.cloture || exercice.statut === "CLOTURE") return reply.send({ ok: true, dejaCloture: true })

    const brouillons = await prisma.ecriture.count({
      where: { exerciceId: id, statut: "BROUILLON" },
    })
    if (brouillons > 0) {
      return reply.status(409).send({
        error: "Impossible de clôturer l'exercice: des écritures brouillon subsistent.",
        brouillons,
      })
    }

    const updated = await prisma.$transaction(async tx => {
      const ex = await tx.exercice.update({
        where: { id },
        data: { statut: "CLOTURE", cloture: true, dateCloture: new Date() },
      })
      await tx.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId: user.id,
          action: "EXERCICE_CLOTURE",
          entite: "exercices",
          entiteId: id,
          donneeApres: {
            annee: ex.annee,
            dateCloture: ex.dateCloture?.toISOString() ?? new Date().toISOString(),
          },
        },
      })
      return ex
    })

    return reply.send({ ok: true, exercice: updated })
  })
}