# IvoireCompta

> Le premier logiciel SaaS de gestion comptable conçu pour les experts-comptables de Côte d'Ivoire.
> SYSCOHADA révisé · 9 tableaux DGI-CI · e-impôts · CNPS · Offline-first

---

## Architecture

```
ivoirecompta/
├── apps/
│   ├── api/               # Backend Fastify + Prisma (port 4000)
│   │   ├── prisma/
│   │   │   └── schema.prisma   ← Modèle de données complet
│   │   └── src/
│   │       ├── index.ts        ← Point d'entrée API
│   │       └── routes/
│   │           ├── auth.ts
│   │           ├── clients.ts
│   │           ├── ecritures.ts    ← Saisie comptable SYSCOHADA
│   │           ├── declarations.ts ← DSF + visa électronique
│   │           ├── paie.ts         ← CNPS + ITS
│   │           └── dashboard.ts    ← Tableau de bord deadlines
│   └── web/               # Frontend Next.js 14 PWA (port 3000)
│       └── src/
│           ├── app/           ← App Router Next.js
│           ├── components/    ← Composants UI
│           └── lib/           ← Hooks, utils
└── packages/
    └── fiscal-engine/         ← Moteur de calculs CI (partagé)
        └── src/
            ├── tva.ts              ← Calculs TVA 18% CI
            ├── is-imf.ts           ← IS 25% / IMF 0,5% MIN 3M FCFA
            ├── its-cnps.ts         ← Barème ITS + taux CNPS 2024
            ├── dsf-tableaux.ts     ← Générateurs T01–T09 DGI-CI
            ├── calendrier-fiscal.ts ← Échéances auto par régime
            └── fiscal-engine.test.ts ← 16 tests unitaires
```

## Prérequis

- Node.js >= 20
- npm >= 10
- Docker & Docker Compose (pour la base de données locale)

## Inscription

- **Web** : `/inscription` — parcours 4 étapes (type cabinet / expert, infos cabinet, compte expert, confirmation).
- **API** : `POST /auth/register` (public). `ncc` = NIF (N° contribuable DGI), optionnel sauf si `gestionFacturation: true`. Champs optionnels : `rccm`, `adresse`, `secteurActivite`, etc.
- **Paramètres** : `/parametres` — profil + cabinet (lecture), configuration **2FA TOTP** (experts-comptables). `GET /auth/me` (JWT).
- **DSF & Déclarations** : `/dsf` — échéances, KPIs, **Générer DSF**, **Voir tableaux** → `/dsf/tableaux/[exerciceId]` (T07–T09). `GET /declarations/pilotage`, `POST /declarations/dsf/generer`, `GET /declarations/dsf/exercice/:exerciceId`.
- **Paie** : `/paie` — salariés par client (CRUD), bulletins mensuels CNPS/ITS, récap CNPS. Après `npm run db:push`, colonne `poste` sur `employes` : `GET/POST/PATCH /paie/employes`, `GET /paie/synthese`, `GET /paie/periode`, `POST /paie/bulletins/generer`.
- Après mise à jour Prisma : `npm run db:push` (depuis la racine ou `apps/api`).

### Workflow DSF (MVP)

- **1. Générer** : depuis `/dsf`, action **Générer DSF** sur une ligne `DSF-AAAA` (nécessite des écritures `VALIDEE`).
- **2. Consulter** : page `/dsf/tableaux/[exerciceId]` (T07, T08, T09) + export PDF.
- **3. Marquer prête** : `POST /declarations/:id/prete` (statut `PRETE`).
- **4. Viser** : `POST /auth/visa/verifier` (TOTP) puis `POST /declarations/:id/viser` (statut `VISEE`).
- **5. Déposer** : `POST /declarations/:id/deposer` avec `referenceEimpots` (statut `DEPOSEE` + échéance DSF marquée `FAITE`).

> Développement local : un bypass visa est autorisé avec le code `000000` (ou `DEV_VISA_BYPASS_CODE`). Désactivé en production.

**Champs côté marché CI** : le **n° d’ordre ONECCA** est le plus critique (tenant + visa DSF). Le **RCCM** est recommandé mais peut rester optionnel au MVP. **Secteur / spécialisation** servent surtout au produit (pas imposés par la DGI pour la compta).

