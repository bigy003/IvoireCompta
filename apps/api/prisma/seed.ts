/**
 * IvoireCompta — Seed de développement (idempotent)
 * Relancer : npx prisma db seed  (depuis apps/api)
 */

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { JOURNAUX_DEF } from "../src/lib/comptabilite-init.js"

const prisma = new PrismaClient()

/** Dossier + exercice (année civile) + 6 journaux — idempotent */
async function ensureExerciceAnnee(clientId: string, annee: number) {
  let dossier = await prisma.dossier.findFirst({
    where: { clientId },
    orderBy: { createdAt: "asc" },
  })
  if (!dossier) {
    dossier = await prisma.dossier.create({
      data: {
        clientId,
        typeMission: "COMPTABILITE",
        statut: "EN_COURS",
      },
    })
    console.log(`   → Dossier créé pour client ${clientId.slice(0, 8)}…`)
  }

  let exercice = await prisma.exercice.findFirst({
    where: { dossierId: dossier.id, annee },
  })
  if (!exercice) {
    exercice = await prisma.exercice.create({
      data: {
        dossierId: dossier.id,
        annee,
        dateDebut: new Date(`${annee}-01-01`),
        dateFin: new Date(`${annee}-12-31`),
        statut: "OUVERT",
      },
    })
    console.log(`   → Exercice ${annee} créé`)
  }

  for (const j of JOURNAUX_DEF) {
    await prisma.journal.upsert({
      where: { exerciceId_code: { exerciceId: exercice.id, code: j.code } },
      update: {},
      create: { exerciceId: exercice.id, ...j },
    })
  }

  return exercice
}

/**
 * Client TESTLONDON + exercice 2027 :
 * - 401100 : 2 lignes équilibrées (fournisseurs)
 * - 411100 : 2 lignes équilibrées (clients) — en plus d’un éventuel solde AN
 * Idempotent par pièce (on ne court-circuite plus tout le bloc si 401 existe déjà).
 */
async function ensureTestLondonLettrage2027(cabinetId: string, saisiParId: string, logPrefix = "") {
  const clientTestLondon = await prisma.client.upsert({
    where: { cabinetId_ncc: { cabinetId, ncc: "CI-TEST-LONDON" } },
    update: { nomRaisonSociale: "TESTLONDON" },
    create: {
      cabinetId,
      ncc: "CI-TEST-LONDON",
      nomRaisonSociale: "TESTLONDON",
      formeJuridique: "SARL",
      secteurActivite: "Tests lettrage",
      regimeImposition: "REEL_NORMAL",
      assujettitTVA: true,
      email: "testlondon@example.ci",
    },
  })
  const exerciceLondon2027 = await ensureExerciceAnnee(clientTestLondon.id, 2027)

  const journalAC = await prisma.journal.findFirst({
    where: { exerciceId: exerciceLondon2027.id, code: "AC" },
  })
  const journalBQ = await prisma.journal.findFirst({
    where: { exerciceId: exerciceLondon2027.id, code: "BQ" },
  })
  const journalVT = await prisma.journal.findFirst({
    where: { exerciceId: exerciceLondon2027.id, code: "VT" },
  })
  if (!journalAC || !journalBQ || !journalVT) throw new Error("Journaux manquants TESTLONDON 2027")

  let ajout401 = false
  const deja401 = await prisma.ecriture.findFirst({
    where: { exerciceId: exerciceLondon2027.id, pieceRef: "TEST-LETTRAGE-2027-FAC" },
  })
  if (!deja401) {
    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceLondon2027.id,
        journalId: journalAC.id,
        saisiParId,
        dateOperation: new Date("2027-03-15"),
        libelle: "TEST lettrage — Facture fournisseur",
        pieceRef: "TEST-LETTRAGE-2027-FAC",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "602200", libelleCompte: "Achats (test lettrage)", debit: 250_000, credit: 0, ordre: 0 },
            { compteSyscohada: "401100", libelleCompte: "Fournisseurs — TESTLONDON", debit: 0, credit: 250_000, ordre: 1 },
          ],
        },
      },
    })
    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceLondon2027.id,
        journalId: journalBQ.id,
        saisiParId,
        dateOperation: new Date("2027-03-20"),
        libelle: "TEST lettrage — Règlement fournisseur",
        pieceRef: "TEST-LETTRAGE-2027-REG",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "401100", libelleCompte: "Fournisseurs — TESTLONDON", debit: 250_000, credit: 0, ordre: 0 },
            { compteSyscohada: "521000", libelleCompte: "Banque (test)", debit: 0, credit: 250_000, ordre: 1 },
          ],
        },
      },
    })
    ajout401 = true
  }

  let ajout411 = false
  const deja411 = await prisma.ecriture.findFirst({
    where: { exerciceId: exerciceLondon2027.id, pieceRef: "TEST-LETTRAGE-411-VT" },
  })
  if (!deja411) {
    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceLondon2027.id,
        journalId: journalVT.id,
        saisiParId,
        dateOperation: new Date("2027-03-18"),
        libelle: "TEST lettrage — Facture client",
        pieceRef: "TEST-LETTRAGE-411-VT",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "411100", libelleCompte: "Clients — TESTLONDON", debit: 250_000, credit: 0, ordre: 0 },
            { compteSyscohada: "701000", libelleCompte: "Ventes (test lettrage)", debit: 0, credit: 250_000, ordre: 1 },
          ],
        },
      },
    })
    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceLondon2027.id,
        journalId: journalBQ.id,
        saisiParId,
        dateOperation: new Date("2027-03-22"),
        libelle: "TEST lettrage — Encaissement client",
        pieceRef: "TEST-LETTRAGE-411-ENC",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "521000", libelleCompte: "Banque (test)", debit: 250_000, credit: 0, ordre: 0 },
            { compteSyscohada: "411100", libelleCompte: "Clients — TESTLONDON", debit: 0, credit: 250_000, ordre: 1 },
          ],
        },
      },
    })
    ajout411 = true
  }

  if (ajout401) {
    console.log(
      `${logPrefix}   → TESTLONDON 2027 : 401100 démo lettrage (250 000 / 250 000) — GL Fournisseurs`
    )
  }
  if (ajout411) {
    console.log(
      `${logPrefix}   → TESTLONDON 2027 : 411100 démo lettrage (250 000 / 250 000) — GL Clients (cocher ces 2 lignes, pas l’AN seul)`
    )
  }
  if (!ajout401 && !ajout411) {
    console.log(`${logPrefix}⏭️  Démo lettrage TESTLONDON 2027 déjà complète (cabinet ${cabinetId.slice(0, 8)}…)`)
  }
}

