"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import { getDashboard, getClients } from "@/lib/api"

interface Echeance {
  id: string
  typeDeclaration: string
  periodeLabel: string
  dateEcheance: string
  joursRestants: number
  urgence: "ROUGE" | "ORANGE" | "VERT"
}

interface Client {
  id: string
  nomRaisonSociale: string
  ncc: string
  regimeImposition: string
  assujettitTVA: boolean
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
  const [kpis, setKpis]         = useState<KPIs | null>(null)
  const [echeances, setEcheances] = useState<Echeance[]>([])
  const [clients, setClients]   = useState<Client[]>([])
  const [loading, setLoading]   = useState(true)
  const [user, setUser]         = useState<{ nom: string; prenom: string; role: string; cabinet: { nom: string } } | null>(null)

  useEffect(() => {
    const u = Cookies.get("user")
    if (!u) { router.push("/login"); return }
    setUser(JSON.parse(u))

    Promise.all([getDashboard(), getClients()])
      .then(([dash, cli]) => {
        setKpis(dash.data.kpis)
        setEcheances(dash.data.echeances)
        setClients(cli.data.clients)
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false))
  }, [router])

  function logout() {
    Cookies.remove("token")
    Cookies.remove("user")
    router.push("/login")
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-500 text-sm">Chargement...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-slate-900">IvoireCompta</span>
            <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
              {user?.cabinet?.nom}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.prenom} {user?.nom}</span>
            <button onClick={logout} className="text-sm text-slate-400 hover:text-slate-600">
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Clients actifs",       value: kpis?.nbClients ?? 0,                color: "teal" },
            { label: "Dossiers en cours",    value: kpis?.nbDossiersEnCours ?? 0,        color: "blue" },
            { label: "Échéances proches",    value: kpis?.echeancesProchaines ?? 0,      color: "amber" },
            { label: "Déclarations en retard", value: kpis?.declarationsEnRetard ?? 0,   color: "red" },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className={`text-3xl font-bold mb-1 ${
                k.color === "teal"  ? "text-teal-600"  :
                k.color === "blue"  ? "text-blue-600"  :
                k.color === "amber" ? "text-amber-600" : "text-red-600"
              }`}>{k.value}</div>
              <div className="text-sm text-slate-500">{k.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Échéances */}
          <div className="col-span-2 bg-white rounded-xl border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Échéances fiscales — 30 prochains jours</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {echeances.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-400 text-sm">
                  Aucune échéance dans les 30 prochains jours
                </div>
              ) : echeances.map(e => (
                <div key={e.id} className="px-6 py-4 flex items-center gap-4">
                  <div className={`text-2xl font-bold min-w-[52px] text-center ${
                    e.urgence === "ROUGE"  ? "text-red-600"  :
                    e.urgence === "ORANGE" ? "text-amber-600" : "text-teal-600"
                  }`}>
                    J-{e.joursRestants}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-800">{e.typeDeclaration.replace(/_/g, " ")}</div>
                    <div className="text-xs text-slate-400">{e.periodeLabel} · {new Date(e.dateEcheance).toLocaleDateString("fr-CI")}</div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    e.urgence === "ROUGE"  ? "bg-red-50 text-red-700"    :
                    e.urgence === "ORANGE" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"
                  }`}>
                    {e.urgence === "ROUGE" ? "Urgent" : e.urgence === "ORANGE" ? "Bientôt" : "À venir"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Clients */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Clients</h2>
              <span className="text-xs text-slate-400">{clients.length} actifs</span>
            </div>
            <div className="divide-y divide-slate-100">
              {clients.map(c => (
                <div key={c.id} className="px-6 py-4">
                  <div className="text-sm font-medium text-slate-800">{c.nomRaisonSociale}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{c.ncc}</div>
                  <div className="flex gap-1.5 mt-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {c.regimeImposition.replace(/_/g, " ")}
                    </span>
                    {c.assujettitTVA && (
                      <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded">TVA</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
