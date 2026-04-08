import axios from "axios"
import Cookies from "js-cookie"

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { "Content-Type": "application/json" },
})

api.interceptors.request.use(config => {
  const token = Cookies.get("token")
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      Cookies.remove("token")
      window.location.href = "/login"
    }
    return Promise.reject(err)
  }
)

export const login = (email: string, password: string) => api.post("/auth/login", { email, password })
export const getMe = () => api.get("/auth/me")
export const patchMe = (data: {
  prenom?: string
  nom?: string
  email?: string
  specialisation?: string | null
  numeroOrdre?: string | null
}) => api.patch("/auth/me", data)
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post("/auth/password", { currentPassword, newPassword })
export const totpSetup = () => api.post("/auth/totp/setup")
export const totpConfirmer = (totpCode: string) => api.post("/auth/totp/confirmer", { totpCode })

export type RegisterPayload = {
  cabinetNom: string
  numeroOrdre: string
  cabinetEmail: string
  cabinetTelephone?: string
  rccm?: string
  adresse?: string
  secteurActivite?: string
  prenom: string
  nom: string
  email: string
  password: string
  expertNumeroOrdre?: string
  specialisation?: string
  ncc?: string
  gestionFacturation?: boolean
}

export const register = (data: RegisterPayload) => api.post("/auth/register", data)
export const getClients = (opts?: { tous?: boolean }) =>
  api.get("/clients", { params: opts?.tous ? { tous: "1" } : undefined })
export const createClient = (data: {
  ncc: string
  nomRaisonSociale: string
  formeJuridique?: string
  regimeImposition?: string
  assujettitTVA?: boolean
  email?: string
  telephone?: string
}) => api.post("/clients", data)
export const updateClient = (
  id: string,
  data: Partial<{
    ncc: string
    nomRaisonSociale: string
    formeJuridique: string
    regimeImposition: string
    assujettitTVA: boolean
    email: string
    telephone: string
    actif: boolean
  }>
) => api.patch(`/clients/${id}`, data)
export const deleteClient = (id: string) => api.delete(`/clients/${id}`)
export const getClient  = (id: string) => api.get(`/clients/${id}`)
/** Dossier + exercice année en cours + journaux (idempotent) */
export const initialiserComptabiliteClient = (id: string) =>
  api.post(`/clients/${id}/initialiser-comptabilite`)
export const getDashboard = () => api.get("/dashboard")
export const getEtatDossier = () => api.get("/dashboard/etat-dossier")
export const getPointsSuspens = (params?: Record<string, string | number>) =>
  api.get("/points-suspens", { params })
export const createPointSuspens = (data: {
  clientId: string
  sujet: string
  description?: string
  type: "ANOMALIE_COMPTABLE" | "PIECE_MANQUANTE" | "DECLARATION" | "BANQUE" | "IMMOBILISATION" | "AUTRE"
  priorite: "HAUTE" | "MOYENNE" | "BASSE"
  statut?: "OUVERT" | "EN_COURS" | "BLOQUE" | "RESOLU"
  responsableUserId?: string | null
  echeance?: string | null
}) => api.post("/points-suspens", data)
export const patchPointSuspens = (
  id: string,
  data: Partial<{
    sujet: string
    description: string
    type: "ANOMALIE_COMPTABLE" | "PIECE_MANQUANTE" | "DECLARATION" | "BANQUE" | "IMMOBILISATION" | "AUTRE"
    priorite: "HAUTE" | "MOYENNE" | "BASSE"
    statut: "OUVERT" | "EN_COURS" | "BLOQUE" | "RESOLU"
    responsableUserId: string | null
    echeance: string | null
  }>
) => api.patch(`/points-suspens/${id}`, data)
export const resoudrePointSuspens = (id: string) => api.post(`/points-suspens/${id}/resoudre`)
export const getPointsSuspensResponsables = () => api.get("/points-suspens/responsables")
export const uploadPiecePointSuspens = (
  id: string,
  data: { nomOriginal: string; mimeType: string; base64: string }
) => api.post(`/points-suspens/${id}/pieces`, data)
export const getPiecesPointSuspens = (id: string) => api.get(`/points-suspens/${id}/pieces`)
export const viewPiecePointSuspens = (pieceId: string) =>
  api.get(`/points-suspens/pieces/${pieceId}/view`, { responseType: "blob" })