const BRYAN_EMAIL = "bryan@cabinet.fr"
/** Mot de passe uniquement si le seed crée ce compte (sinon vous gardez celui de l’inscription). */
const BRYAN_DEV_PASSWORD = "BryanDev2027!"

/** Compte utilisé pour la démo lettrage TESTLONDON : crée cabinet + expert si l’email n’existe pas encore. */
async function ensureBryanExpertForLettrageDemo(): Promise<{ id: string; cabinetId: string }> {
  const existing = await prisma.utilisateur.findFirst({
    where: { email: BRYAN_EMAIL },
  })
  if (existing) {
    console.log(`✅ Utilisateur ${BRYAN_EMAIL} trouvé (cabinet ${existing.cabinetId.slice(0, 8)}…)`)
    return { id: existing.id, cabinetId: existing.cabinetId }
  }

  const cabinetBryan = await prisma.cabinet.upsert({
    where: { numeroOrdre: "ONECCA-DEV-BRYAN-FR" },
    update: {},
    create: {
      nom: "Cabinet Bryan (dev)",
      numeroOrdre: "ONECCA-DEV-BRYAN-FR",
      email: "contact@cabinet.fr",
      regimeFiscal: "REEL_NORMAL",
    },
  })
  const passwordHash = await bcrypt.hash(BRYAN_DEV_PASSWORD, 10)
  const u = await prisma.utilisateur.create({
    data: {
      cabinetId: cabinetBryan.id,
      nom: "Bryan",
      prenom: "Bryan",
      email: BRYAN_EMAIL,
      passwordHash,
      role: "EXPERT_COMPTABLE",
      numeroOrdre: "ONECCA-DEV-BRYAN-FR",
    },
  })
  console.log(`✅ Compte dev créé : ${BRYAN_EMAIL} / ${BRYAN_DEV_PASSWORD}`)
  return { id: u.id, cabinetId: u.cabinetId }
}

