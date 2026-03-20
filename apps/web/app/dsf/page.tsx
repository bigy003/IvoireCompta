"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import {
  getDeclarationsPilotage,
  genererDSF,
  getClients,
  api,
  preparerDepotEcheance,
  deposerEcheance,
} from "@/lib/api"

const TYPE_LABEL: Record<string, string> = {
  TVA_MENSUELLE: "TVA mensuelle",
  IS_ACOMPTE_1: "IS — 1er acompte",
  IS_ACOMPTE_2: "IS — 2e acompte",
  IS_ACOMPTE_3: "IS — 3e acompte",
  IS_SOLDE: "IS — solde",
  IMF: "IMF",
  DSF_ANNUELLE: "DSF annuelle",
  CNPS_MENSUELLE: "CNPS mensuelle",
  ITS_MENSUEL: "ITS mensuel",
  PATENTE: "Patente",
  DECLARATION_EMPLOI: "Déclaration emploi",
}

const TYPES_FILTRE = Object.entries(TYPE_LABEL).map(([v, l]) => ({ v, l }))

function messageErreurApi(e: unknown): string {
  const ax = e as {
    response?: { status?: number; data?: { error?: string; message?: string } }
    message?: string
  }
  const d = ax.response?.data
  if (typeof d?.error === "string" && d.error.trim()) return d.error
  if (typeof d?.message === "string" && d.message.trim()) return d.message
  if (ax.response?.status && ax.message?.includes("Network")) return "Serveur injoignable — vérifiez que l’API tourne (port 4000)."
  if (ax.message) return ax.message
  return `Erreur ${ax.response?.status ?? "réseau"}`
}

type Ligne = {
  id: string
  clientId: string
  clientNom: string
  clientNcc: string
  typeDeclaration: string
  periodeLabel: string
  dateEcheance: string
  joursRestants: number
  uiStatut: "DEPOSEE" | "EN_RETARD" | "URGENT" | "A_FAIRE"
  exerciceId: string | null
}

