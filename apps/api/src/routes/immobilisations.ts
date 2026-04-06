import { FastifyInstance } from "fastify"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { sanitizeLibelleCompta } from "../lib/sanitize-text"

const prisma = new PrismaClient()

function toNum(v: { toString: () => string }): number {
  return Number(v.toString())
}

/** Mois complets écoulés depuis dateMiseEnService (inclus premier mois si anniversaire atteint) */
function fullMonthsSinceService(service: Date, until: Date): number {
  if (until.getTime() < service.getTime()) return 0
  const y = until.getUTCFullYear() - service.getUTCFullYear()
  let m = until.getUTCMonth() - service.getUTCMonth() + y * 12
  if (until.getUTCDate() < service.getUTCDate()) m -= 1
  return m + 1
}

function baseAmortissable(origine: number, residuelle: number): number {
  return Math.max(0, origine - residuelle)
}

function dotationMensuelleLineaire(origine: number, residuelle: number, dureeAnnees: number): number {
  const months = Math.max(1, dureeAnnees * 12)
  return Math.round(baseAmortissable(origine, residuelle) / months)
}

/** Amortissement cumulé linéaire à la date `until` */
function amortCumuleLineaire(
  origine: number,
  residuelle: number,
  dureeAnnees: number,
  dateMiseEnService: Date,
  until: Date
): number {
  const base = baseAmortissable(origine, residuelle)
  if (base <= 0) return 0
  const dm = dotationMensuelleLineaire(origine, residuelle, dureeAnnees)
  const mois = fullMonthsSinceService(dateMiseEnService, until)
  const maxMois = dureeAnnees * 12
  return Math.min(base, dm * Math.min(mois, maxMois))
}

/** Échéancier annualisé dégressif (taux 2/n sur VNC début d’exercice d’amort.) — MVP */
function echeancierDegressif(
  origine: number,
  residuelle: number,
  dureeAnnees: number,
  anneeDebut: number
): Array<{ annee: number; dotation: number; cumul: number; vnc: number }> {
  const base = baseAmortissable(origine, residuelle)
  const rows: Array<{ annee: number; dotation: number; cumul: number; vnc: number }> = []
  if (base <= 0 || dureeAnnees <= 0) return rows
  const taux = Math.min(2 / dureeAnnees, 1)
  let cumul = 0
  for (let k = 0; k < dureeAnnees && cumul < base; k++) {
    const vncAvant = origine - cumul
    const resteBase = base - cumul
    const dot = Math.min(Math.round(vncAvant * taux), resteBase)
    cumul += dot
    rows.push({
      annee: anneeDebut + k,
      dotation: dot,
      cumul,
      vnc: origine - cumul,
    })
  }
  return rows
}

function amortCumuleDegressifAtDate(
  origine: number,
  residuelle: number,
  dureeAnnees: number,
  dateMiseEnService: Date,
  until: Date
): number {
  const base = baseAmortissable(origine, residuelle)
  if (base <= 0) return 0
  const annee0 = dateMiseEnService.getUTCFullYear()
  const schedule = echeancierDegressif(origine, residuelle, dureeAnnees, annee0)
  if (schedule.length === 0) return 0
  let cumul = 0
  const untilT = until.getTime()
  for (const row of schedule) {
    const finExercice = new Date(Date.UTC(row.annee, 11, 31, 23, 59, 59))
    if (finExercice.getTime() < untilT) {
      cumul = row.cumul
      continue
    }
    const debutExercice = new Date(Date.UTC(row.annee, 0, 1))
    const serviceThisYear =
      dateMiseEnService.getTime() > debutExercice.getTime() ? dateMiseEnService : debutExercice
    if (row.annee === until.getUTCFullYear()) {
      const prevCumul = row.cumul - row.dotation
      const mois = fullMonthsSinceService(serviceThisYear, until)
      const part = Math.min(row.dotation, Math.round((row.dotation * Math.min(12, mois)) / 12))
      cumul = Math.min(base, prevCumul + part)
    }
    break
  }
  return Math.min(base, cumul)
}

