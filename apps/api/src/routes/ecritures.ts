/**
 * IvoireCompta — Route /ecritures
 * Saisie comptable avec validation des règles SYSCOHADA
 */

import { FastifyInstance } from "fastify"
import { z } from "zod"
import { PrismaClient } from "@prisma/client"
import { getTypeOperationTVA } from "@ivoirecompta/fiscal-engine"

const prisma = new PrismaClient()

// ── Schémas de validation ──────────────────────────────────────

const LigneSchema = z.object({
  compteSyscohada: z.string().min(3).max(10).regex(/^\d+$/, "Le compte doit être numérique"),
  libelleCompte:   z.string().min(1).max(200),
  debit:           z.number().int().min(0),
  credit:          z.number().int().min(0),
})

const EcritureSchema = z.object({
  exerciceId:    z.string().uuid(),
  journalCode:   z.string().min(2).max(5),
  dateOperation: z.string().datetime(),
  libelle:       z.string().min(1).max(500),
  pieceRef:      z.string().max(100).optional(),
  lignes:        z.array(LigneSchema).min(2, "Minimum 2 lignes par écriture"),
})

// ── Validateurs métier ────────────────────────────────────────

interface ValidationResult {
  valide:         boolean
  erreurs:        string[]   // Bloquants
  avertissements: string[]   // Non-bloquants
}

function validerEcriture(data: z.infer<typeof EcritureSchema>): ValidationResult {
  const erreurs:        string[] = []
  const avertissements: string[] = []

  // RÈGLE 1 : Équilibre débit/crédit — BLOQUANT
  const totalDebit  = data.lignes.reduce((s, l) => s + l.debit, 0)
  const totalCredit = data.lignes.reduce((s, l) => s + l.credit, 0)
  if (totalDebit !== totalCredit) {
    erreurs.push(
      `Écriture déséquilibrée : Débit ${totalDebit.toLocaleString()} ≠ Crédit ${totalCredit.toLocaleString()} FCFA`
    )
  }

  // RÈGLE 2 : Aucune ligne avec débit ET crédit à la fois — BLOQUANT
  for (const ligne of data.lignes) {
    if (ligne.debit > 0 && ligne.credit > 0) {
      erreurs.push(`Compte ${ligne.compteSyscohada} : une ligne ne peut pas avoir débit ET crédit simultanément`)
    }
    if (ligne.debit === 0 && ligne.credit === 0) {
      erreurs.push(`Compte ${ligne.compteSyscohada} : ligne avec débit et crédit à zéro inutile`)
    }
  }

  // RÈGLE 3 : Vérification TVA automatique
  const lignesTVACollectee  = data.lignes.filter(l => getTypeOperationTVA(l.compteSyscohada) === "COLLECTEE")
  const lignesTVADeductible = data.lignes.filter(l => getTypeOperationTVA(l.compteSyscohada) === "DEDUCTIBLE")

  if (lignesTVACollectee.length > 0) {
    // Vérifier que le montant TVA correspond à 18% de la base HT
    // (vérification simplifiée — à affiner avec le compte HT correspondant)
    const tvaTotale = lignesTVACollectee.reduce((s, l) => s + l.debit + l.credit, 0)
    if (tvaTotale > 0) {
      const baseHtEstimee = tvaTotale / 0.18
      avertissements.push(
        `TVA collectée : ${tvaTotale.toLocaleString()} FCFA → base HT estimée : ${Math.round(baseHtEstimee).toLocaleString()} FCFA`
      )
    }
  }

  // RÈGLE 4 : Compte de virement (58x) — alerte si présent en fin de période
  const comptesVirement = data.lignes.filter(l => l.compteSyscohada.startsWith("58"))
  if (comptesVirement.length > 0) {
    avertissements.push("Compte de virement (58x) détecté — à solder avant clôture d'exercice")
  }

  return {
    valide: erreurs.length === 0,
    erreurs,
    avertissements,
  }
}

// ── Routes ────────────────────────────────────────────────────

