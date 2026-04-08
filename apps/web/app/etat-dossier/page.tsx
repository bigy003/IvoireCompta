"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { getEtatDossier } from "@/lib/api"

type Niveau = "EN_BONNE_SANTE" | "A_RISQUE" | "EN_RETARD" | "CLOTURE"
type DsfStatut = "A_JOUR" | "EN_PREPARATION" | "RETARD_DSF" | "NON_DEMARRE"

type EtatRow = {
  clientId: string
  clientNom: string
  clientNcc: string
  dossierId: string
  dossierStatut: string
  statutGlobal: Niveau
  ecrituresBrouillon: number
  echeancesProches: number
  declarationsRetard: number
  dsfStatut: DsfStatut
  derniereActivite: string | null
}

type ActionReco = {
  clientId: string
  clientNom: string
  motif: string
  niveau: Niveau
}

type EtatDossierResponse = {
  kpis: {
    bonneSante: number
    aRisque: number
    enRetard: number
    echeances7j: number
    declarationsRetard: number
  }
  rows: EtatRow[]
  actionsRecommandees: ActionReco[]
}

const emptyData: EtatDossierResponse = {
  kpis: { bonneSante: 0, aRisque: 0, enRetard: 0, echeances7j: 0, declarationsRetard: 0 },
  rows: [],
  actionsRecommandees: [],
}

const NIVEAU_LABEL: Record<Niveau, string> = {
  EN_BONNE_SANTE: "En bonne santé",
  A_RISQUE: "À risque",
  EN_RETARD: "En retard",
  CLOTURE: "Clôturé",
}

const NIVEAU_CLASS: Record<Niveau, string> = {
  EN_BONNE_SANTE: "bg-emerald-100 text-emerald-800",
  A_RISQUE: "bg-amber-100 text-amber-800",
  EN_RETARD: "bg-red-100 text-red-800",
  CLOTURE: "bg-gray-200 text-gray-700",
}

const DSF_LABEL: Record<DsfStatut, string> = {
  A_JOUR: "À jour",
  EN_PREPARATION: "En préparation",
  RETARD_DSF: "Retard DSF",
  NON_DEMARRE: "Non démarré",
}

