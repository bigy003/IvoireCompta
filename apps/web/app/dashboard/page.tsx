"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import { getDashboard, getClients } from "@/lib/api"
import Layout from "@/components/layout"

interface Client {
  id: string
  nomRaisonSociale: string
  ncc: string
  regimeImposition: string
  assujettitTVA: boolean
}

interface Echeance {
  id: string
  typeDeclaration: string
  periodeLabel: string
  dateEcheance: string
  joursRestants: number
  urgence: "ROUGE" | "ORANGE" | "VERT"
}

interface KPIs {
  nbClients: number
  nbDossiersEnCours: number
  declarationsEnRetard: number
  declarationsDeposeesMois: number
  echeancesProchaines: number
}

export default function DashboardPage() {
  const router = useRouter()
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [echeances, setEcheances] = useState<Echeance[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!Cookies.get("token")) { router.push("/login"); return }
    Promise.all([getDashboard(), getClients()])
      .then(([dash, cli]) => {
        setKpis(dash.data.kpis)
        setEcheances(dash.data.echeances)
        setClients(cli.data.clients)
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false))
  }, [router])

  if (loading) return (
    <Layout>
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-400 text-sm">Chargement...</div>
      </div>
    </Layout>
  )

  return (
    <Layout>
      <div
        className="min-h-screen"
        style={{
          backgroundImage: "url('/images/Background.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-8">

          {/* Titre + filtres */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Tableau de Bord</h1>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Ce Mois-ci
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Tous les Comptes
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-5 mb-8">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </div>
                <span className="text-sm text-gray-500">Clients actifs</span>
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">{kpis?.nbClients ?? 0}</div>
              <div className="text-xs text-green-600">Cabinet actif</div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                <span className="text-sm text-gray-500">Dossiers en cours</span>
              </div>
              <div className="text-3xl font-bold text-orange-500 mb-1">{kpis?.nbDossiersEnCours ?? 0}</div>
              <div className="text-xs text-gray-400">Missions actives</div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <span className="text-sm text-gray-500">Échéances proches</span>
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">{kpis?.echeancesProchaines ?? 0}</div>
              <div className="text-xs text-gray-400">30 prochains jours</div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <span className="text-sm text-gray-500">Déclarations en retard</span>
              </div>
              <div className="text-3xl font-bold text-red-500 mb-1">{kpis?.declarationsEnRetard ?? 0}</div>
              <div className="text-xs text-red-400">À régulariser</div>
            </div>
          </div>

          {/* Contenu principal */}
          <div className="grid grid-cols-3 gap-6">

            {/* Colonne gauche */}
            <div className="col-span-1">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-gray-800">Clients</h2>
                  <span className="text-xs text-gray-400">{clients.length} actifs</span>
                </div>
                <div className="space-y-3">
                  {clients.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                      <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-orange-600 font-semibold text-sm">{c.nomRaisonSociale[0]}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{c.nomRaisonSociale}</div>
                        <div className="text-xs text-gray-400">{c.ncc}</div>
                      </div>
                      {c.assujettitTVA && (
                        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">TVA</span>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => router.push("/ecritures")}
                  className="mt-4 w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  + Nouvelle écriture
                </button>
              </div>

              {/* Contact & Aide */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="font-semibold text-gray-800 mb-4">Contact & Aide</h2>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 cursor-pointer">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-orange-700">Modèles d'écriture</span>
                  </div>
                  <div className="text-xs text-gray-500 px-1">Vérifiez vos comptes avant d'enregistrer</div>
                  <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer">
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-700">Support</span>
                  </div>
                  <div className="px-1">
                    <span className="text-xs text-gray-500">+225 07 22 33 44 55</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 cursor-pointer">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-orange-700">Envoyer un Message</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Colonne droite */}
            <div className="col-span-2 space-y-6">

              {/* Échéances fiscales */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-gray-800">Échéances fiscales</h2>
                  <span className="text-xs text-gray-400">30 prochains jours</span>
                </div>
                {echeances.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Aucune échéance dans les 30 prochains jours
                  </div>
                ) : (
                  <div className="space-y-3">
                    {echeances.map(e => (
                      <div key={e.id} className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          e.urgence === "ROUGE" ? "bg-red-50" : e.urgence === "ORANGE" ? "bg-orange-50" : "bg-green-50"
                        }`}>
                          <span className={`text-sm font-bold ${
                            e.urgence === "ROUGE" ? "text-red-600" : e.urgence === "ORANGE" ? "text-orange-600" : "text-green-600"
                          }`}>J-{e.joursRestants}</span>
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-800">{e.typeDeclaration.replace(/_/g, " ")}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{e.periodeLabel} · {new Date(e.dateEcheance).toLocaleDateString("fr-CI")}</div>
                        </div>
                        <span className={`text-xs font-medium px-3 py-1 rounded-full ${
                          e.urgence === "ROUGE" ? "bg-red-50 text-red-600" : e.urgence === "ORANGE" ? "bg-orange-50 text-orange-600" : "bg-green-50 text-green-600"
                        }`}>
                          {e.urgence === "ROUGE" ? "Urgent" : e.urgence === "ORANGE" ? "Bientôt" : "À venir"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Récapitulatif mensuel */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-gray-800">Récapitulatif Mensuel</h2>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-green-50">
                    <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">Envoyer les factures aux clients</div>
                      <div className="text-xs text-gray-400 mt-0.5">Ce mois-ci</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50">
                    <div className="w-7 h-7 rounded-lg bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">Déclarations en attente</div>
                      <div className="text-xs text-gray-400 mt-0.5">Vérifier les échéances</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-orange-50">
                    <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">Déclaration TVA</div>
                      <div className="text-xs text-gray-400 mt-0.5">Préparer et soumettre avant le 15</div>
                    </div>
                  </div>
                </div>
                <button className="mt-4 text-sm text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1">
                  Voir toutes les Tâches & Alertes
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}