export const downloadPiecePointSuspens = (pieceId: string) =>
  api.get(`/points-suspens/pieces/${pieceId}/download`, { responseType: "blob" })
export const deletePiecePointSuspens = (pieceId: string) =>
  api.delete(`/points-suspens/pieces/${pieceId}`)
export const getEcheances = () => api.get("/declarations/echeances")
export const getDeclarationsPilotage = () => api.get("/declarations/pilotage")
export const getHistoriqueDepots = () => api.get("/declarations/historique-depots")
export const previewAlertesEcheances = () => api.get("/declarations/notifications/preview")
export const runAlertesEcheances = () => api.post("/declarations/notifications/run")
export const preparerDepotEcheance = (id: string) => api.post(`/declarations/echeances/${id}/preparer`)
export const deposerEcheance = (id: string, referenceEimpots: string) =>
  api.post(`/declarations/echeances/${id}/deposer`, { referenceEimpots })
export const getEcritures = (params: Record<string, string>) => api.get("/ecritures", { params })
export const getBalance   = (exerciceId: string) => api.get("/ecritures/balance", { params: { exerciceId } })
export const creerEcriture = (data: unknown) => api.post("/ecritures", data)
export const genererDSF   = (exerciceId: string) => api.post("/declarations/dsf/generer", { exerciceId })
export const getDsfParExercice = (exerciceId: string) =>
  api.get(`/declarations/dsf/exercice/${exerciceId}`)
export const marquerDsfPrete = (id: string) => api.post(`/declarations/${id}/prete`)
export const verifierVisaDsf = (totpCode: string) => api.post("/auth/visa/verifier", { totpCode })
export const viserDsf = (id: string, visaToken: string) =>
  api.post(`/declarations/${id}/viser`, { visaToken })
export const deposerDsf = (id: string, referenceEimpots: string) =>
  api.post(`/declarations/${id}/deposer`, { referenceEimpots })
/** DSF déjà déposée : corriger la référence e-impôts */
export const patchDsfReferenceEimpots = (declarationId: string, referenceEimpots: string) =>
  api.patch(`/declarations/${declarationId}/reference-eimpots`, { referenceEimpots })

/** Paie */
export const getPaieEmployes = (clientId: string) =>
  api.get("/paie/employes", { params: { clientId } })
export const createPaieEmploye = (data: {
  clientId: string
  matricule: string
  nom: string
  prenom: string
  dateEmbauche: string
  categorieCnps?: string
  codeCategorie?: string
  salaireBase: number
  primes?: Record<string, number>
  poste?: string | null
  dateNaissance?: string | null
  actif?: boolean
}) => api.post("/paie/employes", data)
export const patchPaieEmploye = (
  id: string,
  data: Partial<{
    matricule: string
    nom: string
    prenom: string
    dateEmbauche: string
    categorieCnps: string
    codeCategorie: string
    salaireBase: number
    primes: Record<string, number>
    poste: string | null
    dateNaissance: string | null
    actif: boolean
  }>
) => api.patch(`/paie/employes/${id}`, data)
export const getPaieSynthese = (clientId: string, mois: number, annee: number) =>
  api.get("/paie/synthese", { params: { clientId, mois, annee } })
export const getPaiePeriode = (clientId: string, mois: number, annee: number) =>
  api.get("/paie/periode", { params: { clientId, mois, annee } })
export const genererBulletinPaie = (data: {
  employeId: string
  mois: number
  annee: number
  primes?: Record<string, number>
}) => api.post("/paie/bulletins/generer", data)
export const postRecapCnps = (clientId: string, mois: number, annee: number) =>
  api.post("/paie/recap-cnps", { clientId, mois, annee })
export const getPaieHistorique = (clientId: string, limit = 60) =>
  api.get("/paie/historique", { params: { clientId, limit } })
export const exportPaieCsv = (clientId: string, mois: number, annee: number) =>
  api.get("/paie/export-csv", { params: { clientId, mois, annee }, responseType: "blob" })

