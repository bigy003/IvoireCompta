/**
 * Extrait plan comptable SYSCOHADA CI — comptes les plus utilisés en saisie.
 * (MVP : compléter avec import officiel ou API plus tard.)
 */
export type ComptePlan = { numero: string; libelle: string; classe: string }

export const PLAN_COMPTES_CI: ComptePlan[] = [
  { classe: "Classe 4 — Tiers", numero: "401100", libelle: "Fournisseurs — dettes" },
  { classe: "Classe 4 — Tiers", numero: "408100", libelle: "Fournisseurs — factures non parvenues" },
  { classe: "Classe 4 — Tiers", numero: "411100", libelle: "Clients — créances" },
  { classe: "Classe 4 — Tiers", numero: "418100", libelle: "Clients — produits non encore facturés" },
  { classe: "Classe 4 — Tiers", numero: "421000", libelle: "Personnel — rémunérations dues" },
  { classe: "Classe 4 — Tiers", numero: "431000", libelle: "Sécurité sociale — autres organismes" },
  { classe: "Classe 4 — Tiers", numero: "442000", libelle: "Prélèvement à la source — impôt sur le revenu" },
  { classe: "Classe 4 — Tiers", numero: "443100", libelle: "TVA collectée (État)" },
  { classe: "Classe 4 — Tiers", numero: "445620", libelle: "TVA déductible sur achats" },
  { classe: "Classe 4 — Tiers", numero: "445660", libelle: "TVA déductible — autres biens et services" },
  { classe: "Classe 5 — Trésorerie", numero: "511000", libelle: "Banques — comptes en monnaie nationale" },
  { classe: "Classe 5 — Trésorerie", numero: "521000", libelle: "Banques — comptes en monnaie nationale (détail)" },
  { classe: "Classe 5 — Trésorerie", numero: "531000", libelle: "Caisse siège social" },
  { classe: "Classe 5 — Trésorerie", numero: "581000", libelle: "Virements internes" },
  { classe: "Classe 6 — Charges", numero: "601100", libelle: "Achats de matières premières et fournitures" },
  { classe: "Classe 6 — Charges", numero: "602000", libelle: "Achats d’autres approvisionnements" },
  { classe: "Classe 6 — Charges", numero: "606100", libelle: "Fournitures non stockables (eau, énergie…)" },
  { classe: "Classe 6 — Charges", numero: "611000", libelle: "Transports sur achats" },
  { classe: "Classe 6 — Charges", numero: "613000", libelle: "Locations et charges locatives" },
  { classe: "Classe 6 — Charges", numero: "622000", libelle: "Rémunérations d’intermédiaires et honoraires" },
  { classe: "Classe 6 — Charges", numero: "625100", libelle: "Voyages et déplacements" },
  { classe: "Classe 6 — Charges", numero: "626000", libelle: "Frais postaux et télécommunications" },
  { classe: "Classe 6 — Charges", numero: "631000", libelle: "Frais du personnel extérieur à l’entité" },
  { classe: "Classe 6 — Charges", numero: "641000", libelle: "Rémunérations du personnel" },
  { classe: "Classe 6 — Charges", numero: "661000", libelle: "Frais financiers — intérêts des emprunts" },
  { classe: "Classe 7 — Produits", numero: "701000", libelle: "Ventes de marchandises" },
  { classe: "Classe 7 — Produits", numero: "706000", libelle: "Prestations de services" },
  { classe: "Classe 7 — Produits", numero: "707000", libelle: "Ventes de produits fabriqués" },
  { classe: "Classe 2 — Immobilisations", numero: "244000", libelle: "Matériel de bureau et informatique" },
  { classe: "Classe 1 — Capitaux", numero: "101300", libelle: "Capital souscrit — appelé, versé" },
  { classe: "Classe 1 — Capitaux", numero: "129000", libelle: "Résultat en instance d’affectation" },
  { classe: "Classe 1 — Capitaux", numero: "131000", libelle: "Résultat net : bénéfice" },
]

const byNumero = new Map(PLAN_COMPTES_CI.map(c => [c.numero, c]))

export function libelleCompteDefaut(numero: string): string {
  return byNumero.get(numero)?.libelle ?? ""
}
