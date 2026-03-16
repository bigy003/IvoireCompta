/**
 * IvoireCompta — Seed de développement
 * Crée un cabinet pilote avec données de test réalistes
 */

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Seed IvoireCompta démarré...")

  // ── Cabinet pilote ─────────────────────────────────────────────
  const cabinet = await prisma.cabinet.upsert({
    where: { numeroOrdre: "ONECCA-00142" },
    update: {},
    create: {
      nom:          "Cabinet Konan & Associés",
      numeroOrdre:  "ONECCA-00142",
      email:        "contact@konan-associes.ci",
      telephone:    "+225 27 22 41 00 00",
      adresse:      "Plateau, Immeuble Sciam, 2ème étage, Abidjan",
      regimeFiscal: "REEL_NORMAL",
    },
  })
  console.log(`✅ Cabinet : ${cabinet.nom}`)

  // ── Expert-comptable ───────────────────────────────────────────
  const passwordHash = await bcrypt.hash("IvoireCompta2025!", 10)
  const expert = await prisma.utilisateur.upsert({
    where: { cabinetId_email: { cabinetId: cabinet.id, email: "konan@konan-associes.ci" } },
    update: {},
    create: {
      cabinetId:    cabinet.id,
      nom:          "Konan",
      prenom:       "Koffi",
      email:        "konan@konan-associes.ci",
      passwordHash,
      role:         "EXPERT_COMPTABLE",
      numeroOrdre:  "ONECCA-00142",
    },
  })
  console.log(`✅ Expert-comptable : ${expert.prenom} ${expert.nom}`)

  // ── Collaborateur ──────────────────────────────────────────────
  const collab = await prisma.utilisateur.upsert({
    where: { cabinetId_email: { cabinetId: cabinet.id, email: "collaborateur@konan-associes.ci" } },
    update: {},
    create: {
      cabinetId:    cabinet.id,
      nom:          "Diallo",
      prenom:       "Aminata",
      email:        "collaborateur@konan-associes.ci",
      passwordHash: await bcrypt.hash("Collab2025!", 10),
      role:         "COLLABORATEUR",
    },
  })
  console.log(`✅ Collaborateur : ${collab.prenom} ${collab.nom}`)

  // ── Client 1 — BSCI Sarl ──────────────────────────────────────
  const client1 = await prisma.client.upsert({
    where: { cabinetId_ncc: { cabinetId: cabinet.id, ncc: "CI-2018-00841" } },
    update: {},
    create: {
      cabinetId:        cabinet.id,
      ncc:              "CI-2018-00841",
      nomRaisonSociale: "BSCI Sarl",
      formeJuridique:   "SARL",
      secteurActivite:  "Commerce général",
      regimeImposition: "REEL_NORMAL",
      assujettitTVA:    true,
      email:            "direction@bsci.ci",
      telephone:        "+225 27 22 50 00 00",
      adresseSiege:     "Adjamé, Abidjan",
    },
  })
  console.log(`✅ Client : ${client1.nomRaisonSociale}`)

  // ── Client 2 — Pharmacie Bonheur ──────────────────────────────
  const client2 = await prisma.client.upsert({
    where: { cabinetId_ncc: { cabinetId: cabinet.id, ncc: "CI-2015-00234" } },
    update: {},
    create: {
      cabinetId:        cabinet.id,
      ncc:              "CI-2015-00234",
      nomRaisonSociale: "Pharmacie Bonheur",
      formeJuridique:   "EI",
      secteurActivite:  "Santé",
      regimeImposition: "REEL_SIMPLIFIE",
      assujettitTVA:    false,
      email:            "pharmaciebonheur@gmail.com",
      telephone:        "+225 07 00 00 00 00",
      adresseSiege:     "Cocody, Abidjan",
    },
  })
  console.log(`✅ Client : ${client2.nomRaisonSociale}`)

  // ── Dossier + Exercice 2025 pour BSCI ─────────────────────────
  const dossier = await prisma.dossier.create({
    data: {
      clientId:     client1.id,
      typeMission:  "COMPTABILITE",
      statut:       "EN_COURS",
    },
  })

  const exercice = await prisma.exercice.create({
    data: {
      dossierId: dossier.id,
      annee:     2025,
      dateDebut: new Date("2025-01-01"),
      dateFin:   new Date("2025-12-31"),
      statut:    "OUVERT",
    },
  })
  console.log(`✅ Exercice 2025 créé pour ${client1.nomRaisonSociale}`)

  // ── Journaux comptables ────────────────────────────────────────
  const journaux = [
    { code: "AC", libelle: "Journal des achats",           type: "ACHATS" },
    { code: "VT", libelle: "Journal des ventes",           type: "VENTES" },
    { code: "BQ", libelle: "Journal de banque",            type: "BANQUE" },
    { code: "CA", libelle: "Journal de caisse",            type: "CAISSE" },
    { code: "OD", libelle: "Journal des opérations div.", type: "OPERATIONS_DIVERSES" },
    { code: "SA", libelle: "Journal des salaires",         type: "SALAIRES" },
  ] as const

  for (const j of journaux) {
    await prisma.journal.upsert({
      where: { exerciceId_code: { exerciceId: exercice.id, code: j.code } },
      update: {},
      create: { exerciceId: exercice.id, ...j },
    })
  }
  console.log(`✅ 6 journaux créés`)

  // ── Écritures de test ──────────────────────────────────────────
  const journalAC = await prisma.journal.findFirst({
    where: { exerciceId: exercice.id, code: "AC" },
  })
  const journalVT = await prisma.journal.findFirst({
    where: { exerciceId: exercice.id, code: "VT" },
  })
  const journalBQ = await prisma.journal.findFirst({
    where: { exerciceId: exercice.id, code: "BQ" },
  })

  // Écriture 1 — Achat fournitures
  await prisma.ecriture.create({
    data: {
      exerciceId:    exercice.id,
      journalId:     journalAC!.id,
      saisiParId:    collab.id,
      dateOperation: new Date("2025-01-15"),
      libelle:       "Achat fournitures bureau — Fournisseur BSCI",
      pieceRef:      "FACT-2025-0001",
      statut:        "VALIDEE",
      valideeLe:     new Date(),
      lignes: {
        create: [
          { compteSyscohada: "601100", libelleCompte: "Achats fournitures", debit: 177966, credit: 0, ordre: 0 },
          { compteSyscohada: "445620", libelleCompte: "TVA déductible 18%", debit: 32034,  credit: 0, ordre: 1 },
          { compteSyscohada: "401100", libelleCompte: "Fournisseur BSCI",   debit: 0, credit: 210000, ordre: 2 },
        ],
      },
    },
  })

  // Écriture 2 — Vente marchandises
  await prisma.ecriture.create({
    data: {
      exerciceId:    exercice.id,
      journalId:     journalVT!.id,
      saisiParId:    collab.id,
      dateOperation: new Date("2025-01-20"),
      libelle:       "Vente marchandises — Client Djara SA",
      pieceRef:      "FACT-VT-2025-0001",
      statut:        "VALIDEE",
      valideeLe:     new Date(),
      lignes: {
        create: [
          { compteSyscohada: "411100", libelleCompte: "Client Djara SA",       debit: 590000, credit: 0,      ordre: 0 },
          { compteSyscohada: "701000", libelleCompte: "Ventes marchandises",   debit: 0,      credit: 500000, ordre: 1 },
          { compteSyscohada: "443100", libelleCompte: "TVA collectée 18%",     debit: 0,      credit: 90000,  ordre: 2 },
        ],
      },
    },
  })

  // Écriture 3 — Règlement banque
  await prisma.ecriture.create({
    data: {
      exerciceId:    exercice.id,
      journalId:     journalBQ!.id,
      saisiParId:    collab.id,
      dateOperation: new Date("2025-01-25"),
      libelle:       "Règlement fournisseur BSCI — chèque n°001234",
      pieceRef:      "CHQ-001234",
      statut:        "VALIDEE",
      valideeLe:     new Date(),
      lignes: {
        create: [
          { compteSyscohada: "401100", libelleCompte: "Fournisseur BSCI", debit: 210000, credit: 0,      ordre: 0 },
          { compteSyscohada: "521000", libelleCompte: "Banque SGBCI",     debit: 0,      credit: 210000, ordre: 1 },
        ],
      },
    },
  })
  console.log(`✅ 3 écritures de test créées`)

  // ── Échéances fiscales 2025 ────────────────────────────────────
  const echeances = [
    { type: "TVA_MENSUELLE",  label: "TVA Janvier 2025",    date: new Date("2025-02-15"), periode: "TVA-2025-01" },
    { type: "TVA_MENSUELLE",  label: "TVA Février 2025",    date: new Date("2025-03-15"), periode: "TVA-2025-02" },
    { type: "IS_ACOMPTE_1",   label: "1er acompte IS 2025", date: new Date("2025-04-20"), periode: "IS-ACOMPTE1-2025" },
    { type: "TVA_MENSUELLE",  label: "TVA Mars 2025",       date: new Date("2025-04-15"), periode: "TVA-2025-03" },
    { type: "IS_ACOMPTE_2",   label: "2ème acompte IS 2025",date: new Date("2025-07-20"), periode: "IS-ACOMPTE2-2025" },
    { type: "IS_ACOMPTE_3",   label: "3ème acompte IS 2025",date: new Date("2025-10-20"), periode: "IS-ACOMPTE3-2025" },
    { type: "DSF_ANNUELLE",   label: "DSF Exercice 2025",   date: new Date("2026-04-30"), periode: "DSF-2025" },
    { type: "IS_SOLDE",       label: "Solde IS 2025",       date: new Date("2026-04-30"), periode: "IS-SOLDE-2025" },
  ] as const

  for (const e of echeances) {
    await prisma.echeanceFiscale.create({
      data: {
        clientId:       client1.id,
        typeDeclaration: e.type,
        periodeLabel:   e.periode,
        dateEcheance:   e.date,
        statut:         e.date < new Date() ? "EN_RETARD" : "A_FAIRE",
      },
    })
  }
  console.log(`✅ 8 échéances fiscales créées`)

  // ── Employé + bulletin de test ─────────────────────────────────
  const employe = await prisma.employe.create({
    data: {
      clientId:       client1.id,
      matricule:      "EMP-001",
      nom:            "Ouattara",
      prenom:         "Ibrahim",
      dateEmbauche:   new Date("2022-03-01"),
      categorieCnps:  "Cadre",
      codeCategorie:  "C3",
      salaireBase:    450000,
    },
  })
  console.log(`✅ Employé : ${employe.prenom} ${employe.nom}`)

  console.log("\n✨ Seed terminé avec succès !")
  console.log("\n📋 Identifiants de connexion :")
  console.log("   Expert-comptable : konan@konan-associes.ci / IvoireCompta2025!")
  console.log("   Collaborateur    : collaborateur@konan-associes.ci / Collab2025!")
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