/** Ouverture d'exercice */
export const checkOuvertureExercice = (data: {
  dossierId: string
  exerciceSourceId: string
  anneeCible: number
  dateDebut: string
  dateFin: string
}) => api.post("/exercices/ouverture/check", data)
export const openExercice = (data: {
  dossierId: string
  exerciceSourceId: string
  anneeCible: number
  dateDebut: string
  dateFin: string
  options: {
    reprendreSoldesGeneraux: boolean
    reprendreSoldesAuxiliaires: boolean
    creerANouveaux: boolean
  }
}) => api.post("/exercices/ouverture", data)
export const cloturerExercice = (exerciceId: string) =>
  api.post(`/exercices/${exerciceId}/cloturer`)

/** Journaux */
export const getJournauxConfig = (exerciceId: string) =>
  api.get("/journaux", { params: { exerciceId } })
export const patchJournalConfig = (
  id: string,
  data: Partial<{
    actif: boolean
    rules: {
      pieceObligatoire: boolean
      libelleObligatoire: boolean
      interdireMontantNul: boolean
      autoriserBrouillon: boolean
      comptesAutorisesUniquement: boolean
      comptesAutorises: string[]
    }
  }>
) => api.patch(`/journaux/${id}/config`, data)
export const verrouillerJournal = (id: string, periodLabel: string) =>
  api.post(`/journaux/${id}/verrouiller`, { periodLabel })
export const deverrouillerJournal = (id: string) =>
  api.post(`/journaux/${id}/deverrouiller`)
export const getJournalHistorique = (id: string) =>
  api.get(`/journaux/${id}/historique`)

/** Rapprochement bancaire */
export const getRapprochementBancaire = (params: Record<string, string>) =>
  api.get("/rapprochement-bancaire", { params })
export const importerMouvementsBancairesCsv = (data: {
  clientId: string
  exerciceId: string
  rows: Array<{
    dateOperation: string
    libelle: string
    reference?: string
    debit: number
    credit: number
    solde?: number
  }>
}) => api.post("/rapprochement-bancaire/import-csv", data)
export const autoMatchRapprochementBancaire = (data: { exerciceId: string; du?: string; au?: string }) =>
  api.post("/rapprochement-bancaire/auto-match", data)
export const rapprocherMouvementBancaire = (data: {
  mouvementId: string
  ecritureId: string
  montant?: number
  commentaire?: string
}) => api.post("/rapprochement-bancaire/match", data)
export const dissocierMouvementBancaire = (mouvementId: string) =>
  api.post(`/rapprochement-bancaire/unmatch/${mouvementId}`)
export const ignorerMouvementBancaire = (mouvementId: string, motif: string) =>
  api.post(`/rapprochement-bancaire/ignore/${mouvementId}`, { motif })
export const validerRapprochementMois = (data: { exerciceId: string; du: string; au: string }) =>
  api.post("/rapprochement-bancaire/valider-mois", data)
export const deverrouillerRapprochementMois = (data: { exerciceId: string; du: string; au: string }) =>
  api.post("/rapprochement-bancaire/deverrouiller-mois", data)

/** Clôture mensuelle */
export const getClotureMensuelle = (params: { exerciceId: string; mois: number; annee: number }) =>
  api.get("/cloture-mensuelle", { params })
export const validerClotureMensuelle = (data: {
  exerciceId: string
  mois: number
  annee: number
  commentaire: string
  confirmation: boolean
}) => api.post("/cloture-mensuelle/valider", data)
export const soumettreClotureMensuelle = (data: {
  exerciceId: string
  mois: number
  annee: number
  commentaire?: string
}) => api.post("/cloture-mensuelle/soumettre-revue", data)
export const approuverClotureMensuelle = (data: {
  exerciceId: string
  mois: number
  annee: number
  commentaire?: string
}) => api.post("/cloture-mensuelle/approuver", data)
export const rejeterClotureMensuelle = (data: {
  exerciceId: string
  mois: number
  annee: number
  commentaire?: string
}) => api.post("/cloture-mensuelle/rejeter", data)
export const deverrouillerClotureMensuelle = (data: { exerciceId: string; mois: number; annee: number }) =>
  api.post("/cloture-mensuelle/deverrouiller", data)

/** TVA */
export const getTvaMensuelle = (params: { exerciceId: string; mois: number; annee: number }) =>
  api.get("/tva", { params })
export const validerTvaMensuelle = (data: { exerciceId: string; mois: number; annee: number }) =>
  api.post("/tva/valider", data)