const DSF_CLASS: Record<DsfStatut, string> = {
  A_JOUR: "bg-emerald-100 text-emerald-800",
  EN_PREPARATION: "bg-blue-100 text-blue-800",
  RETARD_DSF: "bg-red-100 text-red-800",
  NON_DEMARRE: "bg-gray-100 text-gray-700",
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function csvCell(v: string | number) {
  return `"${String(v).replace(/"/g, '""')}"`
}

type ActionId = "ECRITURES" | "DSF" | "BAL_GL"

function actionPrincipale(row: EtatRow): ActionId {
  if (row.declarationsRetard > 0 || row.dsfStatut === "RETARD_DSF" || row.dsfStatut === "EN_PREPARATION") {
    return "DSF"
  }
  if (row.ecrituresBrouillon > 0) return "ECRITURES"
  if (row.echeancesProches > 0) return "DSF"
  return "BAL_GL"
}

export default function EtatDossierPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [data, setData] = useState<EtatDossierResponse>(emptyData)

  const [clientFilter, setClientFilter] = useState("")
  const [statutFilter, setStatutFilter] = useState<"" | Niveau>("")
  const [search, setSearch] = useState("")

  async function load() {
    setLoading(true)
    setErr("")
    try {
      const r = await getEtatDossier()
      setData((r.data ?? emptyData) as EtatDossierResponse)
    } catch {
      setErr("Impossible de charger l'état du dossier.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
    void load()
  }, [router])

  const clientOptions = useMemo(
    () =>
      Array.from(
        new Map(data.rows.map(r => [r.clientId, { id: r.clientId, nom: r.clientNom }])).values()
      ).sort((a, b) => a.nom.localeCompare(b.nom)),
    [data.rows]
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.rows.filter(r => {
      if (clientFilter && r.clientId !== clientFilter) return false
      if (statutFilter && r.statutGlobal !== statutFilter) return false
      if (!q) return true
      return (
        r.clientNom.toLowerCase().includes(q) ||
        r.clientNcc.toLowerCase().includes(q) ||
        DSF_LABEL[r.dsfStatut].toLowerCase().includes(q)
      )
    })
  }, [data.rows, clientFilter, statutFilter, search])

  function exportCsv() {
    const header = [
      "Client",
      "Numéro contribuable (NCC)",
      "Statut global",
      "Écritures brouillon",
      "Échéances proches",
      "Déclarations en retard",
      "DSF",
      "Dernière activité",
    ]
    const lines = [
      header.map(csvCell).join(";"),
      ...rows.map(r =>
        [
          r.clientNom,
          r.clientNcc,
          NIVEAU_LABEL[r.statutGlobal],
          r.ecrituresBrouillon,
          r.echeancesProches,
          r.declarationsRetard,
          DSF_LABEL[r.dsfStatut],
          fmtDateTime(r.derniereActivite),
        ]
          .map(csvCell)
          .join(";")
      ),
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "etat_dossier.csv"
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-600">Chargement…</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">État du dossier</h1>
            <p className="text-sm text-gray-500 mt-1">Suivi global par client et priorisation des actions</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50"
            >
              Exporter
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600"
            >
              Actualiser
            </button>
          </div>
        </div>

        {err && <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-3 sm:p-4 mb-4 flex flex-col lg:flex-row gap-2">
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white min-w-[220px]"
          >
            <option value="">Sélectionner un client</option>
            {clientOptions.map(c => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
          <select
            value={statutFilter}
            onChange={e => setStatutFilter(e.target.value as "" | Niveau)}
            className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white min-w-[180px]"
          >
            <option value="">Tous les statuts</option>
            <option value="EN_BONNE_SANTE">En bonne santé</option>
            <option value="A_RISQUE">À risque</option>
            <option value="EN_RETARD">En retard</option>
            <option value="CLOTURE">Clôturé</option>
          </select>
          <input
            type="search"
            placeholder="Rechercher (client, n° contribuable / NCC)…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Dossiers en bonne santé</p>
            <p className="text-3xl font-bold text-emerald-600 mt-1 tabular-nums">{data.kpis.bonneSante}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Dossiers à risque</p>
            <p className="text-3xl font-bold text-amber-600 mt-1 tabular-nums">{data.kpis.aRisque}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Déclarations en retard</p>
            <p className="text-3xl font-bold text-red-600 mt-1 tabular-nums">{data.kpis.declarationsRetard}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Échéances ≤ 7 jours</p>
            <p className="text-3xl font-bold text-blue-600 mt-1 tabular-nums">{data.kpis.echeances7j}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm text-gray-500">Dossiers en retard</p>
            <p className="text-3xl font-bold text-red-700 mt-1 tabular-nums">{data.kpis.enRetard}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
          <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden">
            {loading ? (
              <div className="p-10 text-center text-gray-500">Chargement…</div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-gray-500 text-sm">Aucun dossier à afficher.</div>
            ) : (
              <div className="overflow-x-auto hide-scrollbar">
                <table className="w-full text-sm min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Statut global</th>
                      <th className="px-4 py-3">Écritures brouillon</th>
                      <th className="px-4 py-3">Échéances proches</th>
                      <th className="px-4 py-3">Déclarations en retard</th>
                      <th className="px-4 py-3">DSF</th>
                      <th className="px-4 py-3">Dernière activité</th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map(r => (
                      <tr key={r.dossierId} className="hover:bg-gray-50/60">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-gray-900">{r.clientNom}</p>
                          <p className="text-xs text-gray-500">N° contribuable (NCC) : {r.clientNcc}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${NIVEAU_CLASS[r.statutGlobal]}`}>
                            {NIVEAU_LABEL[r.statutGlobal]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-gray-100 px-2 font-semibold">
                            {r.ecrituresBrouillon}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-blue-100 text-blue-800 px-2 font-semibold">
                            {r.echeancesProches}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-red-100 text-red-800 px-2 font-semibold">
                            {r.declarationsRetard}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${DSF_CLASS[r.dsfStatut]}`}>
                            {DSF_LABEL[r.dsfStatut]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-600">{fmtDateTime(r.derniereActivite)}</td>
                        <td className="px-4 py-2.5">
                          {(() => {
                            const primary = actionPrincipale(r)
                            const primaryClass =
                              "px-2.5 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 whitespace-nowrap"
                            const secondaryClass =
                              "px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:border-orange-300 hover:text-orange-700 whitespace-nowrap"
                            return (
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                <Link
                                  href={`/ecritures?client=${r.clientId}`}
                                  className={primary === "ECRITURES" ? primaryClass : secondaryClass}
                                >
                                  Écritures
                                </Link>
                                <Link href="/dsf" className={primary === "DSF" ? primaryClass : secondaryClass}>
                                  DSF
                                </Link>
                                <Link href="/bal-gl" className={primary === "BAL_GL" ? primaryClass : secondaryClass}>
                                  BAL | GL
                                </Link>
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-4">
              <h3 className="font-bold text-gray-900 mb-3">Actions recommandées aujourd’hui</h3>
              {data.actionsRecommandees.length === 0 ? (
                <p className="text-sm text-gray-500">Aucune action critique détectée.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.actionsRecommandees.slice(0, 6).map((a, i) => (
                    <li key={`${a.clientId}-${i}`} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">{a.clientNom}</p>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${NIVEAU_CLASS[a.niveau]}`}>
                          {a.niveau === "EN_RETARD" ? "Urgent" : "Risque"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{a.motif}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-4">
              <h3 className="font-bold text-gray-900 mb-3">Légende</h3>
              <ul className="space-y-2 text-sm">
                {(["EN_BONNE_SANTE", "A_RISQUE", "EN_RETARD", "CLOTURE"] as Niveau[]).map(s => (
                  <li key={s} className="flex items-center gap-2 text-gray-700">
                    <span className={`h-2.5 w-2.5 rounded-full ${s === "EN_BONNE_SANTE" ? "bg-emerald-500" : s === "A_RISQUE" ? "bg-amber-500" : s === "EN_RETARD" ? "bg-red-500" : "bg-gray-400"}`} />
                    {NIVEAU_LABEL[s]}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  )
}