function amortCumuleForAsset(
  methode: "LINEAIRE" | "DEGRESSIF",
  origine: number,
  residuelle: number,
  dureeAnnees: number,
  dateMiseEnService: Date,
  until: Date
): number {
  if (methode === "DEGRESSIF") {
    return amortCumuleDegressifAtDate(origine, residuelle, dureeAnnees, dateMiseEnService, until)
  }
  return amortCumuleLineaire(origine, residuelle, dureeAnnees, dateMiseEnService, until)
}

const CreateSchema = z.object({
  clientId: z.string().uuid(),
  exerciceId: z.string().uuid(),
  reference: z.string().min(1).max(60),
  libelle: z.string().min(1).max(300),
  categorie: z.enum(["MATERIEL", "VEHICULE", "LOGICIEL", "MOBILIER", "BATIMENT", "AUTRE"]),
  fournisseur: z.string().max(200).optional(),
  compteImmobilisation: z.string().min(1).max(20),
  compteAmortissement: z.string().min(1).max(20),
  dateAcquisition: z.string(),
  dateMiseEnService: z.string(),
  valeurOrigine: z.number().int().nonnegative(),
  valeurResiduelle: z.number().int().nonnegative().optional(),
  dureeAnnees: z.number().int().min(1).max(50),
  methodeAmortissement: z.enum(["LINEAIRE", "DEGRESSIF"]).optional(),
  notes: z.string().max(2000).optional(),
})

const PatchSchema = CreateSchema.partial().omit({ clientId: true, exerciceId: true }).extend({
  statut: z.enum(["EN_SERVICE", "CEDEE"]).optional(),
})

const SortieSchema = z.object({
  dateSortie: z.string(),
})

function mapImmobilisation(
  row: {
    id: string
    reference: string
    libelle: string
    categorie: string
    fournisseur: string | null
    compteImmobilisation: string
    compteAmortissement: string
    dateAcquisition: Date
    dateMiseEnService: Date
    valeurOrigine: { toString: () => string }
    valeurResiduelle: { toString: () => string }
    dureeAnnees: number
    methodeAmortissement: "LINEAIRE" | "DEGRESSIF"
    notes: string | null
    statut: string
    dateSortie: Date | null
    client: { id: string; nomRaisonSociale: string }
    exercice: { id: string; annee: number }
  },
  refDate: Date
) {
  const origine = toNum(row.valeurOrigine)
  const residuelle = toNum(row.valeurResiduelle)
  const endDate =
    row.statut === "SORTIE" && row.dateSortie ? new Date(row.dateSortie) : refDate
  const until =
    endDate.getTime() < row.dateMiseEnService.getTime() ? row.dateMiseEnService : endDate
  const amort =
    row.statut === "CEDEE"
      ? baseAmortissable(origine, residuelle)
      : amortCumuleForAsset(row.methodeAmortissement, origine, residuelle, row.dureeAnnees, row.dateMiseEnService, until)
  const cumul = row.statut === "CEDEE" ? baseAmortissable(origine, residuelle) : Math.min(amort, baseAmortissable(origine, residuelle))
  const vnc = Math.max(origine - cumul, residuelle)
  const base = baseAmortissable(origine, residuelle)
  const y = refDate.getUTCFullYear()
  const mo = refDate.getUTCMonth()
  const finMois = new Date(Date.UTC(y, mo + 1, 0, 23, 59, 59))
  const finMoisPrec = new Date(Date.UTC(y, mo, 0, 23, 59, 59))
  const t1 = until.getTime() < finMois.getTime() ? until : finMois
  const t0 = until.getTime() < finMoisPrec.getTime() ? until : finMoisPrec
  const c1 = Math.min(base, amortCumuleForAsset(row.methodeAmortissement, origine, residuelle, row.dureeAnnees, row.dateMiseEnService, t1))
  const c0 = Math.min(base, amortCumuleForAsset(row.methodeAmortissement, origine, residuelle, row.dureeAnnees, row.dateMiseEnService, t0))
  const dm = row.statut === "EN_SERVICE" ? Math.max(0, c1 - c0) : 0
  const tauxLineairePct = row.dureeAnnees > 0 ? Math.round(10000 / row.dureeAnnees) / 100 : 0
  const tauxDegressifPct =
    row.dureeAnnees > 0 ? Math.min(Math.round(((2 / row.dureeAnnees) * 100) * 100) / 100, 100) : 0

  return {
    id: row.id,
    reference: row.reference,
    libelle: row.libelle,
    categorie: row.categorie,
    fournisseur: row.fournisseur,
    compteImmobilisation: row.compteImmobilisation,
    compteAmortissement: row.compteAmortissement,
    dateAcquisition: row.dateAcquisition.toISOString(),
    dateMiseEnService: row.dateMiseEnService.toISOString(),
    valeurOrigine: origine.toString(),
    valeurResiduelle: residuelle.toString(),
    dureeAnnees: row.dureeAnnees,
    methodeAmortissement: row.methodeAmortissement,
    notes: row.notes ? sanitizeLibelleCompta(row.notes) : null,
    statut: row.statut,
    dateSortie: row.dateSortie?.toISOString() ?? null,
    client: row.client,
    exercice: row.exercice,
    amortCumule: cumul.toString(),
    vnc: vnc.toString(),
    dotationMois: Math.max(0, row.statut === "EN_SERVICE" ? dm : 0).toString(),
    tauxAnnuelPct: (row.methodeAmortissement === "LINEAIRE" ? tauxLineairePct : tauxDegressifPct).toString(),
  }
}

