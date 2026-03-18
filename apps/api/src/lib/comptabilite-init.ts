/**
 * Initialisation dossier + exercice + journaux SYSCOHADA pour un client (MVP).
 */

import type { PrismaClient } from "@prisma/client"

/** Client Prisma dans une transaction interactive */
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

export const JOURNAUX_DEF = [
  { code: "AC", libelle: "Journal des achats", type: "ACHATS" as const },
  { code: "VT", libelle: "Journal des ventes", type: "VENTES" as const },
  { code: "BQ", libelle: "Journal de banque", type: "BANQUE" as const },
  { code: "CA", libelle: "Journal de caisse", type: "CAISSE" as const },
  { code: "OD", libelle: "Journal des opérations div.", type: "OPERATIONS_DIVERSES" as const },
  { code: "SA", libelle: "Journal des salaires", type: "SALAIRES" as const },
]

/** Crée dossier + exercice (année civile) + 6 journaux — à appeler dans une transaction après création client */
export async function creerMissionComptablePourClient(
  tx: Tx,
  clientId: string,
  annee: number = new Date().getFullYear()
) {
  const dossier = await tx.dossier.create({
    data: {
      clientId,
      typeMission: "COMPTABILITE",
      statut: "EN_COURS",
    },
  })

  const exercice = await tx.exercice.create({
    data: {
      dossierId: dossier.id,
      annee,
      dateDebut: new Date(annee, 0, 1),
      dateFin: new Date(annee, 11, 31, 23, 59, 59, 999),
      statut: "OUVERT",
    },
  })

  await tx.journal.createMany({
    data: JOURNAUX_DEF.map(j => ({
      exerciceId: exercice.id,
      code: j.code,
      libelle: j.libelle,
      type: j.type,
    })),
  })

  return { dossierId: dossier.id, exerciceId: exercice.id, annee }
}

/**
 * Pour clients sans dossier ou sans exercice de l'année en cours + journaux.
 * Idempotent.
 */
export async function garantirComptabiliteClient(
  prisma: PrismaClient,
  clientId: string
): Promise<{ dossierId: string; exerciceId: string; annee: number; cree: boolean }> {
  const annee = new Date().getFullYear()
  let dossier = await prisma.dossier.findFirst({
    where: { clientId },
    orderBy: { createdAt: "asc" },
  })
  let cree = false

  if (!dossier) {
    dossier = await prisma.dossier.create({
      data: {
        clientId,
        typeMission: "COMPTABILITE",
        statut: "EN_COURS",
      },
    })
    cree = true
  }

  let exercice = await prisma.exercice.findFirst({
    where: { dossierId: dossier.id, annee },
  })

  if (!exercice) {
    exercice = await prisma.exercice.create({
      data: {
        dossierId: dossier.id,
        annee,
        dateDebut: new Date(annee, 0, 1),
        dateFin: new Date(annee, 11, 31, 23, 59, 59, 999),
        statut: "OUVERT",
      },
    })
    cree = true
  }

  const nbJournaux = await prisma.journal.count({
    where: { exerciceId: exercice.id },
  })

  if (nbJournaux < JOURNAUX_DEF.length) {
    for (const j of JOURNAUX_DEF) {
      await prisma.journal.upsert({
        where: { exerciceId_code: { exerciceId: exercice.id, code: j.code } },
        update: {},
        create: { exerciceId: exercice.id, ...j },
      })
    }
    cree = true
  }

  return {
    dossierId: dossier.id,
    exerciceId: exercice.id,
    annee,
    cree,
  }
}