function initiales(nom: string) {
  const p = nom.trim().split(/\s+/)
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase()
  return nom.slice(0, 2).toUpperCase() || "?"
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

export default function DsfPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState({ aFaire: 0, urgentes: 0, deposees: 0 })
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [err, setErr] = useState("")
  const [succes, setSucces] = useState("")
  const [voirTableauxExerciceId, setVoirTableauxExerciceId] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState("")
  const [filterStatut, setFilterStatut] = useState<"" | "A_FAIRE" | "URGENT" | "EN_RETARD" | "DEPOSEE">("")

  const [modalDsf, setModalDsf] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)
  const [clientsOpts, setClientsOpts] = useState<{ id: string; nom: string }[]>([])
  const [exercicesOpts, setExercicesOpts] = useState<{ id: string; label: string }[]>([])
  const [selClient, setSelClient] = useState("")
  const [selExercice, setSelExercice] = useState("")

  async function load() {
    setLoading(true)
    setErr("")
    try {
      const r = await getDeclarationsPilotage()
      setKpis(r.data.kpis ?? { aFaire: 0, urgentes: 0, deposees: 0 })
      setLignes(r.data.lignes ?? [])
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string }; status?: number } })?.response?.data?.error
      const st = (e as { response?: { status?: number } })?.response?.status
      setErr(
        typeof msg === "string"
          ? msg
          : st === 404
            ? "Route API introuvable — redémarrez le serveur API."
            : "Impossible de charger les déclarations."
      )
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
    load()
  }, [router])

  const filtered = useMemo(() => {
    let list = lignes
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        l =>
          l.clientNom.toLowerCase().includes(q) ||
          l.clientNcc.toLowerCase().includes(q) ||
          l.periodeLabel.toLowerCase().includes(q)
      )
    }
    if (filterType) list = list.filter(l => l.typeDeclaration === filterType)
    if (filterStatut) list = list.filter(l => l.uiStatut === filterStatut)
    return list
  }, [lignes, search, filterType, filterStatut])

  async function openModalGlobal() {
    setSelClient("")
    setSelExercice("")
    setExercicesOpts([])
    setModalDsf(true)
    setErr("")
    try {
      const r = await getClients()
      setClientsOpts((r.data.clients ?? []).map((c: { id: string; nomRaisonSociale: string }) => ({ id: c.id, nom: c.nomRaisonSociale })))
    } catch {
      setClientsOpts([])
    }
  }

  async function onClientModalChange(clientId: string) {
    setSelClient(clientId)
    setSelExercice("")
    if (!clientId) {
      setExercicesOpts([])
      return
    }
    try {
      const r = await api.get(`/clients/${clientId}`)
      const dossiers = r.data.client?.dossiers ?? []
      if (!dossiers[0]) {
        setExercicesOpts([])
        return
      }
      const ex = await api.get(`/exercices?dossierId=${dossiers[0].id}`)
      const list = ex.data.exercices ?? []
      setExercicesOpts(list.map((e: { id: string; annee: number }) => ({ id: e.id, label: `Exercice ${e.annee}` })))
    } catch {
      setExercicesOpts([])
    }
  }

  async function onGenererDepuisLigne(row: Ligne) {
    if (!row.exerciceId) {
      setErr("Aucun exercice comptable ne correspond à cette DSF. Vérifiez l’année du dossier client.")
      return
    }
    setSucces("")
    setErr("")
    try {
      const r = await genererDSF(row.exerciceId)
      setVoirTableauxExerciceId(row.exerciceId)
      setSucces(r.data?.message ?? "DSF générée avec succès.")
      await load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(typeof msg === "string" ? msg : "Échec de la génération.")
    }
  }

  async function onGenererModal(e: React.FormEvent) {
    e.preventDefault()
    if (!selExercice) return
    setModalLoading(true)
    setErr("")
    setSucces("")
    try {
      const r = await genererDSF(selExercice)
      setVoirTableauxExerciceId(selExercice)
      setSucces(r.data?.message ?? "DSF générée.")
      setModalDsf(false)
      await load()
    } catch (e: unknown) {
      setErr(messageErreurApi(e))
    } finally {
      setModalLoading(false)
    }
  }

  async function onPreparerDepot(row: Ligne) {
    setErr("")
    setSucces("")
    try {
      const r = await preparerDepotEcheance(row.id)
      setSucces(r.data?.message ?? "Déclaration marquée en cours.")
      await load()
    } catch (e: unknown) {
      setErr(messageErreurApi(e))
    }
  }

  async function onDeposerEimpots(row: Ligne) {
    const ref = window.prompt("Référence e-impôts (obligatoire) :")
    if (!ref?.trim()) return
    setErr("")
    setSucces("")
    try {
      const r = await deposerEcheance(row.id, ref.trim())
      setSucces(r.data?.message ?? "Déclaration déposée.")
      await load()
    } catch (e: unknown) {
      setErr(messageErreurApi(e))
    }
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
      <div className="max-w-7xl mx-auto px-6 py-8 pb-24">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">DSF & Déclarations</h1>
          <p className="text-sm text-gray-500 mt-1">Échéances fiscales et génération de la liasse DSF (9 tableaux DGI-CI)</p>
        </div>

        {succes && (
          <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm space-y-2">
            <p>{succes}</p>
            {voirTableauxExerciceId && (
              <Link
                href={`/dsf/tableaux/${voirTableauxExerciceId}`}
                className="inline-flex font-bold text-orange-700 hover:text-orange-800 underline underline-offset-2"
              >
                Voir les tableaux T07, T08, T09 →
              </Link>
            )}
          </div>
        )}
        {err && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Déclarations à faire</p>
              <p className="text-3xl font-bold text-orange-600 tabular-nums mt-0.5">{kpis.aFaire}</p>
              <p className="text-xs text-gray-400 mt-1">&gt; 7 jours</p>
            </div>
          </div>
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Échéances urgentes</p>
              <p className="text-3xl font-bold text-red-600 tabular-nums mt-0.5">{kpis.urgentes}</p>
              <p className="text-xs text-gray-400 mt-1">≤ 7 j. ou en retard</p>
            </div>
          </div>
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Déclarations déposées</p>
              <p className="text-3xl font-bold text-emerald-700 tabular-nums mt-0.5">{kpis.deposees}</p>
              <p className="text-xs text-gray-400 mt-1">Statut « fait »</p>
            </div>
          </div>
        </div>

        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-4 mb-6 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder="Rechercher un client…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm min-w-[140px] bg-white"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="">Type (tous)</option>
              {TYPES_FILTRE.map(t => (
                <option key={t.v} value={t.v}>
                  {t.l}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm min-w-[140px] bg-white"
              value={filterStatut}
              onChange={e => setFilterStatut(e.target.value as typeof filterStatut)}
            >
              <option value="">Statut (tous)</option>
              <option value="A_FAIRE">À faire</option>
              <option value="URGENT">Urgent</option>
              <option value="EN_RETARD">En retard</option>
              <option value="DEPOSEE">Déposée</option>
            </select>
            <button
              type="button"
              onClick={openModalGlobal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold shadow-md shadow-orange-500/25"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Générer DSF
            </button>
          </div>
        </div>

        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-500">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-gray-500 text-sm">
              {lignes.length === 0
                ? "Aucune échéance fiscale. Les échéances sont créées par le système ou le seed de démo."
                : "Aucun résultat pour ces filtres."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/90 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-4">Client</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Période</th>
                    <th className="px-5 py-4">Date limite</th>
                    <th className="px-5 py-4">Jours restants</th>
                    <th className="px-5 py-4">Statut</th>
                    <th className="px-5 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50/60">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-xs font-bold text-white">
                            {initiales(row.clientNom)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{row.clientNom}</p>
                            <p className="text-xs text-gray-400 font-mono">{row.clientNcc}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-800">{TYPE_LABEL[row.typeDeclaration] ?? row.typeDeclaration}</td>
                      <td className="px-5 py-4 text-gray-600">{row.periodeLabel}</td>
                      <td className="px-5 py-4 text-gray-700">{fmtDate(row.dateEcheance)}</td>
                      <td className="px-5 py-4">
                        {row.uiStatut === "DEPOSEE" ? (
                          <span className="text-emerald-600 font-medium">—</span>
                        ) : row.uiStatut === "EN_RETARD" ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                            En retard
                          </span>
                        ) : (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                              row.joursRestants <= 7 ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {row.joursRestants} j.
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {row.uiStatut === "DEPOSEE" && (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                            Déposée
                          </span>
                        )}
                        {row.uiStatut === "EN_RETARD" && (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                            En retard
                          </span>
                        )}
                        {row.uiStatut === "URGENT" && (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">
                            À faire
                          </span>
                        )}
                        {row.uiStatut === "A_FAIRE" && (
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                            À faire
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-center gap-2 min-h-[2rem]">
                          {row.typeDeclaration === "DSF_ANNUELLE" &&
                            row.uiStatut !== "DEPOSEE" &&
                            row.exerciceId && (
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                <Link
                                  href={`/dsf/tableaux/${row.exerciceId}`}
                                  className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:border-orange-300 hover:text-orange-700 whitespace-nowrap"
                                >
                                  Voir tableaux
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => onGenererDepuisLigne(row)}
                                  className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 whitespace-nowrap"
                                >
                                  Générer DSF
                                </button>
                              </div>
                            )}
                          {row.typeDeclaration === "DSF_ANNUELLE" && !row.exerciceId && row.uiStatut !== "DEPOSEE" && (
                            <span className="text-xs text-gray-400 text-center">Exercice manquant</span>
                          )}
                          {row.uiStatut === "DEPOSEE" && (
                            <div className="flex gap-1">
                              <span className="p-2 text-gray-300 cursor-not-allowed" title="Bientôt">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                  />
                                </svg>
                              </span>
                            </div>
                          )}
                          {row.typeDeclaration !== "DSF_ANNUELLE" && row.uiStatut !== "DEPOSEE" && (
                            <div className="flex flex-wrap items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onPreparerDepot(row)}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:border-orange-300 hover:text-orange-700 whitespace-nowrap"
                              >
                                Préparer dépôt
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeposerEimpots(row)}
                                className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 whitespace-nowrap"
                              >
                                Marquer déposée
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalDsf && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Générer la DSF</h2>
            <p className="text-sm text-gray-500 mb-4">
              Choisissez le client et l’exercice comptable. Les tableaux <strong>T07, T08 et T09</strong> (passage
              résultat fiscal, IS/IMF, synthèse) sont calculés à partir des écritures validées.
            </p>
            <form onSubmit={onGenererModal} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
                <select
                  required
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                  value={selClient}
                  onChange={e => onClientModalChange(e.target.value)}
                >
                  <option value="">— Sélectionner —</option>
                  {clientsOpts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Exercice</label>
                <select
                  required
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                  value={selExercice}
                  onChange={e => setSelExercice(e.target.value)}
                  disabled={!selClient}
                >
                  <option value="">— Sélectionner —</option>
                  {exercicesOpts.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={modalLoading || !selExercice}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-semibold text-sm hover:bg-orange-600 disabled:opacity-50"
                >
                  {modalLoading ? "…" : "Générer"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalDsf(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
