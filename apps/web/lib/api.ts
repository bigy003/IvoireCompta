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
export const getEcheances = () => api.get("/declarations/echeances")
export const getDeclarationsPilotage = () => api.get("/declarations/pilotage")
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
