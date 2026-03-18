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
export const getEcritures = (params: Record<string, string>) => api.get("/ecritures", { params })
export const getBalance   = (exerciceId: string) => api.get("/ecritures/balance", { params: { exerciceId } })
export const creerEcriture = (data: unknown) => api.post("/ecritures", data)
export const genererDSF   = (exerciceId: string) => api.post("/declarations/dsf/generer", { exerciceId })
