"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import {
  getClients,
  getPaieEmployes,
  getPaieHistorique,
  getPaieSynthese,
  getPaiePeriode,
  createPaieEmploye,
  patchPaieEmploye,
  genererBulletinPaie,
  exportPaieCsv,
  postRecapCnps,
} from "@/lib/api"

const MOIS_LABEL = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
]

type ClientOpt = { id: string; ncc: string; nomRaisonSociale: string; email?: string | null; telephone?: string | null; actif: boolean }

type EmployeRow = {
  id: string
  matricule: string
  nom: string
  prenom: string
  poste: string | null
  categorieCnps?: string
  actif: boolean
  salaireBase: string
  brutTheorique: string
  dateEmbauche: string
  primes: Record<string, number>
}

type Synthese = {
  nbEmployesTotal: number
  nbEmployesActifs: number
  masseSalarialeBrute: string
  sourceBrut: "bulletins" | "projecte"
  bulletinsGeneres: number
  employesSansBulletin: number
  declarationsEnAttente: number
  recapCnpsDisponible: boolean
  periodesRecentes: { mois: number; annee: number }[]
}

type PrimeDraft = { id: string; key: string; value: string }

function newPrimeDraft(key = "", value = ""): PrimeDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key,
    value,
  }
}

function initiales(prenom: string, nom: string) {
  const a = (prenom[0] || "") + (nom[0] || "")
  return a.toUpperCase() || "?"
}

function fmtFcfa(n: string | number | bigint) {
  const v = typeof n === "bigint" ? Number(n) : typeof n === "string" ? parseInt(n, 10) : n
  if (Number.isNaN(v)) return "—"
  return new Intl.NumberFormat("fr-FR").format(v) + " FCFA"
}

function todayPeriod() {
  const d = new Date()
  return { mois: d.getMonth() + 1, annee: d.getFullYear() }
}

