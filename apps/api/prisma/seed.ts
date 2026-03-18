/**
 * IvoireCompta — Seed de développement (idempotent)
 * Relancer : npx prisma db seed  (depuis apps/api)
 */

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { JOURNAUX_DEF } from "../src/lib/comptabilite-init.js"

const prisma = new PrismaClient()

async function ensureExercice2025(clientId: string) {
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
    where: { dossierId: dossier.id, annee: 2025 },
  })
  if (!exercice) {
    exercice = await prisma.exercice.create({
      data: {
        dossierId: dossier.id,
        annee: 2025,
        dateDebut: new Date("2025-01-01"),
        dateFin: new Date("2025-12-31"),
        statut: "OUVERT",
      },
    })
    console.log(`   → Exercice 2025 créé`)
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
  const exerciceBsci = await ensureExercice2025(client1.id)
  await ensureExercice2025(client2.id)
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
  console.log("\n   Page écritures : client « BSCI Sarl », exercice 2025, journal AC.\n")
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
