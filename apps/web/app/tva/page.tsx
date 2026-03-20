"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { api, deverrouillerTvaMensuelle, getClients, getTvaMensuelle, validerTvaMensuelle } from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Exercice = { id: string; annee: number }

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

function csvCell(v: string | number) {
  const s = String(v ?? "")
  return `"${s.replace(/"/g, '""')}"`
}

function toUtf16Le(s: string) {
  const bytes = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    bytes[i * 2] = code & 0xff
    bytes[i * 2 + 1] = code >> 8
  }
  return bytes
}

export default function TvaPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState("")
  const [err, setErr] = useState("")
  const [canUnlock, setCanUnlock] = useState(false)

  const [clients, setClients] = useState<Client[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [clientNom, setClientNom] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [mois, setMois] = useState<number>(new Date().getMonth() + 1)
  const [annee, setAnnee] = useState<number>(new Date().getFullYear())
  const [verrouille, setVerrouille] = useState(false)
  const [historique, setHistorique] = useState<Array<{ action: string; createdAt: string }>>([])
  const [kpi, setKpi] = useState({
    baseCollecteeHt: "0",
    tvaCollectee: "0",
    baseDeductibleHt: "0",
    tvaDeductible: "0",
    ttcCollecte: "0",
    netTva: "0",
    tvaAPayer: "0",
    creditTva: "0",
  })

  async function loadClients() {
    const r = await getClients()
    setClients((r.data.clients ?? []) as Client[])
  }

  async function onClientChange(id: string) {
    setClientId(id)
    setExerciceId("")
    setExercices([])
    const c = clients.find(x => x.id === id)
    setClientNom(c?.nomRaisonSociale ?? "")
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
      const r = await getTvaMensuelle({ exerciceId, mois, annee })
      setKpi(r.data.kpi ?? kpi)
      setVerrouille(Boolean(r.data.verrouille))
      setHistorique((r.data.historique ?? []) as Array<{ action: string; createdAt: string }>)
      if (r.data.client?.nomRaisonSociale) setClientNom(String(r.data.client.nomRaisonSociale))
      setOk("Synthèse TVA actualisée.")
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Impossible de charger la synthèse TVA.")
    } finally {
      setLoading(false)
    }
  }

  function exportCsv() {
    const rows = [
      ["Indicateur", "Montant FCFA"],
      ["Base HT collectée", n(kpi.baseCollecteeHt)],
      ["TVA collectée", n(kpi.tvaCollectee)],
      ["Base HT déductible", n(kpi.baseDeductibleHt)],
      ["TVA déductible", n(kpi.tvaDeductible)],
      ["Net TVA", n(kpi.netTva)],
      ["TVA à payer", n(kpi.tvaAPayer)],
      ["Crédit TVA", n(kpi.creditTva)],
    ]
    const body = rows.map(r => `${csvCell(r[0])};${csvCell(r[1])}`).join("\r\n")
    const content = `sep=;\r\n${body}\r\n`
    const bomUtf16Le = new Uint8Array([0xff, 0xfe])
    const blob = new Blob([bomUtf16Le, toUtf16Le(content)], { type: "text/csv;charset=utf-16le;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `TVA_${annee}_${String(mois).padStart(2, "0")}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
    if (ok || err) {
      const t = setTimeout(() => {
        setOk("")
        setErr("")
      }, 3500)
      return () => clearTimeout(t)
    }
  }, [ok, err])

  useEffect(() => {
    if (exerciceId) actualiser().catch(() => setErr("Impossible de charger la synthèse TVA."))
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
          <h1 className="text-3xl font-bold text-gray-900">TVA mensuelle</h1>
          <p className="text-gray-500 mt-1 mb-4">Calculez et validez votre déclaration TVA par période</p>

          {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
          {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4">
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
              <button className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={exportCsv} disabled={!exerciceId}>
                Exporter CSV
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  document.title = `TVA_${annee}_${String(mois).padStart(2, "0")}`
                  window.print()
                }}
                disabled={!exerciceId}
              >
                Exporter PDF
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60"
                disabled={!exerciceId || verrouille}
                onClick={async () => {
                  try {
                    setErr("")
                    await validerTvaMensuelle({ exerciceId, mois, annee })
                    setOk("Déclaration TVA validée.")
                    await actualiser()
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    setErr(msg || "Échec de validation TVA.")
                  }
                }}
              >
                Valider la déclaration TVA
              </button>
              {verrouille && canUnlock && (
                <button
                  className="px-4 py-2 rounded-xl border border-orange-200 bg-orange-50 text-orange-700 text-sm font-semibold hover:bg-orange-100"
                  onClick={async () => {
                    try {
                      setErr("")
                      await deverrouillerTvaMensuelle({ exerciceId, mois, annee })
                      setOk("Période TVA déverrouillée.")
                      await actualiser()
                    } catch (e: unknown) {
                      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                      setErr(msg || "Échec du déverrouillage TVA.")
                    }
                  }}
                >
                  Déverrouiller la période
                </button>
              )}
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${verrouille ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>
                {verrouille ? "Validée" : "Non validée"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">TVA collectée</p><p className="text-2xl font-bold text-orange-600">{fcfa(n(kpi.tvaCollectee))}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">TVA déductible</p><p className="text-2xl font-bold text-indigo-600">{fcfa(n(kpi.tvaDeductible))}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">TVA à payer</p><p className="text-2xl font-bold text-red-600">{fcfa(n(kpi.tvaAPayer))}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Crédit TVA</p><p className="text-2xl font-bold text-emerald-600">{fcfa(n(kpi.creditTva))}</p></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 no-print">
            <h3 className="font-bold text-gray-900 mb-3">Synthèse TVA de la période</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-gray-100"><td className="py-2 text-gray-600">Base HT collectée</td><td className="py-2 text-right font-semibold">{fcfa(n(kpi.baseCollecteeHt))}</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 text-gray-600">TVA collectée</td><td className="py-2 text-right font-semibold">{fcfa(n(kpi.tvaCollectee))}</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 text-gray-600">Base HT déductible</td><td className="py-2 text-right font-semibold">{fcfa(n(kpi.baseDeductibleHt))}</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 text-gray-600">TVA déductible</td><td className="py-2 text-right font-semibold">{fcfa(n(kpi.tvaDeductible))}</td></tr>
                  <tr className="border-b border-gray-100"><td className="py-2 text-gray-600">Net TVA</td><td className={`py-2 text-right font-bold ${n(kpi.netTva) >= 0 ? "text-red-700" : "text-emerald-700"}`}>{fcfa(Math.abs(n(kpi.netTva)))}</td></tr>
                  <tr><td className="py-2 text-gray-600">Total TTC collecté</td><td className="py-2 text-right font-semibold">{fcfa(n(kpi.ttcCollecte))}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <aside className="bg-white/95 rounded-2xl border border-gray-100 p-4 no-print self-start h-fit">
            <h3 className="font-bold text-gray-900 mb-3">Historique de validation</h3>
            <div className="space-y-2">
              {historique.map((h, i) => (
                <div key={`${h.action}-${i}`} className="rounded-xl border border-gray-100 px-3 py-2">
                  <p className="text-xs font-semibold text-gray-700">{h.action === "TVA_MENSUELLE_VALIDEE" ? "Validation TVA" : "Déverrouillage TVA"}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{new Date(h.createdAt).toLocaleString("fr-FR")}</p>
                </div>
              ))}
              {historique.length === 0 && <p className="text-sm text-gray-500">Aucun historique pour cette période.</p>}
            </div>
          </aside>
        </div>

        {exerciceId && (
          <div className="hidden print:block mt-4">
            <div className="flex items-start justify-between gap-6 mb-5 pb-4 border-b border-gray-200">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">DECLARATION TVA</h2>
                <p className="text-sm text-gray-600 mt-1">IvoireCompta</p>
                <p className="text-xs text-gray-500">Cabinet d&apos;expertise comptable</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">Période: {MOIS[mois - 1]} {annee}</p>
                <p className="text-xs text-gray-600 mt-1">Client: {clientNom || "-"}</p>
                <p className="text-xs text-gray-600">Statut: {verrouille ? "Validée" : "Brouillon"}</p>
              </div>
            </div>
            <table className="w-full text-sm border-separate [border-spacing:0]">
              <tbody>
                <tr className="border-b border-gray-100"><td className="py-2 px-2">Base HT collectée</td><td className="py-2 px-2 text-right">{fcfa(n(kpi.baseCollecteeHt))}</td></tr>
                <tr className="border-b border-gray-100"><td className="py-2 px-2">TVA collectée</td><td className="py-2 px-2 text-right">{fcfa(n(kpi.tvaCollectee))}</td></tr>
                <tr className="border-b border-gray-100"><td className="py-2 px-2">Base HT déductible</td><td className="py-2 px-2 text-right">{fcfa(n(kpi.baseDeductibleHt))}</td></tr>
                <tr className="border-b border-gray-100"><td className="py-2 px-2">TVA déductible</td><td className="py-2 px-2 text-right">{fcfa(n(kpi.tvaDeductible))}</td></tr>
                <tr className="font-bold border-b border-gray-200"><td className="py-2 px-2">TVA à payer</td><td className="py-2 px-2 text-right">{fcfa(n(kpi.tvaAPayer))}</td></tr>
                <tr className="font-bold"><td className="py-2 px-2">Crédit TVA</td><td className="py-2 px-2 text-right">{fcfa(n(kpi.creditTva))}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}