export default function PaiePage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [clientId, setClientId] = useState("")
  const [mois, setMois] = useState(todayPeriod().mois)
  const [annee, setAnnee] = useState(todayPeriod().annee)
  const [tab, setTab] = useState<"salaries" | "declarations">("salaries")
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [succes, setSucces] = useState("")
  const [employes, setEmployes] = useState<EmployeRow[]>([])
  const [synthese, setSynthese] = useState<Synthese | null>(null)
  const [periode, setPeriode] = useState<{
    bulletins: {
      id: string
      employeId: string
      matricule: string
      nomComplet: string
      poste: string | null
      salaireBrut: string
      netAPayer: string
      impotIts: string
    }[]
    sansBulletin: {
      id: string
      nom: string
      prenom: string
      matricule: string
      poste: string | null
      bloqueGeneration?: boolean
      controles?: Array<{ code: string; niveau: "BLOQUANT" | "ALERTE"; message: string }>
    }[]
  } | null>(null)
  const [modalEmploye, setModalEmploye] = useState<"create" | EmployeRow | null>(null)
  const [dateEmbaucheModal, setDateEmbaucheModal] = useState("")
  const [primesModal, setPrimesModal] = useState<PrimeDraft[]>([])
  const [submitEmp, setSubmitEmp] = useState(false)
  const [genId, setGenId] = useState<string | null>(null)
  const [recapLoading, setRecapLoading] = useState(false)
  const [controleModal, setControleModal] = useState<{
    nomComplet: string
    controles: Array<{ code: string; niveau: "BLOQUANT" | "ALERTE"; message: string }>
  } | null>(null)
  const [historique, setHistorique] = useState<
    Array<{ id: string; action: string; entite: string; entiteId: string; createdAt: string; donneeApres?: unknown }>
  >([])

  const clientCourant = useMemo(() => clients.find(c => c.id === clientId), [clients, clientId])

  const loadData = useCallback(async () => {
    if (!clientId) {
      setEmployes([])
      setSynthese(null)
      setPeriode(null)
      return
    }
    setLoading(true)
    setErr("")
    try {
      const [rEmp, rSyn, rPer, rHist] = await Promise.all([
        getPaieEmployes(clientId),
        getPaieSynthese(clientId, mois, annee),
        getPaiePeriode(clientId, mois, annee),
        getPaieHistorique(clientId, 40),
      ])
      setEmployes(rEmp.data.employes ?? [])
      setSynthese(rSyn.data as Synthese)
      setPeriode(rPer.data)
      setHistorique(rHist.data.historique ?? [])
    } catch {
      setErr("Impossible de charger les données paie.")
      setEmployes([])
      setSynthese(null)
      setPeriode(null)
      setHistorique([])
    } finally {
      setLoading(false)
    }
  }, [clientId, mois, annee])

  async function onExportPaieCsv() {
    if (!clientId) return
    try {
      const r = await exportPaieCsv(clientId, mois, annee)
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8" })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `paie_${mois}_${annee}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      setSucces("Export CSV paie téléchargé.")
    } catch {
      setErr("Impossible d'exporter le CSV paie.")
    }
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
  }, [router])

  useEffect(() => {
    if (authLoading) return
    ;(async () => {
      try {
        const r = await getClients()
        const list = (r.data.clients ?? []).filter((c: ClientOpt) => c.actif)
        setClients(list)
        if (list.length && !clientId) setClientId(list[0].id)
      } catch {
        setErr("Impossible de charger les clients.")
      }
    })()
  }, [authLoading])

  useEffect(() => {
    if (authLoading || !clientId) return
    loadData()
  }, [authLoading, clientId, mois, annee, loadData])

  async function onSubmitEmploye(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const matricule = String(fd.get("matricule") || "").trim()
    const nom = String(fd.get("nom") || "").trim()
    const prenom = String(fd.get("prenom") || "").trim()
    const poste = String(fd.get("poste") || "").trim() || null
    const salaireBase = parseInt(String(fd.get("salaireBase") || "0"), 10)
    const dateEmbauche = dateEmbaucheModal.trim()
    const actif = fd.get("actif") === "on" || fd.get("actif") === "true"
    const primes: Record<string, number> = {}
    for (const p of primesModal) {
      const k = p.key.trim()
      if (!k) continue
      const v = parseInt(p.value || "0", 10)
      if (Number.isNaN(v) || v < 0) {
        setErr(`Montant invalide pour la prime "${k}".`)
        return
      }
      primes[k] = v
    }
    if (!matricule || !nom || !prenom || !dateEmbauche || salaireBase < 0) {
      setErr("Champs obligatoires manquants.")
      return
    }
    setSubmitEmp(true)
    setErr("")
    try {
      if (modalEmploye === "create") {
        await createPaieEmploye({
          clientId,
          matricule,
          nom,
          prenom,
          dateEmbauche,
          salaireBase,
          poste,
          actif,
          primes,
        })
        setSucces("Salarié créé.")
      } else if (modalEmploye && typeof modalEmploye === "object") {
        await patchPaieEmploye(modalEmploye.id, {
          matricule,
          nom,
          prenom,
          dateEmbauche,
          salaireBase,
          poste,
          actif,
          primes,
        })
        setSucces("Salarié mis à jour.")
      }
      setModalEmploye(null)
      await loadData()
    } catch (ex: unknown) {
      const msg = (ex as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(typeof msg === "string" ? msg : "Erreur enregistrement.")
    } finally {
      setSubmitEmp(false)
    }
  }

  async function genererBulletin(employeId: string) {
    setGenId(employeId)
    setErr("")
    try {
      await genererBulletinPaie({ employeId, mois, annee })
      setSucces("Bulletin généré.")
      await loadData()
    } catch (ex: unknown) {
      const data = (ex as { response?: { data?: { error?: string; controles?: Array<{ message?: string }> }; status?: number } })?.response?.data
      const msg = data?.error
      const st = (ex as { response?: { status?: number } })?.response?.status
      if (st === 409 && typeof msg === "string" && msg.includes("déjà")) {
        await loadData()
        setSucces("Bulletin déjà enregistré — affichage mis à jour.")
        setGenId(null)
        return
      }
      if (st === 409 && Array.isArray(data?.controles) && data.controles.length > 0) {
        setErr(`${msg || "Contrôle bloquant"} ${data.controles[0]?.message ? `(${data.controles[0].message})` : ""}`.trim())
        setGenId(null)
        await loadData()
        return
      }
      setErr(typeof msg === "string" ? msg : "Génération impossible.")
    } finally {
      setGenId(null)
    }
  }

  async function voirRecap() {
    if (!clientId) return
    setRecapLoading(true)
    setErr("")
    try {
      const r = await postRecapCnps(clientId, mois, annee)
      const d = r.data
      setSucces(
        `Récap CNPS ${mois}/${annee} : ${d.nbSalaries} salarié(s), brut total ${fmtFcfa(d.totalBrut)} — charges employeur ${fmtFcfa(d.totalCnpsEmployeur)}`
      )
    } catch (ex: unknown) {
      const msg = (ex as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(typeof msg === "string" ? msg : "Récap indisponible (bulletins requis).")
    } finally {
      setRecapLoading(false)
    }
  }

  useEffect(() => {
    if (!succes) return
    const t = setTimeout(() => setSucces(""), 5000)
    return () => clearTimeout(t)
  }, [succes])

  useEffect(() => {
    if (!modalEmploye) return
    if (modalEmploye === "create") {
      setDateEmbaucheModal(new Date().toISOString().split("T")[0])
      setPrimesModal([newPrimeDraft("transport", "")])
    } else {
      setDateEmbaucheModal(modalEmploye.dateEmbauche.slice(0, 10))
      const entries = Object.entries(modalEmploye.primes ?? {})
      setPrimesModal(
        entries.length > 0
          ? entries.map(([key, value]) => newPrimeDraft(key, String(value)))
          : [newPrimeDraft("transport", "")]
      )
    }
  }, [modalEmploye])

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh] text-gray-500">Chargement…</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Paie</h1>
          <p className="text-gray-500 mt-1">Gérez la paie des employés de vos clients</p>
        </div>

        {err && (
          <div className="mb-4 rounded-xl bg-red-50 text-red-800 text-sm px-4 py-3 border border-red-100">{err}</div>
        )}
        {succes && (
          <div className="mb-4 rounded-xl bg-emerald-50 text-emerald-800 text-sm px-4 py-3 border border-emerald-100">
            {succes}
          </div>
        )}

        {!clients.length ? (
          <p className="text-gray-500">Aucun client actif. Ajoutez un client pour utiliser la paie.</p>
        ) : (
          <>
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-1 min-w-0">
                <div className="min-w-[240px]">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Client</label>
                  <select
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                  >
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nomRaisonSociale} — {c.ncc}
                      </option>
                    ))}
                  </select>
                </div>
                {clientCourant && (
                  <div className="text-sm text-gray-600 space-y-0.5">
                    {clientCourant.email && <div>{clientCourant.email}</div>}
                    {clientCourant.telephone && <div>{clientCourant.telephone}</div>}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-stretch gap-3">
                <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 min-w-[160px]">
                  <div className="text-xs font-semibold text-gray-500 uppercase">Masse salariale ({MOIS_LABEL[mois - 1]?.slice(0, 3)}.)</div>
                  <div className="text-lg font-bold text-gray-900 mt-1">
                    {synthese ? fmtFcfa(synthese.masseSalarialeBrute) : "—"}
                  </div>
                  {synthese?.sourceBrut === "projecte" && synthese.bulletinsGeneres === 0 && (
                    <div className="text-[10px] text-amber-600 mt-0.5">Projection (sans bulletins)</div>
                  )}
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 min-w-[140px]">
                  <div className="text-xs font-semibold text-gray-500 uppercase">Déclarations</div>
                  <div className="text-lg font-bold text-orange-600 mt-1">
                    {synthese?.declarationsEnAttente ?? "—"}{" "}
                    <span className="text-sm font-normal text-gray-500">à traiter</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 min-w-[120px]">
                  <div className="text-xs font-semibold text-gray-500 uppercase">Salariés actifs</div>
                  <div className="text-lg font-bold text-gray-900 mt-1">{synthese?.nbEmployesActifs ?? "—"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTab("declarations")
                    setSucces("Générez les bulletins manquants, puis ouvrez le récap CNPS.")
                  }}
                  className="self-center px-5 py-3 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 shadow-sm whitespace-nowrap"
                >
                  + Nouvelle déclaration paie
                </button>
              </div>
            </div>

            <div className="flex gap-1 border-b border-gray-200 mb-6">
              {(
                [
                  ["salaries", "Salariés"],
                  ["declarations", "Déclarations"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    tab === k ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid lg:grid-cols-[1fr_minmax(260px,320px)] gap-8 items-start">
              <div className="min-w-0">
                {loading && <p className="text-gray-500 text-sm mb-4">Chargement…</p>}

                {tab === "salaries" && (
                  <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                    <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
                      <h2 className="font-bold text-gray-900">Liste des salariés</h2>
                      <button
                        type="button"
                        onClick={() => setModalEmploye("create")}
                        className="text-sm font-semibold text-orange-600 hover:text-orange-700"
                      >
                        + Ajouter
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            <th className="px-5 py-3">Nom</th>
                            <th className="px-5 py-3">Poste</th>
                            <th className="px-5 py-3">Statut</th>
                            <th className="px-5 py-3 text-right">Salaire brut</th>
                            <th className="px-5 py-3 text-center w-24">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {employes.map(row => (
                            <tr key={row.id} className="hover:bg-gray-50/50">
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                                    {initiales(row.prenom, row.nom)}
                                  </span>
                                  <div>
                                    <div className="font-semibold text-gray-900">
                                      {row.prenom} {row.nom}
                                    </div>
                                    <div className="text-xs text-gray-500">{row.matricule}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-gray-700">{row.poste || row.categorieCnps || "—"}</td>
                              <td className="px-5 py-4">
                                {row.actif ? (
                                  <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                                    Actif
                                  </span>
                                ) : (
                                  <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800">
                                    Suspendu
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-4 text-right font-medium text-gray-900 tabular-nums">
                                {fmtFcfa(row.brutTheorique)}
                              </td>
                              <td className="px-5 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => setModalEmploye(row)}
                                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-orange-600"
                                  title="Modifier"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!loading && employes.length === 0 && (
                        <p className="px-5 py-8 text-center text-gray-500">Aucun salarié. Cliquez sur « Ajouter ».</p>
                      )}
                    </div>
                  </div>
                )}

                {tab === "declarations" && periode && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-100 font-bold text-gray-900">Bulletins — {MOIS_LABEL[mois - 1]} {annee}</div>
                      {periode.bulletins.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase">
                              <th className="px-5 py-3">Salarié</th>
                              <th className="px-5 py-3 text-right">Brut</th>
                              <th className="px-5 py-3 text-right">ITS</th>
                              <th className="px-5 py-3 text-right">Net</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {periode.bulletins.map(b => (
                              <tr key={b.id}>
                                <td className="px-5 py-3">
                                  <div className="font-medium text-gray-900">{b.nomComplet}</div>
                                  <div className="text-xs text-gray-500">{b.matricule}</div>
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums">{fmtFcfa(b.salaireBrut)}</td>
                                <td className="px-5 py-3 text-right tabular-nums">{fmtFcfa(b.impotIts)}</td>
                                <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtFcfa(b.netAPayer)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="px-5 py-6 text-gray-500 text-sm">Aucun bulletin pour cette période.</p>
                      )}
                    </div>

                    {periode.sansBulletin.length > 0 && (
                      <div className="rounded-2xl border border-amber-100 bg-amber-50/30 overflow-hidden">
                        <div className="px-5 py-3 text-sm font-bold text-amber-900">Sans bulletin ({periode.sansBulletin.length})</div>
                        <ul className="divide-y divide-amber-100">
                          {periode.sansBulletin.map(s => (
                            <li key={s.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-gray-800">
                                  {s.prenom} {s.nom} <span className="text-gray-500 text-sm">({s.matricule})</span>
                                </span>
                                {Array.isArray(s.controles) && s.controles.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {s.controles.map((c, idx) => (
                                      <button
                                        key={`${s.id}-${c.code}-${idx}`}
                                        type="button"
                                        onClick={() =>
                                          setControleModal({
                                            nomComplet: `${s.prenom} ${s.nom}`,
                                            controles: s.controles ?? [],
                                          })
                                        }
                                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                          c.niveau === "BLOQUANT"
                                            ? "bg-red-100 text-red-700"
                                            : "bg-amber-100 text-amber-700"
                                        }`}
                                      >
                                        {c.niveau === "BLOQUANT" ? "Bloquant" : "Alerte"}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                disabled={genId === s.id || Boolean(s.bloqueGeneration)}
                                onClick={() => genererBulletin(s.id)}
                                className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 disabled:opacity-50"
                                title={s.bloqueGeneration ? "Corrigez les contrôles bloquants dans la fiche salarié." : "Générer bulletin"}
                              >
                                {genId === s.id ? "…" : s.bloqueGeneration ? "Bloqué" : "Générer bulletin"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {synthese?.recapCnpsDisponible && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={recapLoading}
                          onClick={voirRecap}
                          className="w-full sm:w-auto px-5 py-3 rounded-xl border-2 border-orange-500 text-orange-600 font-semibold text-sm hover:bg-orange-50 disabled:opacity-50"
                        >
                          {recapLoading ? "Calcul…" : "Voir récap CNPS (mensuel)"}
                        </button>
                        <button
                          type="button"
                          onClick={onExportPaieCsv}
                          className="w-full sm:w-auto px-5 py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50"
                        >
                          Export CSV paie
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5 lg:sticky lg:top-24">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Période</div>
                <div className="flex gap-2 mb-6">
                  <select
                    value={mois}
                    onChange={e => setMois(parseInt(e.target.value, 10))}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    {MOIS_LABEL.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={annee}
                    onChange={e => setAnnee(parseInt(e.target.value, 10))}
                    className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    {[2024, 2025, 2026, 2027].map(y => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <dl className="space-y-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Total brut (période)</dt>
                    <dd className="font-bold text-gray-900 mt-0.5">{synthese ? fmtFcfa(synthese.masseSalarialeBrute) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Récap CNPS</dt>
                    <dd className="font-semibold text-gray-700 mt-0.5">
                      {synthese?.recapCnpsDisponible ? (
                        <span className="text-emerald-600">Disponible</span>
                      ) : synthese && synthese.bulletinsGeneres > 0 ? (
                        <span className="text-amber-600">Incomplet</span>
                      ) : (
                        <span className="text-gray-400">À venir</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Bulletins générés</dt>
                    <dd className="font-bold text-gray-900 mt-0.5">
                      {synthese ? `${synthese.bulletinsGeneres} / ${synthese.nbEmployesActifs}` : "—"}
                    </dd>
                  </div>
                </dl>
                {synthese && synthese.periodesRecentes.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Historique</div>
                    <div className="flex flex-wrap gap-2">
                      {synthese.periodesRecentes.map(p => (
                        <button
                          key={`${p.annee}-${p.mois}`}
                          type="button"
                          onClick={() => {
                            setMois(p.mois)
                            setAnnee(p.annee)
                          }}
                          className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-orange-100 hover:text-orange-800"
                        >
                          {MOIS_LABEL[p.mois - 1]?.slice(0, 3)} {p.annee}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {historique.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Traçabilité paie</div>
                    <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {historique.slice(0, 12).map(h => (
                        <li key={h.id} className="text-xs text-gray-700 bg-gray-50 rounded-lg px-2.5 py-2">
                          <div className="font-semibold">{h.action}</div>
                          <div className="text-gray-500">{new Date(h.createdAt).toLocaleString("fr-FR")}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </div>

      {modalEmploye && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <form
            onSubmit={onSubmitEmploye}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-gray-100 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {modalEmploye === "create" ? "Nouveau salarié" : "Modifier le salarié"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Matricule</label>
                <input
                  name="matricule"
                  required
                  defaultValue={modalEmploye === "create" ? "" : modalEmploye.matricule}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Prénom</label>
                  <input
                    name="prenom"
                    required
                    defaultValue={modalEmploye === "create" ? "" : modalEmploye.prenom}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                  <input
                    name="nom"
                    required
                    defaultValue={modalEmploye === "create" ? "" : modalEmploye.nom}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Poste</label>
                <input
                  name="poste"
                  defaultValue={modalEmploye === "create" ? "" : modalEmploye.poste ?? ""}
                  placeholder="ex. Comptable"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Salaire de base (FCFA / mois)</label>
                <input
                  name="salaireBase"
                  type="number"
                  min={0}
                  required
                  defaultValue={modalEmploye === "create" ? "" : modalEmploye.salaireBase}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">Variables de paie (primes mensuelles)</label>
                  <button
                    type="button"
                    onClick={() => setPrimesModal(prev => [...prev, newPrimeDraft("", "")])}
                    className="text-xs font-semibold text-orange-600 hover:text-orange-700"
                  >
                    + Ajouter
                  </button>
                </div>
                <div className="space-y-2">
                  {primesModal.map((p, i) => (
                    <div key={p.id} className="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
                      <input
                        value={p.key}
                        onChange={e =>
                          setPrimesModal(prev => prev.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
                        }
                        placeholder="Libellé (ex: transport)"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <input
                        type="number"
                        min={0}
                        value={p.value}
                        onChange={e =>
                          setPrimesModal(prev => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
                        }
                        placeholder="Montant"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setPrimesModal(prev => prev.filter((_, idx) => idx !== i))}
                        className="px-2 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100"
                        title="Supprimer"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">Exemples: transport, logement, panier, rendement.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date d&apos;embauche</label>
                <DatePickerFr
                  value={dateEmbaucheModal}
                  onChange={setDateEmbaucheModal}
                  placeholder="Choisir la date d’embauche"
                  fromYear={1990}
                  toYear={new Date().getFullYear() + 1}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  name="actif"
                  defaultChecked={modalEmploye === "create" ? true : modalEmploye.actif}
                  value="true"
                  className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                Salarié actif
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setModalEmploye(null)}
                className="px-4 py-2 rounded-lg text-gray-600 text-sm font-medium hover:bg-gray-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitEmp}
                className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {submitEmp ? "…" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}

      {controleModal && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">Détails des contrôles</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">{controleModal.nomComplet}</p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {controleModal.controles.map((c, i) => (
                <div
                  key={`${c.code}-${i}`}
                  className={`rounded-lg border px-3 py-2 ${
                    c.niveau === "BLOQUANT"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <div className="text-xs font-semibold mb-0.5">{c.niveau === "BLOQUANT" ? "Bloquant" : "Alerte"}</div>
                  <div className="text-sm">{c.message}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setControleModal(null)}
                className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