async function main() {
  console.log("🌱 Seed IvoireCompta (idempotent)…\n")

  const cabinet = await prisma.cabinet.upsert({
    where: { numeroOrdre: "ONECCA-00142" },
    update: {},
    create: {
      nom: "Cabinet Konan & Associés",
      numeroOrdre: "ONECCA-00142",
      email: "contact@konan-associes.ci",
      telephone: "+225 27 22 41 00 00",
      adresse: "Plateau, Immeuble Sciam, 2ème étage, Abidjan",
      regimeFiscal: "REEL_NORMAL",
    },
  })
  console.log(`✅ Cabinet : ${cabinet.nom}`)

  const passwordHash = await bcrypt.hash("IvoireCompta2025!", 10)
  const expert = await prisma.utilisateur.upsert({
    where: { cabinetId_email: { cabinetId: cabinet.id, email: "konan@konan-associes.ci" } },
    update: {},
    create: {
      cabinetId: cabinet.id,
      nom: "Konan",
      prenom: "Koffi",
      email: "konan@konan-associes.ci",
      passwordHash,
      role: "EXPERT_COMPTABLE",
      numeroOrdre: "ONECCA-00142",
    },
  })
  console.log(`✅ Expert : ${expert.prenom} ${expert.nom} <${expert.email}>`)

  const collab = await prisma.utilisateur.upsert({
    where: { cabinetId_email: { cabinetId: cabinet.id, email: "collaborateur@konan-associes.ci" } },
    update: {},
    create: {
      cabinetId: cabinet.id,
      nom: "Diallo",
      prenom: "Aminata",
      email: "collaborateur@konan-associes.ci",
      passwordHash: await bcrypt.hash("Collab2025!", 10),
      role: "COLLABORATEUR",
    },
  })
  console.log(`✅ Collaborateur : ${collab.prenom} ${collab.nom}`)

  const client1 = await prisma.client.upsert({
    where: { cabinetId_ncc: { cabinetId: cabinet.id, ncc: "CI-2018-00841" } },
    update: {},
    create: {
      cabinetId: cabinet.id,
      ncc: "CI-2018-00841",
      nomRaisonSociale: "BSCI Sarl",
      formeJuridique: "SARL",
      secteurActivite: "Commerce général",
      regimeImposition: "REEL_NORMAL",
      assujettitTVA: true,
      email: "direction@bsci.ci",
      telephone: "+225 27 22 50 00 00",
      adresseSiege: "Adjamé, Abidjan",
    },
  })

  const client2 = await prisma.client.upsert({
    where: { cabinetId_ncc: { cabinetId: cabinet.id, ncc: "CI-2015-00234" } },
    update: {},
    create: {
      cabinetId: cabinet.id,
      ncc: "CI-2015-00234",
      nomRaisonSociale: "Pharmacie Bonheur",
      formeJuridique: "EI",
      secteurActivite: "Santé",
      regimeImposition: "REEL_SIMPLIFIE",
      assujettitTVA: false,
      email: "pharmaciebonheur@gmail.com",
      telephone: "+225 07 00 00 00 00",
      adresseSiege: "Cocody, Abidjan",
    },
  })
  console.log(`✅ Clients : ${client1.nomRaisonSociale}, ${client2.nomRaisonSociale}`)

  console.log("\n📁 Dossiers & exercices 2025 + journaux…")
  const exerciceBsci = await ensureExerciceAnnee(client1.id, 2025)
  await ensureExerciceAnnee(client2.id, 2025)
  console.log(`✅ 6 journaux par exercice (AC, VT, BQ, CA, OD, SA)`)

  const nbEcritures = await prisma.ecriture.count({ where: { exerciceId: exerciceBsci.id } })
  if (nbEcritures === 0) {
    const journalAC = await prisma.journal.findFirst({
      where: { exerciceId: exerciceBsci.id, code: "AC" },
    })
    const journalVT = await prisma.journal.findFirst({
      where: { exerciceId: exerciceBsci.id, code: "VT" },
    })
    const journalBQ = await prisma.journal.findFirst({
      where: { exerciceId: exerciceBsci.id, code: "BQ" },
    })
    if (!journalAC || !journalVT || !journalBQ) throw new Error("Journaux manquants")

    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceBsci.id,
        journalId: journalAC.id,
        saisiParId: collab.id,
        dateOperation: new Date("2025-01-15"),
        libelle: "Achat fournitures bureau — Fournisseur BSCI",
        pieceRef: "FACT-2025-0001",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "601100", libelleCompte: "Achats fournitures", debit: 177966, credit: 0, ordre: 0 },
            { compteSyscohada: "445620", libelleCompte: "TVA déductible 18%", debit: 32034, credit: 0, ordre: 1 },
            { compteSyscohada: "401100", libelleCompte: "Fournisseur BSCI", debit: 0, credit: 210000, ordre: 2 },
          ],
        },
      },
    })
    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceBsci.id,
        journalId: journalVT.id,
        saisiParId: collab.id,
        dateOperation: new Date("2025-01-20"),
        libelle: "Vente marchandises — Client Djara SA",
        pieceRef: "FACT-VT-2025-0001",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "411100", libelleCompte: "Client Djara SA", debit: 590000, credit: 0, ordre: 0 },
            { compteSyscohada: "701000", libelleCompte: "Ventes marchandises", debit: 0, credit: 500000, ordre: 1 },
            { compteSyscohada: "443100", libelleCompte: "TVA collectée 18%", debit: 0, credit: 90000, ordre: 2 },
          ],
        },
      },
    })
    await prisma.ecriture.create({
      data: {
        exerciceId: exerciceBsci.id,
        journalId: journalBQ.id,
        saisiParId: collab.id,
        dateOperation: new Date("2025-01-25"),
        libelle: "Règlement fournisseur BSCI — chèque n°001234",
        pieceRef: "CHQ-001234",
        statut: "VALIDEE",
        valideeLe: new Date(),
        lignes: {
          create: [
            { compteSyscohada: "401100", libelleCompte: "Fournisseur BSCI", debit: 210000, credit: 0, ordre: 0 },
            { compteSyscohada: "521000", libelleCompte: "Banque SGBCI", debit: 0, credit: 210000, ordre: 1 },
          ],
        },
      },
    })
    console.log(`✅ 3 écritures de démo (BSCI / exercice 2025)`)
  } else {
    console.log(`⏭️  Écritures de démo déjà présentes (${nbEcritures}), skip`)
  }

  console.log("\n📁 TESTLONDON — compte bryan@cabinet.fr uniquement (lettrage 2027)…")
  const bryanCtx = await ensureBryanExpertForLettrageDemo()
  await ensureTestLondonLettrage2027(bryanCtx.cabinetId, bryanCtx.id, "   ")

  const echeancesSeed = [
    { type: "TVA_MENSUELLE" as const, label: "TVA Janvier 2025", date: new Date("2025-02-15"), periode: "TVA-2025-01" },
    { type: "TVA_MENSUELLE" as const, label: "TVA Février 2025", date: new Date("2025-03-15"), periode: "TVA-2025-02" },
    { type: "IS_ACOMPTE_1" as const, label: "1er acompte IS 2025", date: new Date("2025-04-20"), periode: "IS-ACOMPTE1-2025" },
    { type: "TVA_MENSUELLE" as const, label: "TVA Mars 2025", date: new Date("2025-04-15"), periode: "TVA-2025-03" },
    { type: "IS_ACOMPTE_2" as const, label: "2ème acompte IS 2025", date: new Date("2025-07-20"), periode: "IS-ACOMPTE2-2025" },
    { type: "IS_ACOMPTE_3" as const, label: "3ème acompte IS 2025", date: new Date("2025-10-20"), periode: "IS-ACOMPTE3-2025" },
    { type: "DSF_ANNUELLE" as const, label: "DSF Exercice 2025", date: new Date("2026-04-30"), periode: "DSF-2025" },
    { type: "IS_SOLDE" as const, label: "Solde IS 2025", date: new Date("2026-04-30"), periode: "IS-SOLDE-2025" },
  ]

  let echeancesAjoutees = 0
  for (const e of echeancesSeed) {
    const exists = await prisma.echeanceFiscale.findFirst({
      where: { clientId: client1.id, periodeLabel: e.periode },
    })
    if (!exists) {
      await prisma.echeanceFiscale.create({
        data: {
          clientId: client1.id,
          typeDeclaration: e.type,
          periodeLabel: e.periode,
          dateEcheance: e.date,
          statut: e.date < new Date() ? "EN_RETARD" : "A_FAIRE",
        },
      })
      echeancesAjoutees++
    }
  }
  if (echeancesAjoutees > 0) console.log(`✅ +${echeancesAjoutees} échéance(s) fiscale(s)`)
  else console.log(`⏭️  Échéances fiscales déjà présentes`)

  await prisma.employe.upsert({
    where: { clientId_matricule: { clientId: client1.id, matricule: "EMP-001" } },
    update: { poste: "Comptable" },
    create: {
      clientId: client1.id,
      matricule: "EMP-001",
      nom: "Ouattara",
      prenom: "Ibrahim",
      dateEmbauche: new Date("2022-03-01"),
      categorieCnps: "Cadre",
      codeCategorie: "C3",
      poste: "Comptable",
      salaireBase: 450000,
    },
  })
  console.log(`✅ Employé test (BSCI)`)

  console.log("\n✨ Seed terminé.\n")
  console.log("📋 Connexion :")
  console.log("   konan@konan-associes.ci     / IvoireCompta2025!")
  console.log("   collaborateur@konan-associes.ci / Collab2025!")
  console.log(`   ${BRYAN_EMAIL}  /  mot de passe : celui défini à l’inscription, ou « ${BRYAN_DEV_PASSWORD} » si le seed vient de créer ce compte.`)
  console.log("\n   Page écritures : client « BSCI Sarl », exercice 2025, journal AC.")
  console.log(`   Lettrage TESTLONDON : connectez-vous avec ${BRYAN_EMAIL}, ex. 2027 — 401100 ou 411100 (2 lignes démo 250 k).\n`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