export const deverrouillerTvaMensuelle = (data: { exerciceId: string; mois: number; annee: number }) =>
  api.post("/tva/deverrouiller", data)
export const deposerTvaMensuelle = (data: {
  exerciceId: string
  mois: number
  annee: number
  referenceEimpots: string
}) => api.post("/tva/deposer", data)

/** Immobilisations */
export const getImmobilisations = (params: Record<string, string>) => api.get("/immobilisations", { params })
export const getImmobilisation = (id: string) => api.get(`/immobilisations/${id}`)
export const createImmobilisation = (data: {
  clientId: string
  exerciceId: string
  reference: string
  libelle: string
  categorie: "MATERIEL" | "VEHICULE" | "LOGICIEL" | "MOBILIER" | "BATIMENT" | "AUTRE"
  fournisseur?: string
  compteImmobilisation: string
  compteAmortissement: string
  dateAcquisition: string
  dateMiseEnService: string
  valeurOrigine: number
  valeurResiduelle?: number
  dureeAnnees: number
  methodeAmortissement?: "LINEAIRE" | "DEGRESSIF"
  notes?: string
}) => api.post("/immobilisations", data)
export const patchImmobilisation = (
  id: string,
  data: Partial<{
    reference: string
    libelle: string
    categorie: "MATERIEL" | "VEHICULE" | "LOGICIEL" | "MOBILIER" | "BATIMENT" | "AUTRE"
    fournisseur: string
    compteImmobilisation: string
    compteAmortissement: string
    dateAcquisition: string
    dateMiseEnService: string
    valeurOrigine: number
    valeurResiduelle: number
    dureeAnnees: number
    methodeAmortissement: "LINEAIRE" | "DEGRESSIF"
    notes: string
    statut: "EN_SERVICE" | "CEDEE"
  }>
) => api.patch(`/immobilisations/${id}`, data)
export const sortirImmobilisation = (id: string, dateSortie: string) =>
  api.post(`/immobilisations/${id}/sortir`, { dateSortie })

/** Facturation */
export const getFactures = (params: Record<string, string>) => api.get("/facturation", { params })
export const createFacture = (data: {
  clientId: string
  dateEmission: string
  dateEcheance: string
  numero?: string
  notes?: string
  tvaTaux?: number
  statut?: "BROUILLON" | "EMISE"
  lignes: Array<{ description: string; quantite: number; prixUnitaireHt: number }>
}) => api.post("/facturation", data)
export const addPaiementFacture = (
  factureId: string,
  data: {
    datePaiement: string
    montant: number
    modePaiement: "VIREMENT" | "CHEQUE" | "ESPECES" | "MOBILE_MONEY"
    reference?: string
    commentaire?: string
  }
) => api.post(`/facturation/${factureId}/paiements`, data)
export const createAvoirFacture = (
  factureId: string,
  data?: { lignes: Array<{ ordre: number; quantite: number }> }
) => api.post(`/facturation/${factureId}/avoir`, data)
export const getFacturePdfData = (factureId: string) => api.get(`/facturation/${factureId}/pdf`)
export const previewRelancesFactures = (params?: { clientId?: string }) =>
  api.get("/facturation/relances/preview", { params })
export const runRelancesFactures = (data: {
  factureIds: string[]
  canal?: "EMAIL" | "WHATSAPP" | "MANUEL"
}) => api.post("/facturation/relances/run", data)
export const getDevis = (params: Record<string, string>) => api.get("/facturation/devis", { params })
export const createDevis = (data: {
  clientId: string
  dateEmission: string
  dateValidite: string
  numero?: string
  notes?: string
  tvaTaux?: number
  statut?: "BROUILLON" | "ENVOYE" | "ACCEPTE" | "REFUSE"
  lignes: Array<{ description: string; quantite: number; prixUnitaireHt: number }>
}) => api.post("/facturation/devis", data)
export const convertirDevisEnFacture = (devisId: string) =>
  api.post(`/facturation/devis/${devisId}/convertir`)
export const setStatutDevis = (
  devisId: string,
  statut: "ACCEPTE" | "REFUSE" | "ENVOYE" | "BROUILLON"
) => api.post(`/facturation/devis/${devisId}/statut`, { statut })
