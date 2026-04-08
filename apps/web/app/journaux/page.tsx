"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import {
  api,
  deverrouillerJournal,
  getClients,
  getJournalHistorique,
  getJournauxConfig,
  patchJournalConfig,
  verrouillerJournal,
} from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Dossier = { id: string; typeMission: string }
type Exercice = { id: string; annee: number }
type JournalRow = {
  id: string
  code: string
  libelle: string
  type: string
  actif: boolean
  verrouille: boolean
  periodLabel?: string | null
  anomalies: number
  rules: {
    pieceObligatoire: boolean
    libelleObligatoire: boolean
    interdireMontantNul: boolean
    autoriserBrouillon: boolean
    comptesAutorisesUniquement: boolean
    comptesAutorises: string[]
  }
}

export default function JournauxPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const [ok, setOk] = useState("")
  const [dirty, setDirty] = useState(false)

  const [clients, setClients] = useState<Client[]>([])
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [dossierId, setDossierId] = useState("")
  const [exerciceId, setExerciceId] = useState("")

  const [journaux, setJournaux] = useState<JournalRow[]>([])
  const [stats, setStats] = useState({ actifs: 0, total: 0, verrouilles: 0, reglesObligatoiresPct: 0, anomalies: 0 })
  const [selectedId, setSelectedId] = useState("")
  const [localCfg, setLocalCfg] = useState<JournalRow | null>(null)
  const [periodLabel, setPeriodLabel] = useState("")
  const [histOpenId, setHistOpenId] = useState("")
  const [historique, setHistorique] = useState<
    Array<{ id: string; action: string; createdAt: string; user?: { nomComplet?: string; email?: string } | null }>
  >([])

  const selected = useMemo(() => journaux.find(j => j.id === selectedId) ?? null, [journaux, selectedId])

  function actionLabel(action: string) {
    if (action === "JOURNAL_CONFIG_MAJ") return "Règles modifiées"
    if (action === "JOURNAL_VERROUILLE") return "Verrouillage appliqué"
    if (action === "JOURNAL_DEVERROUILLE") return "Déverrouillage"
    return action
  }
  function actionDotClass(action: string) {
    if (action === "JOURNAL_VERROUILLE") return "bg-orange-500"
    if (action === "JOURNAL_DEVERROUILLE") return "bg-blue-500"
    return "bg-emerald-500"
  }
  function typeBadge(code: string, type: string) {
    if (code === "AN") return { label: "Clôture", cls: "bg-blue-100 text-blue-700" }
    if (type === "ACHATS") return { label: "Achats", cls: "bg-emerald-100 text-emerald-700" }
    if (type === "VENTES") return { label: "Ventes", cls: "bg-emerald-100 text-emerald-700" }
    if (type === "BANQUE" || type === "CAISSE") return { label: "Trésorerie", cls: "bg-violet-100 text-violet-700" }
    if (type === "SALAIRES") return { label: "Paie", cls: "bg-amber-100 text-amber-700" }
    return { label: "Divers", cls: "bg-gray-100 text-gray-700" }
  }

  async function onClientChange(id: string) {
    setClientId(id)
    setDossierId("")
    setExerciceId("")
    setDossiers([])
    setExercices([])
    if (!id) return
    const rc = await api.get(`/clients/${id}`)
    const ds = (rc.data.client?.dossiers ?? []) as Dossier[]
    setDossiers(ds)
    if (ds[0]?.id) await onDossierChange(ds[0].id)
  }
  async function onDossierChange(id: string) {
    setDossierId(id)
    setExerciceId("")
    setExercices([])
    if (!id) return
    const re = await api.get(`/exercices?dossierId=${id}`)
    const xs = (re.data.exercices ?? []) as Exercice[]
    setExercices(xs)
    if (xs[0]?.id) setExerciceId(xs[0].id)
  }

  async function loadData() {
    if (!exerciceId) return
    setLoading(true)
    setErr("")
    try {
      const r = await getJournauxConfig(exerciceId)
      const js = (r.data.journaux ?? []) as JournalRow[]
      setJournaux(js)
      setStats(r.data.stats ?? stats)
      if (!selectedId && js[0]?.id) setSelectedId(js[0].id)
      setOk("Journaux actualisés.")
    } catch {
      setErr("Impossible de charger les journaux.")
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
    ;(async () => {
      try {
        const r = await getClients()
        const list = (r.data.clients ?? []) as Client[]
        setClients(list)
        if (list[0]?.id) await onClientChange(list[0].id)
      } catch {
        setErr("Impossible de charger les clients.")
      }
    })()
  }, [router])

  useEffect(() => {
    if (exerciceId) loadData().catch(() => setErr("Impossible de charger les journaux."))
  }, [exerciceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) {
      setLocalCfg(null)
      return
    }
    setLocalCfg(JSON.parse(JSON.stringify(selected)))
    setPeriodLabel(selected.periodLabel ?? "")
    setDirty(false)
  }, [selectedId, selected])

  async function onSave() {
    if (!localCfg) return
    setSaving(true)
    setErr("")
    try {
      await patchJournalConfig(localCfg.id, {
        actif: localCfg.actif,
        rules: localCfg.rules,
      })
      setDirty(false)
      setOk("Paramètres enregistrés.")
      await loadData()
    } catch {
      setErr("Impossible d'enregistrer les paramètres.")
    } finally {
      setSaving(false)
    }
  }

  async function onLock() {
    if (!localCfg || !periodLabel.trim()) return
    await verrouillerJournal(localCfg.id, periodLabel.trim())
    setOk("Journal verrouillé.")
    await loadData()
  }
  async function onUnlock() {
    if (!localCfg) return
    await deverrouillerJournal(localCfg.id)
    setOk("Journal déverrouillé.")
    await loadData()
  }

  async function toggleHistorique(id: string) {
    if (histOpenId === id) {
      setHistOpenId("")
      return
    }
    setHistOpenId(id)
    try {
      const r = await getJournalHistorique(id)
      setHistorique(
        (r.data.historique ?? []) as Array<{ id: string; action: string; createdAt: string; user?: { nomComplet?: string; email?: string } | null }>
      )
    } catch {
      setHistorique([])
    }
  }

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-500">Chargement…</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-gray-900">Journaux</h1>
        <p className="text-gray-500 mt-1 mb-4">Paramétrage et activation par exercice</p>
        {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
        {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
              <option value="">Client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={dossierId} onChange={e => onDossierChange(e.target.value)}>
              <option value="">Dossier</option>
              {dossiers.map(d => <option key={d.id} value={d.id}>{d.typeMission}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={exerciceId} onChange={e => setExerciceId(e.target.value)}>
              <option value="">Exercice</option>
              {exercices.map(ex => <option key={ex.id} value={ex.id}>{ex.annee}</option>)}
            </select>
            <button className="rounded-xl bg-orange-500 text-white px-4 py-2.5 text-sm font-semibold hover:bg-orange-600" onClick={loadData} disabled={!exerciceId || loading}>
              {loading ? "Chargement..." : "Actualiser"}
            </button>
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-semibold px-3 py-2.5">
              Exercice actif: {exercices.find(e => e.id === exerciceId)?.annee ?? "—"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-blue-50 rounded-xl border border-blue-100 p-4"><p className="text-xs text-blue-700">Journaux actifs</p><p className="text-2xl font-bold text-blue-900">{stats.actifs} / {stats.total}</p></div>
          <div className="bg-amber-50 rounded-xl border border-amber-100 p-4"><p className="text-xs text-amber-700">Journaux verrouillés</p><p className="text-2xl font-bold text-amber-900">{stats.verrouilles}</p></div>
          <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4"><p className="text-xs text-emerald-700">Règles obligatoires</p><p className="text-2xl font-bold text-emerald-900">{stats.reglesObligatoiresPct}%</p></div>
          <div className="bg-red-50 rounded-xl border border-red-100 p-4"><p className="text-xs text-red-700">Anomalies de configuration</p><p className="text-2xl font-bold text-red-900">{stats.anomalies}</p></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Liste des journaux ({journaux.length})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="text-left py-3 px-3">Code</th>
                    <th className="text-left py-3 px-3">Libellé</th>
                    <th className="text-left py-3 px-3">Type</th>
                    <th className="text-left py-3 px-3">Actif</th>
                    <th className="text-left py-3 px-3">Verrouillé</th>
                    <th className="text-left py-3 px-3">Règles</th>
                    <th className="text-left py-3 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {journaux.map(j => (
                    <tr key={j.id} className={`${selectedId === j.id ? "bg-orange-50" : ""} ${!j.actif ? "opacity-60" : ""}`}>
                      <td className="py-2.5 px-3 font-semibold">{j.code}</td>
                      <td className="py-2.5 px-3">{j.libelle}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${typeBadge(j.code, j.type).cls}`}>
                          {typeBadge(j.code, j.type).label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <button className={`px-2 py-0.5 rounded-full text-xs ${j.actif ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-700"}`} onClick={() => { setSelectedId(j.id); setLocalCfg({ ...j, actif: !j.actif }); setDirty(true) }}>
                          {j.actif ? "Oui" : "Non"}
                        </button>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${j.verrouille ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}>
                          {j.verrouille ? "Oui" : "Non"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs text-gray-600">
                          {j.rules.pieceObligatoire ? "Pièce, " : ""}
                          {j.rules.libelleObligatoire ? "Libellé, " : ""}
                          {j.rules.interdireMontantNul ? "Mt ≠ 0" : "Mt autorisé à 0"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex gap-1">
                          <button className="px-2 py-1 rounded border border-gray-200 text-xs hover:bg-gray-50" onClick={() => setSelectedId(j.id)} title="Configurer">⚙</button>
                          <button className="px-2 py-1 rounded border border-gray-200 text-xs hover:bg-gray-50" onClick={() => toggleHistorique(j.id)} title="Historique">🕘</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Configuration du journal sélectionné</h3>
            {!localCfg && <p className="text-sm text-gray-500">Sélectionne un journal.</p>}
            {localCfg && (
              <div className="space-y-3 text-sm">
                <label className="flex items-center justify-between">
                  <span>Journal actif</span>
                  <input type="checkbox" checked={localCfg.actif} onChange={e => { setLocalCfg({ ...localCfg, actif: e.target.checked }); setDirty(true) }} />
                </label>
                <p className="text-xs text-gray-500 -mt-1">
                  {localCfg.actif
                    ? "Désactivez pour empêcher la saisie sur ce journal."
                    : "Journal désactivé : aucune saisie autorisée sur ce journal."}
                </p>
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="font-semibold text-gray-800">Règles de saisie</p>
                  {([
                    ["pieceObligatoire", "Pièce obligatoire"],
                    ["libelleObligatoire", "Libellé obligatoire"],
                    ["interdireMontantNul", "Interdire montant nul"],
                    ["autoriserBrouillon", "Autoriser brouillon"],
                    ["comptesAutorisesUniquement", "Comptes autorisés uniquement"],
                  ] as Array<[keyof Omit<JournalRow["rules"], "comptesAutorises">, string]>).map(([k, label]) => (
                    <label className="flex items-center gap-2" key={k}>
                      <input
                        type="checkbox"
                        checked={localCfg.rules[k]}
                        onChange={e => {
                          setLocalCfg({
                            ...localCfg,
                            rules: { ...localCfg.rules, [k]: e.target.checked },
                          })
                          setDirty(true)
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="font-semibold text-gray-800">Verrouillage</p>
                  <input
                    value={periodLabel}
                    onChange={e => setPeriodLabel(e.target.value)}
                    placeholder="ex: Juillet 2027"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                  <div className="flex gap-2">
                    <button className="px-3 py-2 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600" onClick={onLock}>Verrouiller</button>
                    <button className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50" onClick={onUnlock}>Déverrouiller</button>
                  </div>
                </div>
                {histOpenId === localCfg.id && (
                  <div className="border-t border-gray-100 pt-3">
                    <p className="font-semibold text-gray-800 mb-2">Audit (5 dernières)</p>
                    <ul className="space-y-2">
                      {historique.slice(0, 5).map(h => (
                        <li key={h.id} className="flex items-start gap-2 text-xs">
                          <span className={`mt-1.5 h-2 w-2 rounded-full ${actionDotClass(h.action)}`} />
                          <div className="min-w-0">
                            <p className="text-gray-800 font-medium">{actionLabel(h.action)}</p>
                            <p className="text-gray-500">
                              {new Date(h.createdAt).toLocaleDateString("fr-FR")} {new Date(h.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                              {" · "}
                              {h.user?.nomComplet || h.user?.email || "Système"}
                            </p>
                          </div>
                        </li>
                      ))}
                      {historique.length === 0 && <li className="text-xs text-gray-500">Aucun historique.</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>

        <div className="sticky bottom-2 mt-4 bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm ${dirty ? "text-orange-700" : "text-gray-500"}`}>
            {dirty ? "Modifications non enregistrées" : "Aucune modification en attente"}
          </p>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setLocalCfg(selected ? JSON.parse(JSON.stringify(selected)) : null)} disabled={!selected}>
              Annuler
            </button>
            <button className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60" onClick={onSave} disabled={!dirty || saving}>
              {saving ? "Enregistrement..." : "Enregistrer les paramètres"}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}