### Clients & comptabilité (MVP)

- **`POST /clients`** (auth) : crée le client **et** en transaction un dossier « Comptabilité », un **exercice pour l’année civile en cours** (01/01–31/12, ouvert) et les **6 journaux** (AC, VT, BQ, CA, OD, SA), comme le seed BSCI.
- **`POST /clients/:id/initialiser-comptabilite`** (auth, idempotent) : pour les clients créés avant cette logique — complète dossier / exercice année en cours / journaux. La page **Écritures** l’appelle automatiquement si besoin.
- **`PATCH /clients/:id`** (auth) : mise à jour des infos (NCC, raison sociale, forme, régime, TVA, e-mail, téléphone).
- **`DELETE /clients/:id`** (auth) : désactive le client (`actif: false`) — il disparaît de la liste ; historique comptable conservé.
- **`GET /clients?tous=1`** : inclut les clients inactifs (sinon seulement `actif: true`, ex. liste déroulante Écritures).
- **`PATCH /clients/:id`** : peut inclure `actif: true` pour réactiver un client.

## Démarrage en développement

```bash
# 1. Cloner et installer les dépendances
git clone https://github.com/votre-org/ivoirecompta
cd ivoirecompta
npm install

# 2. Variables d'environnement
cp .env.example apps/api/.env
# Éditer apps/api/.env avec vos valeurs

# 3. Démarrer PostgreSQL et Redis
docker-compose -f docker-compose.dev.yml up -d

# 4. Initialiser la base de données
npm run db:push

# 4bis. (Recommandé) Données de démo : cabinet Konan, BSCI, exercice 2025, journaux, écritures test
npm run db:seed

# 5. Démarrer tous les services
npm run dev
```

L'API sera disponible sur `http://localhost:4000`
Le frontend sur `http://localhost:3000`

## Tests

```bash
# Tests du moteur fiscal (16 tests)
cd packages/fiscal-engine && npm test

# Tous les tests
npm test
```

## Règles métier clés

### TVA (tva.ts)
- Taux standard : **18%**
- Déclaration mensuelle, échéance le **15 du mois suivant**
- Pénalité retard : **25% du montant dû** (min. 100 000 FCFA) + 1%/mois

### IS / IMF (is-imf.ts)
- IS standard : **25%** du bénéfice fiscal
- IMF : **0,5% du CA HT** avec plancher de **3 000 000 FCFA**
- Impôt dû = **MAX(IS, IMF)** — l'IMF est toujours dû même en déficit
- 3 acomptes : 20 avril, 20 juillet, 20 octobre

### ITS Barème progressif (its-cnps.ts)
```
0 – 75 000 FCFA/mois    →  0%
75 001 – 240 000         → 16%
240 001 – 800 000        → 21%
> 800 000                → 24%
```
- Abattement frais professionnels : **15%** du salaire brut
- Abattement par enfant : **500 FCFA/mois** (max 6 enfants)

### CNPS (its-cnps.ts)
- Retraite employeur : **7,7%**
- Prestations familiales : **5,75%**
- Retraite salarié : **3,2%**
- Plafond cotisable : **1 647 315 FCFA/mois**

### 9 Tableaux DGI-CI (dsf-tableaux.ts)
```
T01 — Relevé des amortissements
T02 — Relevé des provisions
T03 — État des créances et dettes
T04 — Filiales et participations
T05 — Charges de personnel
T06 — Rémunérations des dirigeants
T07 — Tableau de passage résultat fiscal  ← CRITIQUE
T08 — Calcul IS / IMF                     ← CRITIQUE
T09 — Situation fiscale d'ensemble
```

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, PWA |
| Backend | Node.js, Fastify, TypeScript |
| ORM | Prisma 5 |
| Base de données | PostgreSQL 16 (Row-Level Security) |
| Cache / Jobs | Redis + BullMQ |
| Infrastructure | AWS Lagos (af-south-1) |
| Auth | JWT + 2FA TOTP (visa expert-comptable) |
| Paiements CI | CinetPay, Orange Money, Wave |
| Notifications | SendGrid + WhatsApp Business API |

## Contacts

- **Produit** : contact@ivoirecompta.ci
- **Site** : www.ivoirecompta.ci
# IvoireCompta