export async function ecritureRoutes(app: FastifyInstance) {
  /**
   * POST /ecritures
   * Crée et valide une nouvelle écriture
   */
  app.post("/", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string; role: string }

    // Stagiaires ne peuvent pas valider directement
    if (user.role === "STAGIAIRE") {
      return reply.status(403).send({ error: "Les stagiaires doivent soumettre pour validation" })
    }

    const parsed = EcritureSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ erreurs: parsed.error.flatten() })
    }

    const data = parsed.data

    // Vérification des règles métier
    const validation = validerEcriture(data)
    if (!validation.valide) {
      return reply.status(422).send({
        message: "L'écriture ne respecte pas les règles SYSCOHADA",
        erreurs:  validation.erreurs,
      })
    }

    // Vérifier que l'exercice appartient au cabinet de l'utilisateur
    const exercice = await prisma.exercice.findFirst({
      where: {
        id: data.exerciceId,
        dossier: { client: { cabinetId: user.cabinetId } },
      },
      include: { journaux: true },
    })

    if (!exercice) {
      return reply.status(404).send({ error: "Exercice introuvable" })
    }
    if (exercice.cloture) {
      return reply.status(409).send({ error: "L'exercice est clôturé — rouverture nécessaire" })
    }

    const journal = exercice.journaux.find(j => j.code === data.journalCode)
    if (!journal) {
      return reply.status(404).send({ error: `Journal ${data.journalCode} introuvable dans cet exercice` })
    }
    if (journal.cloture) {
      return reply.status(409).send({ error: `Journal ${data.journalCode} clôturé pour cette période` })
    }

    // Création en base avec les lignes (transaction atomique)
    const ecriture = await prisma.$transaction(async tx => {
      const ecr = await tx.ecriture.create({
        data: {
          exerciceId:    data.exerciceId,
          journalId:     journal.id,
          saisiParId:    user.id,
          dateOperation: new Date(data.dateOperation),
          libelle:       data.libelle,
          pieceRef:      data.pieceRef,
          statut:        "VALIDEE",
          valideeLe:     new Date(),
          lignes: {
            create: data.lignes.map((l, idx) => ({
              compteSyscohada: l.compteSyscohada,
              libelleCompte:   l.libelleCompte,
              debit:           l.debit,
              credit:          l.credit,
              ordre:           idx,
            })),
          },
        },
        include: { lignes: true, journal: true },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          cabinetId:  user.cabinetId,
          userId:     user.id,
          action:     "ECRITURE_CREEE",
          entite:     "ecritures",
          entiteId:   ecr.id,
          donneeApres: ecr as object,
        },
      })

      return ecr
    })

    return reply.status(201).send({
      ecriture,
      avertissements: validation.avertissements,
    })
  })

  /**
   * GET /ecritures?exerciceId=xxx&journal=AC&mois=3
   * Liste les écritures avec filtres
   */
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const query = request.query as {
      exerciceId?: string
      journal?:    string
      mois?:       string
      compte?:     string
      page?:       string
    }

    const page    = Number(query.page ?? 1)
    const perPage = 50

    const ecritures = await prisma.ecriture.findMany({
      where: {
        exerciceId: query.exerciceId,
        journalId:  query.journal
          ? { in: await getJournalIds(query.journal, user.cabinetId) }
          : undefined,
        dateOperation: query.mois
          ? {
              gte: new Date(new Date().getFullYear(), Number(query.mois) - 1, 1),
              lt:  new Date(new Date().getFullYear(), Number(query.mois), 1),
            }
          : undefined,
        lignes: query.compte
          ? { some: { compteSyscohada: { startsWith: query.compte } } }
          : undefined,
        exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
      },
      include: {
        lignes:  true,
        journal: { select: { code: true, libelle: true } },
        saisiPar: { select: { nom: true, prenom: true } },
      },
      orderBy: { dateOperation: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    })

    return reply.send({ ecritures, page, perPage })
  })

  /**
   * GET /ecritures/balance?exerciceId=xxx
   * Balance des comptes (grand livre synthétique)
   */
  app.get("/balance", async (request, reply) => {
    const user  = request.user as { cabinetId: string }
    const query = request.query as { exerciceId: string }

    if (!query.exerciceId) {
      return reply.status(400).send({ error: "exerciceId requis" })
    }

    const lignes = await prisma.ligneEcriture.findMany({
      where: {
        ecriture: {
          exerciceId: query.exerciceId,
          statut:     "VALIDEE",
          exercice: { dossier: { client: { cabinetId: user.cabinetId } } },
        },
      },
      select: { compteSyscohada: true, libelleCompte: true, debit: true, credit: true },
    })

    // Agrégation par compte
    const balance = new Map<string, { libelle: string; debit: bigint; credit: bigint }>()
    for (const l of lignes) {
      const key  = l.compteSyscohada
      const prev = balance.get(key) ?? { libelle: l.libelleCompte, debit: 0n, credit: 0n }
      balance.set(key, {
        libelle: prev.libelle,
        debit:   prev.debit  + BigInt(l.debit.toString()),
        credit:  prev.credit + BigInt(l.credit.toString()),
      })
    }

    const result = Array.from(balance.entries())
      .map(([compte, v]) => ({
        compte,
        libelle:   v.libelle,
        debit:     v.debit.toString(),
        credit:    v.credit.toString(),
        solde:     (v.debit - v.credit).toString(),
      }))
      .sort((a, b) => a.compte.localeCompare(b.compte))

    return reply.send({ balance: result })
  })
}

async function getJournalIds(code: string, cabinetId: string): Promise<string[]> {
  const journaux = await prisma.journal.findMany({
    where: { code, exercice: { dossier: { client: { cabinetId } } } },
    select: { id: true },
  })
  return journaux.map(j => j.id)
}
