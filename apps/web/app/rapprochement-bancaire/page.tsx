"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import {
  api,
  autoMatchRapprochementBancaire,
  deverrouillerRapprochementMois,
  dissocierMouvementBancaire,
  getClients,
  getRapprochementBancaire,
  importerMouvementsBancairesCsv,
  rapprocherMouvementBancaire,
  validerRapprochementMois,
} from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Exercice = { id: string; annee: number }
type Mouvement = {
  id: string
  dateOperation: string
  libelle: string
  reference?: string | null
  debit: string
  credit: string
  solde?: string | null
  statut: "NON_RAPPROCHE" | "A_VERIFIER" | "RAPPROCHE" | "IGNORE"
  net: string
  rapprochements: Array<{ ecritureId: string }>
}
type Ecriture = {
  id: string
  dateOperation: string
  libelle: string
  pieceRef?: string | null
  journal: string
  debit: string
  credit: string
  net: string
  montantBanque?: string
}

function n(v: string | number) {
  if (typeof v === "number") return v
  const x = parseInt(v, 10)
  return Number.isNaN(x) ? 0 : x
}
function fcfa(v: number) {
  return `${v.toLocaleString("fr-FR")} FCFA`
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR")
  } catch {
    return iso
  }
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function RapprochementBancairePage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState("")
  const [err, setErr] = useState("")

  const [clients, setClients] = useState<Client[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [du, setDu] = useState(ymd(new Date(new Date().getFullYear(), 0, 1)))
  const [au, setAu] = useState(ymd(new Date()))
  const [statut, setStatut] = useState("TOUS")
  const [search, setSearch] = useState("")

  const [mouvements, setMouvements] = useState<Mouvement[]>([])
  const [ecritures, setEcritures] = useState<Ecriture[]>([])
  const [selectedMouvementId, setSelectedMouvementId] = useState("")
  const [selectedEcritureId, setSelectedEcritureId] = useState("")
  const [stats, setStats] = useState({
    mouvements: 0,
    ecritures: 0,
    tauxRapprochement: 0,
    ecartRestant: "0",
    verrouille: false,
  })
  const [canUnlock, setCanUnlock] = useState(false)
  const clientLabel = clients.find(c => c.id === clientId)?.nomRaisonSociale ?? "—"
  const exerciceLabel = exercices.find(e => e.id === exerciceId)?.annee ?? "—"
  const totalDebit = mouvements.reduce((s, m) => s + n(m.debit), 0)
  const totalCredit = mouvements.reduce((s, m) => s + n(m.credit), 0)

  const selectedMouvement = useMemo(
    () => mouvements.find(m => m.id === selectedMouvementId),
    [mouvements, selectedMouvementId]
  )
  const ecrituresCandidates = useMemo(() => {
    if (!selectedMouvement) return ecritures
    const montant = Math.abs(n(selectedMouvement.net))
    return [...ecritures]
      .map(e => {
        const base = Math.abs(n(e.montantBanque ?? e.net))
        const diff = Math.abs(base - montant)
        const score = Math.max(0, 100 - Math.round((diff / Math.max(montant, 1)) * 100))
        return { ...e, score }
      })
      .sort((a, b) => b.score - a.score)
  }, [ecritures, selectedMouvement])

  async function loadClients() {
    const r = await getClients()
    setClients((r.data.clients ?? []) as Client[])
  }

  async function onClientChange(id: string) {
    setClientId(id)
    setExerciceId("")
    setExercices([])
    if (!id) return
    const rc = await api.get(`/clients/${id}`)
    const dossierId = rc.data.client?.dossiers?.[0]?.id
    if (!dossierId) return
    const re = await api.get(`/exercices?dossierId=${dossierId}`)
    const list = (re.data.exercices ?? []) as Exercice[]
    setExercices(list)
    if (list[0]?.id) setExerciceId(list[0].id)
  }

  async function actualiser() {
    if (!exerciceId) return
    setLoading(true)
    setOk("")
    setErr("")
    try {
      const r = await getRapprochementBancaire({
        exerciceId,
        du,
        au,
        statut,
        search,
      })
      setMouvements((r.data.mouvements ?? []) as Mouvement[])
      setEcritures((r.data.ecritures ?? []) as Ecriture[])
      setStats(r.data.stats ?? { mouvements: 0, ecritures: 0, tauxRapprochement: 0, ecartRestant: "0", verrouille: false })
      if (!selectedMouvementId && r.data.mouvements?.[0]?.id) setSelectedMouvementId(r.data.mouvements[0].id)
      setOk("Rapprochement bancaire actualisé.")
    } catch {
      setErr("Impossible de charger le rapprochement bancaire.")
    } finally {
      setLoading(false)
    }
  }

  async function onImportCsv(file: File) {
    if (!clientId || !exerciceId) {
      setErr("Sélectionne d'abord le client et l'exercice.")
      return
    }
    const text = await file.text()
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      setErr("CSV vide ou invalide.")
      return
    }
    const sep = lines[0].includes(";") ? ";" : ","
    const rows = lines.slice(1).map(line => {
      const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ""))
      const dateRaw = cols[0] ?? ""
      const [d, m, y] = dateRaw.includes("/") ? dateRaw.split("/") : [dateRaw.slice(8, 10), dateRaw.slice(5, 7), dateRaw.slice(0, 4)]
      const iso = `${y}-${m}-${d}`
      const debit = parseInt((cols[2] ?? "0").replace(/[^\d-]/g, ""), 10) || 0
      const credit = parseInt((cols[3] ?? "0").replace(/[^\d-]/g, ""), 10) || 0
      const solde = parseInt((cols[4] ?? "0").replace(/[^\d-]/g, ""), 10) || 0
      return {
        dateOperation: `${iso}T00:00:00.000Z`,
        libelle: cols[1] || "Mouvement bancaire",
        reference: cols[5] || undefined,
        debit,
        credit,
        solde,
      }
    })
    await importerMouvementsBancairesCsv({ clientId, exerciceId, rows })
    setOk(`${rows.length} mouvement(s) importé(s).`)
    await actualiser()
  }

  async function onAutoMatch() {
    if (!exerciceId) return
    setLoading(true)
    setErr("")
    setOk("")
    try {
      const r = await autoMatchRapprochementBancaire({ exerciceId, du, au })
      setOk(`${r.data.matches ?? 0} rapprochement(s) automatique(s).`)
      await actualiser()
    } catch {
      setErr("Échec de l'auto-rapprochement.")
    } finally {
      setLoading(false)
    }
  }

  async function onRapprocher() {
    if (!selectedMouvementId || !selectedEcritureId) return
    setErr("")
    try {
      await rapprocherMouvementBancaire({
        mouvementId: selectedMouvementId,
        ecritureId: selectedEcritureId,
      })
      setSelectedEcritureId("")
      setOk("Mouvement rapproché.")
      await actualiser()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Échec du rapprochement.")
    }
  }

  async function onDissocier() {
    if (!selectedMouvementId) return
    await dissocierMouvementBancaire(selectedMouvementId)
    setOk("Rapprochement annulé.")
    await actualiser()
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    try {
      const u = Cookies.get("user")
      const role = u ? (JSON.parse(u) as { role?: string }).role : ""
      setCanUnlock(role === "EXPERT_COMPTABLE" || role === "ADMIN_CABINET")
    } catch {
      setCanUnlock(false)
    }
    setAuthLoading(false)
    loadClients().catch(() => setErr("Impossible de charger les clients."))
  }, [router])

  useEffect(() => {
    if (exerciceId) actualiser().catch(() => setErr("Impossible de charger le rapprochement bancaire."))
  }, [exerciceId]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="no-print">
          <h1 className="text-3xl font-bold text-gray-900">Rapprochement bancaire</h1>
          <p className="text-gray-500 mt-1 mb-4">Associez relevés bancaires et écritures comptables</p>

          {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
          {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
              <option value="">Client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={exerciceId} onChange={e => setExerciceId(e.target.value)} disabled={!clientId}>
              <option value="">Exercice</option>
              {exercices.map(e => <option key={e.id} value={e.id}>{e.annee}</option>)}
            </select>
            <DatePickerFr
              value={du}
              onChange={setDu}
              placeholder="Date début"
              fromYear={1990}
              toYear={new Date().getFullYear() + 1}
            />
            <DatePickerFr
              value={au}
              onChange={setAu}
              placeholder="Date fin"
              fromYear={1990}
              toYear={new Date().getFullYear() + 1}
            />
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={statut} onChange={e => setStatut(e.target.value)}>
              <option value="TOUS">Tous</option>
              <option value="NON_RAPPROCHE">Non rapprochés</option>
              <option value="A_VERIFIER">À vérifier</option>
              <option value="RAPPROCHE">Rapprochés</option>
              <option value="IGNORE">Ignorés</option>
            </select>
            <button className="rounded-xl bg-orange-500 text-white px-4 py-2.5 text-sm font-semibold hover:bg-orange-600" onClick={actualiser} disabled={!exerciceId || loading}>
              {loading ? "Chargement…" : "Actualiser"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher libellé, référence..."
              className="flex-1 min-w-[240px] rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
            <label className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-50">
              Importer relevé (CSV)
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={stats.verrouille}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) onImportCsv(f).catch(() => setErr("Échec de l'import CSV. Vérifie le format du fichier."))
                  e.currentTarget.value = ""
                }}
              />
            </label>
            <button className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60" onClick={onAutoMatch} disabled={!exerciceId || loading || stats.verrouille}>
              Lancer auto-rapprochement
            </button>
            <button
              className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-60"
              disabled={!exerciceId || loading || stats.verrouille}
              onClick={async () => {
                try {
                  setErr("")
                  await validerRapprochementMois({ exerciceId, du, au })
                  setOk("Rapprochement du mois validé et verrouillé.")
                  await actualiser()
                } catch (e: unknown) {
                  const msg = (e as { response?: { data?: { error?: string; restants?: number } } })?.response?.data
                  if (msg?.restants) setErr(`${msg.error} Restants: ${msg.restants}.`)
                  else setErr(msg?.error || "Échec de la validation du mois.")
                }
              }}
            >
              Valider le rapprochement du mois
            </button>
            <button
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              onClick={() => {
                document.title = `RAPPROCHEMENT_${clientLabel.replace(/\s+/g, "_")}_${du}_${au}`
                window.print()
              }}
              disabled={!exerciceId}
            >
              Exporter PDF
            </button>
          </div>
            {stats.verrouille && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-emerald-700">
                  Période verrouillée : import, auto-rapprochement et modifications manuelles désactivés.
                </p>
                {canUnlock && (
                  <button
                    className="px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-xs font-semibold hover:bg-orange-100"
                    onClick={async () => {
                      try {
                        setErr("")
                        await deverrouillerRapprochementMois({ exerciceId, du, au })
                        setOk("Période déverrouillée.")
                        await actualiser()
                      } catch (e: unknown) {
                        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                        setErr(msg || "Échec du déverrouillage.")
                      }
                    }}
                  >
                    Déverrouiller la période
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Mouvements banque</p><p className="text-2xl font-bold text-gray-900">{stats.mouvements}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Écritures comptables</p><p className="text-2xl font-bold text-gray-900">{stats.ecritures}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Taux de rapprochement</p><p className="text-2xl font-bold text-emerald-600">{stats.tauxRapprochement}%</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Écart restant</p><p className="text-2xl font-bold text-red-600">{fcfa(n(stats.ecartRestant))}</p></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Mouvements bancaires</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="text-left py-3 px-3">Date</th>
                    <th className="text-left py-3 px-3">Libellé</th>
                    <th className="text-right py-3 px-3">Débit</th>
                    <th className="text-right py-3 px-3">Crédit</th>
                    <th className="text-center py-3 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mouvements.map(m => (
                    <tr key={m.id} className={`cursor-pointer ${selectedMouvementId === m.id ? "bg-orange-50" : ""}`} onClick={() => setSelectedMouvementId(m.id)}>
                      <td className="py-2.5 px-3 whitespace-nowrap">{fmtDate(m.dateOperation)}</td>
                      <td className="py-2.5 px-3">{m.libelle}</td>
                      <td className="py-2.5 px-3 text-right">{fcfa(n(m.debit))}</td>
                      <td className="py-2.5 px-3 text-right">{fcfa(n(m.credit))}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          m.statut === "RAPPROCHE" ? "bg-emerald-100 text-emerald-700" :
                          m.statut === "A_VERIFIER" ? "bg-orange-100 text-orange-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {m.statut === "RAPPROCHE" ? "Rapproché" : m.statut === "A_VERIFIER" ? "À vérifier" : m.statut === "IGNORE" ? "Ignoré" : "Non rapproché"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {mouvements.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-500">Aucun mouvement bancaire.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-900">Écritures comptables candidates</span>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 disabled:opacity-60" onClick={onRapprocher} disabled={!selectedMouvementId || !selectedEcritureId || stats.verrouille}>Rapprocher</button>
                <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 disabled:opacity-60" onClick={onDissocier} disabled={!selectedMouvementId || stats.verrouille}>Dissocier</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="text-left py-3 px-3">Date</th>
                    <th className="text-left py-3 px-3">Journal</th>
                    <th className="text-left py-3 px-3">Pièce</th>
                    <th className="text-left py-3 px-3">Libellé</th>
                    <th className="text-right py-3 px-3">Montant</th>
                    <th className="text-right py-3 px-3">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ecrituresCandidates.map(e => (
                    <tr key={e.id} className={`cursor-pointer ${selectedEcritureId === e.id ? "bg-orange-50" : ""}`} onClick={() => setSelectedEcritureId(e.id)}>
                      <td className="py-2.5 px-3 whitespace-nowrap">{fmtDate(e.dateOperation)}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{e.journal}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{e.pieceRef || "—"}</td>
                      <td className="py-2.5 px-3">{e.libelle}</td>
                      <td className="py-2.5 px-3 text-right">{fcfa(Math.abs(n(e.montantBanque ?? e.net)))}</td>
                      <td className="py-2.5 px-3 text-right">{(e as Ecriture & { score?: number }).score ?? "—"}%</td>
                    </tr>
                  ))}
                  {ecrituresCandidates.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">Aucune écriture candidate.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="hidden print:block mt-4">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Rapprochement bancaire mensuel</h2>
          <p className="text-sm text-gray-600 mb-1">
            Client: {clientLabel} · Exercice: {exerciceLabel} · Période: {fmtDate(du)} → {fmtDate(au)}
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Statut période: {stats.verrouille ? "Validée / Verrouillée" : "Non validée"}
          </p>

          <table className="w-full text-sm border-separate [border-spacing:0]">
            <thead>
              <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 px-2 whitespace-nowrap">Date</th>
                <th className="text-left py-2 px-2">Libellé</th>
                <th className="text-right py-2 px-2 whitespace-nowrap">Débit</th>
                <th className="text-right py-2 px-2 whitespace-nowrap">Crédit</th>
                <th className="text-center py-2 px-2 whitespace-nowrap">Statut</th>
              </tr>
            </thead>
            <tbody>
              {mouvements.map(m => (
                <tr key={`print-${m.id}`} className="border-b border-gray-100">
                  <td className="py-2 px-2 whitespace-nowrap">{fmtDate(m.dateOperation)}</td>
                  <td className="py-2 px-2">{m.libelle}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(n(m.debit))}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(n(m.credit))}</td>
                  <td className="py-2 px-2 text-center whitespace-nowrap">
                    {m.statut === "RAPPROCHE" ? "Rapproché" : m.statut === "A_VERIFIER" ? "À vérifier" : m.statut === "IGNORE" ? "Ignoré" : "Non rapproché"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t border-gray-300">
                <td className="py-2 px-2">Total</td>
                <td className="py-2 px-2" />
                <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(totalDebit)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(totalCredit)}</td>
                <td className="py-2 px-2 text-center whitespace-nowrap">{stats.tauxRapprochement}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Layout>
  )
}

