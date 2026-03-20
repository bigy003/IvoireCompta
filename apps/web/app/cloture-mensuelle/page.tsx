"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import {
  api,
  deverrouillerClotureMensuelle,
  getClients,
  getClotureMensuelle,
  validerClotureMensuelle,
} from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Exercice = { id: string; annee: number }
type Check = { code: string; label: string; ok: boolean }
type Anomalie = { type: string; reference: string; gravite: string }

function n(v: string | number) {
  if (typeof v === "number") return v
  const x = parseInt(v, 10)
  return Number.isNaN(x) ? 0 : x
}
function fcfa(v: number) {
  return `${v.toLocaleString("fr-FR")} FCFA`
}

const MOIS = [
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

export default function ClotureMensuellePage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState("")
  const [err, setErr] = useState("")
  const [canUnlock, setCanUnlock] = useState(false)

  const [clients, setClients] = useState<Client[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [mois, setMois] = useState<number>(new Date().getMonth() + 1)
  const [annee, setAnnee] = useState<number>(new Date().getFullYear())
  const [commentaire, setCommentaire] = useState("")
  const [confirmation, setConfirmation] = useState(false)

  const [kpi, setKpi] = useState({
    ecrituresMois: 0,
    ecrituresValidees: 0,
    tauxRapprochement: 0,
    ecartDebitCredit: "0",
  })
  const [checklist, setChecklist] = useState<Check[]>([])
  const [anomalies, setAnomalies] = useState<Anomalie[]>([])
  const [verrouille, setVerrouille] = useState(false)
  const [historique, setHistorique] = useState<Array<{ action: string; createdAt: string }>>([])

  const tousConformes = useMemo(() => checklist.length > 0 && checklist.every(c => c.ok), [checklist])

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
    setErr("")
    setOk("")
    try {
      const r = await getClotureMensuelle({ exerciceId, mois, annee })
      setKpi(r.data.kpi ?? kpi)
      setChecklist((r.data.checklist ?? []) as Check[])
      setAnomalies((r.data.anomalies ?? []) as Anomalie[])
      setVerrouille(Boolean(r.data.verrouille))
      setHistorique((r.data.historique ?? []) as Array<{ action: string; createdAt: string }>)
      setOk("Clôture mensuelle actualisée.")
    } catch {
      setErr("Impossible de charger la clôture mensuelle.")
    } finally {
      setLoading(false)
    }
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
    if (exerciceId) actualiser().catch(() => setErr("Impossible de charger la clôture mensuelle."))
  }, [exerciceId, mois, annee]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <h1 className="text-3xl font-bold text-gray-900">Clôture mensuelle</h1>
          <p className="text-gray-500 mt-1 mb-4">Vérifiez, validez et verrouillez la période comptable</p>

          {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
          {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
                <option value="">Client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
              </select>
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={exerciceId} onChange={e => setExerciceId(e.target.value)} disabled={!clientId}>
                <option value="">Exercice</option>
                {exercices.map(e => <option key={e.id} value={e.id}>{e.annee}</option>)}
              </select>
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={mois} onChange={e => setMois(Number(e.target.value))}>
                {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" value={annee} onChange={e => setAnnee(Number(e.target.value) || new Date().getFullYear())} />
              <button className="rounded-xl bg-orange-500 text-white px-4 py-2 text-sm font-semibold hover:bg-orange-600" onClick={actualiser} disabled={!exerciceId || loading}>
                {loading ? "Chargement…" : "Actualiser"}
              </button>
              <button
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  document.title = `CLOTURE_MENSUELLE_${annee}_${String(mois).padStart(2, "0")}`
                  window.print()
                }}
                disabled={!exerciceId}
              >
                Exporter PDF de clôture
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60"
                disabled={!exerciceId || verrouille || !tousConformes || !confirmation || commentaire.trim().length < 3}
                onClick={async () => {
                  try {
                    setErr("")
                    await validerClotureMensuelle({ exerciceId, mois, annee, commentaire, confirmation })
                    setOk("Mois clôturé et verrouillé.")
                    await actualiser()
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    setErr(msg || "Échec de la clôture mensuelle.")
                  }
                }}
              >
                Clôturer le mois
              </button>
              {verrouille && canUnlock && (
                <button
                  className="px-4 py-2 rounded-xl border border-orange-200 bg-orange-50 text-orange-700 text-sm font-semibold hover:bg-orange-100"
                  onClick={async () => {
                    try {
                      setErr("")
                      await deverrouillerClotureMensuelle({ exerciceId, mois, annee })
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
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${verrouille ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>
                {verrouille ? "Clôturée" : "Ouverte"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Écritures du mois</p><p className="text-2xl font-bold text-gray-900">{kpi.ecrituresMois}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Écritures validées</p><p className="text-2xl font-bold text-gray-900">{kpi.ecrituresValidees}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Rapprochements bancaires</p><p className="text-2xl font-bold text-emerald-600">{kpi.tauxRapprochement}%</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Écart débit/crédit</p><p className={`text-2xl font-bold ${n(kpi.ecartDebitCredit) === 0 ? "text-emerald-600" : "text-red-600"}`}>{fcfa(n(kpi.ecartDebitCredit))}</p></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 no-print">
          <div className="space-y-4">
            <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
              <h3 className="font-bold text-gray-900 mb-3">Check-list de contrôle</h3>
              <div className="space-y-2">
                {checklist.map(c => (
                  <div key={c.code} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                    <span className="text-sm text-gray-700">{c.label}</span>
                    <span className={`text-xs font-semibold ${c.ok ? "text-emerald-700" : "text-red-700"}`}>{c.ok ? "Conforme" : "À corriger"}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
              <h3 className="font-bold text-gray-900 mb-3">Anomalies détectées</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                      <th className="text-left py-2">Type</th>
                      <th className="text-left py-2">Référence</th>
                      <th className="text-left py-2">Gravité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomalies.map((a, i) => (
                      <tr key={`${a.type}-${i}`} className="border-b border-gray-50">
                        <td className="py-2">{a.type}</td>
                        <td className="py-2">{a.reference}</td>
                        <td className="py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${a.gravite === "Élevée" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>{a.gravite}</span>
                        </td>
                      </tr>
                    ))}
                    {anomalies.length === 0 && <tr><td className="py-6 text-gray-500" colSpan={3}>Aucune anomalie détectée.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
              <h3 className="font-bold text-gray-900 mb-3">Validation & audit</h3>
              <textarea
                value={commentaire}
                onChange={e => setCommentaire(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                placeholder="Commentaire obligatoire"
              />
              <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={confirmation} onChange={e => setConfirmation(e.target.checked)} className="mt-0.5" />
                <span>Je confirme les contrôles de fin de mois.</span>
              </label>
            </div>
            <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
              <h3 className="font-bold text-gray-900 mb-3">Historique</h3>
              <div className="space-y-2 text-sm">
                {historique.map((h, i) => (
                  <div key={`${h.action}-${i}`} className="rounded-lg border border-gray-100 px-3 py-2">
                    <p className="font-semibold text-gray-800">{h.action === "CLOTURE_MENSUELLE_VALIDEE" ? "Clôturé" : "Déverrouillé"}</p>
                    <p className="text-gray-500">{new Date(h.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                ))}
                {historique.length === 0 && <p className="text-gray-500">Aucun historique.</p>}
              </div>
            </div>
          </aside>
        </div>

        <div className="hidden print:block">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Rapport de clôture mensuelle</h2>
          <p className="text-sm text-gray-600 mb-4">
            Mois: {MOIS[mois - 1]} {annee} · État: {verrouille ? "Clôturée" : "Ouverte"}
          </p>
          <table className="w-full text-sm border-separate [border-spacing:0]">
            <thead>
              <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 px-2">Contrôle</th>
                <th className="text-left py-2 px-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map(c => (
                <tr key={`p-${c.code}`} className="border-b border-gray-100">
                  <td className="py-2 px-2">{c.label}</td>
                  <td className="py-2 px-2">{c.ok ? "Conforme" : "À corriger"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}

