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
- Après mise à jour Prisma : `npm run db:push` (depuis la racine ou `apps/api`).

**Champs côté marché CI** : le **n° d’ordre ONECCA** est le plus critique (tenant + visa DSF). Le **RCCM** est recommandé mais peut rester optionnel au MVP. **Secteur / spécialisation** servent surtout au produit (pas imposés par la DGI pour la compta).

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