function buildEcheancier(
  methode: "LINEAIRE" | "DEGRESSIF",
  origine: number,
  residuelle: number,
  dureeAnnees: number,
  dateMiseEnService: Date
) {
  const base = baseAmortissable(origine, residuelle)
  if (methode === "DEGRESSIF") {
    return echeancierDegressif(origine, residuelle, dureeAnnees, dateMiseEnService.getUTCFullYear()).map(r => ({
      annee: r.annee,
      dotation: r.dotation,
      cumul: r.cumul,
      vnc: r.vnc,
    }))
  }
  const dmAnnee = Math.round(base / dureeAnnees)
  const rows: Array<{ annee: number; dotation: number; cumul: number; vnc: number }> = []
  let cumul = 0
  const y0 = dateMiseEnService.getUTCFullYear()
  for (let i = 0; i < dureeAnnees; i++) {
    const dot = i === dureeAnnees - 1 ? base - cumul : Math.min(dmAnnee, base - cumul)
    cumul += dot
    rows.push({ annee: y0 + i, dotation: dot, cumul, vnc: origine - cumul })
  }
  return rows
}

export async function immobilisationsRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const q = request.query as {
      exerciceId?: string
      clientId?: string
      categorie?: string
      statut?: string
      search?: string
    }
    if (!q.exerciceId) return reply.status(400).send({ error: "exerciceId requis" })

    const exercice = await prisma.exercice.findFirst({
      where: { id: q.exerciceId, dossier: { client: { cabinetId: user.cabinetId } } },
      include: { dossier: { include: { client: true } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice introuvable" })

    const where = {
      exerciceId: q.exerciceId,
      clientId: exercice.dossier.clientId,
      ...(q.clientId && q.clientId === exercice.dossier.clientId ? {} : {}),
      ...(q.categorie && q.categorie !== "TOUS" ? { categorie: q.categorie as any } : {}),
      ...(q.statut && q.statut !== "TOUS" ? { statut: q.statut as any } : {}),
      ...(q.search
        ? {
            OR: [
              { libelle: { contains: q.search, mode: "insensitive" as const } },
              { reference: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    }

    const list = await prisma.immobilisation.findMany({
      where,
      include: {
        client: { select: { id: true, nomRaisonSociale: true } },
        exercice: { select: { id: true, annee: true } },
      },
      orderBy: [{ reference: "asc" }],
      take: 500,
    })

    const refDate = new Date()
    const mapped = list.map(r => mapImmobilisation(r, refDate))
    let valeurBrute = 0
    let amortCumuleTot = 0
    let vncTot = 0
    let dotationMoisTot = 0
    for (const m of mapped) {
      valeurBrute += Number(m.valeurOrigine)
      amortCumuleTot += Number(m.amortCumule)
      vncTot += Number(m.vnc)
      dotationMoisTot += Number(m.dotationMois)
    }

    return reply.send({
      immobilisations: mapped,
      kpi: {
        valeurBruteTotale: String(valeurBrute),
        amortissementsCumules: String(amortCumuleTot),
        valeurNetteComptable: String(vncTot),
        dotationDuMois: String(dotationMoisTot),
      },
    })
  })

  app.get("/:id", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const row = await prisma.immobilisation.findFirst({
      where: { id, client: { cabinetId: user.cabinetId } },
      include: {
        client: { select: { id: true, nomRaisonSociale: true } },
        exercice: { select: { id: true, annee: true } },
      },
    })
    if (!row) return reply.status(404).send({ error: "Immobilisation introuvable" })

    const refDate = new Date()
    const immo = mapImmobilisation(row, refDate)
    const origine = toNum(row.valeurOrigine)
    const residuelle = toNum(row.valeurResiduelle)
    const echeancier = buildEcheancier(
      row.methodeAmortissement,
      origine,
      residuelle,
      row.dureeAnnees,
      row.dateMiseEnService
    )
    return reply.send({ immobilisation: immo, echeancier })
  })

  app.post("/", async (request, reply) => {
    const user = request.user as { id: string; cabinetId: string }
    const parsed = CreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const b = parsed.data
    const reference = sanitizeLibelleCompta(b.reference)
    const libelle = sanitizeLibelleCompta(b.libelle)
    const fournisseur =
      b.fournisseur != null && String(b.fournisseur).trim() !== "" ? sanitizeLibelleCompta(b.fournisseur) : null
    const notes =
      b.notes != null && String(b.notes).trim() !== "" ? sanitizeLibelleCompta(b.notes) : null
    if (!reference.length || !libelle.length) {
      return reply.status(400).send({ error: "Référence et libellé : caractères non acceptés ou texte vide après nettoyage." })
    }

    const exercice = await prisma.exercice.findFirst({
      where: { id: b.exerciceId, dossier: { clientId: b.clientId, client: { cabinetId: user.cabinetId } } },
    })
    if (!exercice) return reply.status(404).send({ error: "Exercice ou client invalide" })

    if (b.valeurResiduelle !== undefined && b.valeurResiduelle > b.valeurOrigine) {
      return reply.status(400).send({ error: "La valeur résiduelle ne peut pas dépasser la valeur d'origine." })
    }

    try {
      const created = await prisma.immobilisation.create({
        data: {
          clientId: b.clientId,
          exerciceId: b.exerciceId,
          creeParId: user.id,
          reference,
          libelle,
          categorie: b.categorie,
          fournisseur,
          compteImmobilisation: b.compteImmobilisation.trim(),
          compteAmortissement: b.compteAmortissement.trim(),
          dateAcquisition: new Date(b.dateAcquisition),
          dateMiseEnService: new Date(b.dateMiseEnService),
          valeurOrigine: b.valeurOrigine,
          valeurResiduelle: b.valeurResiduelle ?? 0,
          dureeAnnees: b.dureeAnnees,
          methodeAmortissement: b.methodeAmortissement ?? "LINEAIRE",
          notes,
        },
        include: {
          client: { select: { id: true, nomRaisonSociale: true } },
          exercice: { select: { id: true, annee: true } },
        },
      })
      return reply.status(201).send({
        immobilisation: mapImmobilisation(created, new Date()),
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "P2002") {
        return reply.status(409).send({ error: "Référence déjà utilisée pour cet exercice." })
      }
      throw e
    }
  })

  app.patch("/:id", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const parsed = PatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })
    const b = parsed.data

    const exist = await prisma.immobilisation.findFirst({
      where: { id, client: { cabinetId: user.cabinetId } },
    })
    if (!exist) return reply.status(404).send({ error: "Immobilisation introuvable" })

    const vo = b.valeurOrigine ?? toNum(exist.valeurOrigine)
    const vr = b.valeurResiduelle ?? toNum(exist.valeurResiduelle)
    if (vr > vo) return reply.status(400).send({ error: "La valeur résiduelle ne peut pas dépasser la valeur d'origine." })

    let referenceP: string | undefined
    if (b.reference !== undefined) {
      referenceP = sanitizeLibelleCompta(b.reference)
      if (!referenceP.length) return reply.status(400).send({ error: "Référence invalide après nettoyage." })
    }
    let libelleP: string | undefined
    if (b.libelle !== undefined) {
      libelleP = sanitizeLibelleCompta(b.libelle)
      if (!libelleP.length) return reply.status(400).send({ error: "Libellé invalide après nettoyage." })
    }
    const fournisseurP =
      b.fournisseur !== undefined ? (String(b.fournisseur).trim() === "" ? null : sanitizeLibelleCompta(b.fournisseur)) : undefined
    const notesP =
      b.notes !== undefined ? (String(b.notes).trim() === "" ? null : sanitizeLibelleCompta(b.notes)) : undefined

    const updated = await prisma.immobilisation.update({
      where: { id },
      data: {
        ...(referenceP !== undefined ? { reference: referenceP } : {}),
        ...(libelleP !== undefined ? { libelle: libelleP } : {}),
        ...(b.categorie !== undefined ? { categorie: b.categorie } : {}),
        ...(fournisseurP !== undefined ? { fournisseur: fournisseurP } : {}),
        ...(b.compteImmobilisation !== undefined ? { compteImmobilisation: b.compteImmobilisation.trim() } : {}),
        ...(b.compteAmortissement !== undefined ? { compteAmortissement: b.compteAmortissement.trim() } : {}),
        ...(b.dateAcquisition !== undefined ? { dateAcquisition: new Date(b.dateAcquisition) } : {}),
        ...(b.dateMiseEnService !== undefined ? { dateMiseEnService: new Date(b.dateMiseEnService) } : {}),
        ...(b.valeurOrigine !== undefined ? { valeurOrigine: b.valeurOrigine } : {}),
        ...(b.valeurResiduelle !== undefined ? { valeurResiduelle: b.valeurResiduelle } : {}),
        ...(b.dureeAnnees !== undefined ? { dureeAnnees: b.dureeAnnees } : {}),
        ...(b.methodeAmortissement !== undefined ? { methodeAmortissement: b.methodeAmortissement } : {}),
        ...(notesP !== undefined ? { notes: notesP } : {}),
        ...(b.statut !== undefined ? { statut: b.statut } : {}),
      },
      include: {
        client: { select: { id: true, nomRaisonSociale: true } },
        exercice: { select: { id: true, annee: true } },
      },
    })
    return reply.send({ immobilisation: mapImmobilisation(updated, new Date()) })
  })

  app.post("/:id/sortir", async (request, reply) => {
    const user = request.user as { cabinetId: string }
    const { id } = request.params as { id: string }
    const parsed = SortieSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ erreurs: parsed.error.flatten() })

    const exist = await prisma.immobilisation.findFirst({
      where: { id, client: { cabinetId: user.cabinetId } },
    })
    if (!exist) return reply.status(404).send({ error: "Immobilisation introuvable" })

    const updated = await prisma.immobilisation.update({
      where: { id },
      data: {
        statut: "SORTIE",
        dateSortie: new Date(parsed.data.dateSortie),
      },
      include: {
        client: { select: { id: true, nomRaisonSociale: true } },
        exercice: { select: { id: true, annee: true } },
      },
    })
    return reply.send({ immobilisation: mapImmobilisation(updated, new Date()) })
  })
}
