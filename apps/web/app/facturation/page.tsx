"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import {
  addPaiementFacture,
  api,
  createFacture,
  createDevis,
  convertirDevisEnFacture,
  getDevis,
  getClients,
  getFactures,
  previewRelancesFactures,
  runRelancesFactures,
  setStatutDevis,
} from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Facture = {
  id: string
  numero: string
  dateEmission: string
  dateEcheance: string
  statut: "BROUILLON" | "EMISE" | "PARTIELLEMENT_PAYEE" | "PAYEE" | "EN_RETARD"
  tvaTaux?: string
  sousTotalHt?: string
  montantTva?: string
  totalTtc: string
  montantPaye: string
  resteAPayer: string
  notes?: string | null
  client: { id: string; nomRaisonSociale: string }
  lignes?: Array<{ description: string; quantite: string; prixUnitaireHt: string; totalLigneHt: string }>
}
type Relance = {
  factureId: string
  numero: string
  clientId: string
  client: string
  dateEcheance: string
  resteAPayer: string
  retardJours: number
  canalSuggere: "EMAIL" | "WHATSAPP" | "MANUEL"
  message: string
}
type Devis = {
  id: string
  numero: string
  dateEmission: string
  dateValidite: string
  statut: "BROUILLON" | "ENVOYE" | "ACCEPTE" | "REFUSE" | "EXPIRE" | "CONVERTI"
  tvaTaux?: string
  sousTotalHt?: string
  montantTva?: string
  totalTtc: string
  notes?: string | null
  client: { id: string; nomRaisonSociale: string }
  lignes: Array<{ description: string; quantite: string; prixUnitaireHt: string; totalLigneHt: string }>
}

function n(v: string | number) {
  if (typeof v === "number") return v
  const x = parseInt(v, 10)
  return Number.isNaN(x) ? 0 : x
}
function fcfa(v: number) {
  return `${v.toLocaleString("fr-FR")} FCFA`
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR")
  } catch {
    return iso
  }
}

export default function FacturationPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState("")
  const [err, setErr] = useState("")

  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState("")
  const [statut, setStatut] = useState("TOUS")
  const [du, setDu] = useState(ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [au, setAu] = useState(ymd(new Date()))
  const [search, setSearch] = useState("")

  const [factures, setFactures] = useState<Facture[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [kpi, setKpi] = useState({ caMois: "0", facturesEmises: 0, impayes: "0", tauxEncaissement: 0 })

  const [showCreate, setShowCreate] = useState(false)
  const [showCreateDevis, setShowCreateDevis] = useState(false)
  const [showRelances, setShowRelances] = useState(false)
  const [relances, setRelances] = useState<Relance[]>([])
  const [devis, setDevis] = useState<Devis[]>([])
  const [selectedDevisId, setSelectedDevisId] = useState("")
  const selectedDevis = useMemo(() => devis.find(d => d.id === selectedDevisId) ?? null, [devis, selectedDevisId])
  const [printMode, setPrintMode] = useState<"facture" | "devis" | null>(null)
  const [createForm, setCreateForm] = useState({
    clientId: "",
    dateEmission: ymd(new Date()),
    dateEcheance: ymd(new Date()),
    notes: "",
    tvaTaux: "18",
    lignes: [{ description: "", quantite: "1", prixUnitaireHt: "0" }],
  })
  const [createDevisForm, setCreateDevisForm] = useState({
    clientId: "",
    dateEmission: ymd(new Date()),
    dateValidite: ymd(new Date()),
    notes: "",
    tvaTaux: "18",
    lignes: [{ description: "", quantite: "1", prixUnitaireHt: "0" }],
  })

  const selected = useMemo(() => factures.find(f => f.id === selectedId) ?? null, [factures, selectedId])
  const createSousTotalHt = useMemo(
    () => createForm.lignes.reduce((s, l) => s + Math.round(Number(l.quantite || "0") * Number(l.prixUnitaireHt || "0")), 0),
    [createForm.lignes]
  )
  const createMontantTva = useMemo(
    () => Math.round((createSousTotalHt * Number(createForm.tvaTaux || "0")) / 100),
    [createSousTotalHt, createForm.tvaTaux]
  )
  const createTotalTtc = createSousTotalHt + createMontantTva

  async function chargerRelances() {
    const r = await previewRelancesFactures(clientId ? { clientId } : undefined)
    setRelances((r.data.relances ?? []) as Relance[])
  }

  async function actualiser() {
    setLoading(true)
    setErr("")
    setOk("")
    try {
      const r = await getFactures({ clientId, statut, du, au, search })
      const rd = await getDevis({ clientId, statut: "TOUS", du, au, search })
      setFactures((r.data.factures ?? []) as Facture[])
      setDevis((rd.data.devis ?? []) as Devis[])
      setKpi(r.data.kpi ?? kpi)
      if (!selectedId && r.data.factures?.[0]?.id) setSelectedId(r.data.factures[0].id)
      setOk("Facturation actualisée.")
    } catch {
      setErr("Impossible de charger la facturation.")
    } finally {
      setLoading(false)
    }
  }

  async function onCreateFacture(statutFacture: "BROUILLON" | "EMISE") {
    try {
      setErr("")
      const lignesValides = createForm.lignes
        .map(l => ({
          description: l.description.trim(),
          quantite: Number(l.quantite),
          prixUnitaireHt: Number(l.prixUnitaireHt),
        }))
        .filter(
          l =>
            l.description.length > 0 &&
            Number.isFinite(l.quantite) &&
            l.quantite > 0 &&
            Number.isFinite(l.prixUnitaireHt) &&
            l.prixUnitaireHt >= 0
        )

      if (lignesValides.length === 0) {
        setErr("Ajoute au moins une ligne de facture valide.")
        return
      }
      const payload = {
        clientId: createForm.clientId,
        dateEmission: createForm.dateEmission,
        dateEcheance: createForm.dateEcheance,
        notes: createForm.notes || undefined,
        tvaTaux: Number(createForm.tvaTaux),
        statut: statutFacture,
        lignes: lignesValides,
      }
      await createFacture(payload)
      setShowCreate(false)
      setCreateForm({
        clientId: createForm.clientId || clientId || "",
        dateEmission: ymd(new Date()),
        dateEcheance: ymd(new Date()),
        notes: "",
        tvaTaux: "18",
        lignes: [{ description: "", quantite: "1", prixUnitaireHt: "0" }],
      })
      setOk(statutFacture === "BROUILLON" ? "Facture enregistrée en brouillon." : "Facture émise.")
      await actualiser()
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      const data = (e as { response?: { data?: { error?: string; erreurs?: unknown } } })?.response?.data
      if (status === 404) {
        setErr("Endpoint facturation introuvable (API non redémarrée ?). Redémarre l’API puis réessaie.")
        return
      }
      if (data?.error) {
        setErr(data.error)
        return
      }
      if (data?.erreurs) {
        const er = data.erreurs as Record<string, unknown>
        const joined = Object.values(er)
          .flatMap(v => (Array.isArray(v) ? v.map(String) : [String(v)]))
          .join(" · ")
        setErr(joined || "Données invalides pour la facture.")
        return
      }
      setErr("Échec de création de facture.")
    }
  }

  async function onCreateDevis(statutDevis: "BROUILLON" | "ENVOYE") {
    try {
      setErr("")
      const lignesValides = createDevisForm.lignes
        .map(l => ({ description: l.description.trim(), quantite: Number(l.quantite), prixUnitaireHt: Number(l.prixUnitaireHt) }))
        .filter(l => l.description && l.quantite > 0 && l.prixUnitaireHt >= 0)
      if (lignesValides.length === 0) {
        setErr("Ajoute au moins une ligne de devis valide.")
        return
      }
      await createDevis({
        clientId: createDevisForm.clientId,
        dateEmission: createDevisForm.dateEmission,
        dateValidite: createDevisForm.dateValidite,
        notes: createDevisForm.notes || undefined,
        tvaTaux: Number(createDevisForm.tvaTaux),
        statut: statutDevis,
        lignes: lignesValides,
      })
      setShowCreateDevis(false)
      setOk("Devis créé.")
      await actualiser()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Échec création devis.")
    }
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
    getClients().then(r => setClients((r.data.clients ?? []) as Client[])).catch(() => setErr("Impossible de charger les clients."))
  }, [router])

  useEffect(() => {
    actualiser().catch(() => setErr("Impossible de charger la facturation."))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ok) return
    const t = window.setTimeout(() => setOk(""), 3000)
    return () => window.clearTimeout(t)
  }, [ok])

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
          <h1 className="text-3xl font-bold text-gray-900">Facturation</h1>
          <p className="text-gray-500 mt-1 mb-4">Créez, suivez et encaissez vos factures</p>

          {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
          {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}
        </div>

        <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 space-y-3 no-print">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">Client (tous)</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={statut} onChange={e => setStatut(e.target.value)}>
              <option value="TOUS">Tous</option>
              <option value="BROUILLON">Brouillon</option>
              <option value="EMISE">Émise</option>
              <option value="PARTIELLEMENT_PAYEE">Partiellement payée</option>
              <option value="PAYEE">Payée</option>
              <option value="EN_RETARD">En retard</option>
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
            <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={search} onChange={e => setSearch(e.target.value)} placeholder="Numéro, client..." />
            <button className="rounded-xl bg-orange-500 text-white px-4 py-2 text-sm font-semibold hover:bg-orange-600" onClick={actualiser} disabled={loading}>
              {loading ? "Chargement…" : "Actualiser"}
            </button>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setShowCreate(v => !v)}>
              {showCreate ? "Fermer création" : "Nouvelle facture"}
            </button>
            <button className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setShowCreateDevis(v => !v)}>
              {showCreateDevis ? "Fermer devis" : "Nouveau devis"}
            </button>
            <button
              className="px-4 py-2 rounded-xl border border-orange-200 bg-orange-50 text-sm font-semibold text-orange-700 hover:bg-orange-100"
              onClick={async () => {
                await chargerRelances()
                setShowRelances(true)
              }}
            >
              Relancer les impayés
            </button>
          </div>
        </div>

        {showRelances && (
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 no-print">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">Relances impayés</h3>
              <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => setShowRelances(false)}>Fermer</button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {relances.map(r => (
                <div key={r.factureId} className="rounded-xl border border-gray-100 p-3">
                  <p className="text-sm font-semibold text-gray-900">{r.numero} — {r.client}</p>
                  <p className="text-xs text-gray-500">
                    Échéance: {fmtDate(r.dateEcheance)} · Retard: {r.retardJours} j · Reste: {fcfa(n(r.resteAPayer))}
                  </p>
                  <p className="text-xs text-gray-700 mt-1">{r.message}</p>
                </div>
              ))}
              {relances.length === 0 && <p className="text-sm text-gray-500">Aucune relance à effectuer.</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60"
                disabled={relances.length === 0}
                onClick={async () => {
                  try {
                    const payload = relances.map(r => r.factureId)
                    const res = await runRelancesFactures({ factureIds: payload, canal: "MANUEL" })
                    setOk(`${res.data.sent ?? 0} relance(s) journalisée(s).`)
                    await chargerRelances()
                    await actualiser()
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    setErr(msg || "Échec de l’envoi des relances.")
                  }
                }}
              >
                Lancer relances
              </button>
            </div>
          </div>
        )}

        {showCreateDevis && (
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 no-print">
            <h3 className="font-bold text-gray-900 mb-3">Nouveau devis</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={createDevisForm.clientId} onChange={e => setCreateDevisForm(v => ({ ...v, clientId: e.target.value }))}>
                <option value="">Client *</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
              </select>
              <DatePickerFr value={createDevisForm.dateEmission} onChange={v => setCreateDevisForm(s => ({ ...s, dateEmission: v }))} placeholder="Date émission" fromYear={1990} toYear={new Date().getFullYear() + 1} />
              <DatePickerFr value={createDevisForm.dateValidite} onChange={v => setCreateDevisForm(s => ({ ...s, dateValidite: v }))} placeholder="Date validité" fromYear={1990} toYear={new Date().getFullYear() + 1} />
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={createDevisForm.tvaTaux} onChange={e => setCreateDevisForm(v => ({ ...v, tvaTaux: e.target.value }))}>
                <option value="18">TVA 18%</option><option value="0">TVA 0% (exonéré)</option>
              </select>
            </div>
            <input className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm mb-3" value={createDevisForm.notes} onChange={e => setCreateDevisForm(v => ({ ...v, notes: e.target.value }))} placeholder="Notes / conditions" />
            <div className="space-y-2">
              {createDevisForm.lignes.map((l, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm md:col-span-2" value={l.description} onChange={e => setCreateDevisForm(v => ({ ...v, lignes: v.lignes.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x) }))} placeholder="Description" />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" min={1} value={l.quantite} onChange={e => setCreateDevisForm(v => ({ ...v, lignes: v.lignes.map((x, idx) => idx === i ? { ...x, quantite: e.target.value } : x) }))} placeholder="Quantité" />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" min={0} value={l.prixUnitaireHt} onChange={e => setCreateDevisForm(v => ({ ...v, lignes: v.lignes.map((x, idx) => idx === i ? { ...x, prixUnitaireHt: e.target.value } : x) }))} placeholder="Prix unitaire HT" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm" onClick={() => setCreateDevisForm(v => ({ ...v, lignes: [...v.lignes, { description: "", quantite: "1", prixUnitaireHt: "0" }] }))}>+ Ligne</button>
              <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm" onClick={() => onCreateDevis("BROUILLON")} disabled={!createDevisForm.clientId}>Enregistrer brouillon</button>
              <button className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold" onClick={() => onCreateDevis("ENVOYE")} disabled={!createDevisForm.clientId}>Émettre devis</button>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 no-print">
            <h3 className="font-bold text-gray-900 mb-3">Nouvelle facture</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={createForm.clientId} onChange={e => setCreateForm(v => ({ ...v, clientId: e.target.value }))}>
                <option value="">Client *</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
              </select>
              <DatePickerFr
                value={createForm.dateEmission}
                onChange={v => setCreateForm(s => ({ ...s, dateEmission: v }))}
                placeholder="Date émission"
                fromYear={1990}
                toYear={new Date().getFullYear() + 1}
              />
              <DatePickerFr
                value={createForm.dateEcheance}
                onChange={v => setCreateForm(s => ({ ...s, dateEcheance: v }))}
                placeholder="Date échéance"
                fromYear={1990}
                toYear={new Date().getFullYear() + 1}
              />
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={createForm.tvaTaux} onChange={e => setCreateForm(v => ({ ...v, tvaTaux: e.target.value }))}>
                <option value="18">TVA 18%</option>
                <option value="0">TVA 0% (exonéré)</option>
              </select>
            </div>
            <div className="mb-3">
              <input className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" value={createForm.notes} onChange={e => setCreateForm(v => ({ ...v, notes: e.target.value }))} placeholder="Notes / conditions" />
            </div>
            <div className="space-y-2">
              {createForm.lignes.map((l, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm md:col-span-2" value={l.description} onChange={e => setCreateForm(v => ({ ...v, lignes: v.lignes.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x) }))} placeholder="Description" />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" min={1} value={l.quantite} onChange={e => setCreateForm(v => ({ ...v, lignes: v.lignes.map((x, idx) => idx === i ? { ...x, quantite: e.target.value } : x) }))} placeholder="Quantité" />
                  <input className="rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" min={0} value={l.prixUnitaireHt} onChange={e => setCreateForm(v => ({ ...v, lignes: v.lignes.map((x, idx) => idx === i ? { ...x, prixUnitaireHt: e.target.value } : x) }))} placeholder="Prix unitaire HT" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm" onClick={() => setCreateForm(v => ({ ...v, lignes: [...v.lignes, { description: "", quantite: "1", prixUnitaireHt: "0" }] }))}>+ Ligne</button>
              <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm" onClick={() => onCreateFacture("BROUILLON")} disabled={!createForm.clientId}>Enregistrer brouillon</button>
              <button className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold" onClick={() => onCreateFacture("EMISE")} disabled={!createForm.clientId}>Émettre la facture</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">CA du mois</p><p className="text-2xl font-bold text-gray-900">{fcfa(n(kpi.caMois))}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Factures émises</p><p className="text-2xl font-bold text-gray-900">{kpi.facturesEmises}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Impayés</p><p className="text-2xl font-bold text-red-600">{fcfa(n(kpi.impayes))}</p></div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Taux d’encaissement</p><p className="text-2xl font-bold text-emerald-600">{kpi.tauxEncaissement}%</p></div>
        </div>

        <div className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden mb-4 no-print">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Devis</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                  <th className="text-left py-3 px-3">N° devis</th>
                  <th className="text-left py-3 px-3">Client</th>
                  <th className="text-left py-3 px-3">Émission</th>
                  <th className="text-left py-3 px-3">Validité</th>
                  <th className="text-right py-3 px-3">Montant TTC</th>
                  <th className="text-left py-3 px-3">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {devis.map(d => (
                  <tr key={d.id} onClick={() => setSelectedDevisId(d.id)} className={`cursor-pointer ${selectedDevisId === d.id ? "bg-orange-50" : ""}`}>
                    <td className="py-2.5 px-3">{d.numero}</td>
                    <td className="py-2.5 px-3">{d.client.nomRaisonSociale}</td>
                    <td className="py-2.5 px-3">{fmtDate(d.dateEmission)}</td>
                    <td className="py-2.5 px-3">{fmtDate(d.dateValidite)}</td>
                    <td className="py-2.5 px-3 text-right">{fcfa(n(d.totalTtc))}</td>
                    <td className="py-2.5 px-3">{d.statut}</td>
                  </tr>
                ))}
                {devis.length === 0 && <tr><td className="py-8 text-center text-gray-500" colSpan={6}>Aucun devis.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold disabled:opacity-60"
                disabled={!selectedDevisId}
                onClick={async () => {
                  try {
                    await setStatutDevis(selectedDevisId, "ACCEPTE")
                    setOk("Devis marqué accepté.")
                    await actualiser()
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    setErr(msg || "Échec mise à jour du devis.")
                  }
                }}
              >
                Accepter devis
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-semibold disabled:opacity-60"
                disabled={!selectedDevisId}
                onClick={async () => {
                  try {
                    await setStatutDevis(selectedDevisId, "REFUSE")
                    setOk("Devis marqué refusé.")
                    await actualiser()
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    setErr(msg || "Échec mise à jour du devis.")
                  }
                }}
              >
                Refuser devis
              </button>
              <button
                className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-60"
                disabled={!selectedDevisId}
                onClick={async () => {
                  try {
                    await convertirDevisEnFacture(selectedDevisId)
                    setOk("Devis converti en facture.")
                    await actualiser()
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                    setErr(msg || "Échec de conversion du devis.")
                  }
                }}
              >
                Convertir en facture
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold disabled:opacity-60"
                disabled={!selectedDevis}
                onClick={() => {
                  if (!selectedDevis) return
                  setPrintMode("devis")
                  document.title = `DEVIS_${selectedDevis.numero}`
                  window.print()
                }}
              >
                Exporter PDF devis
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
          <div className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden no-print">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Liste des factures</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="text-left py-3 px-3">N° facture</th>
                    <th className="text-left py-3 px-3">Client</th>
                    <th className="text-left py-3 px-3">Date émission</th>
                    <th className="text-left py-3 px-3">Date échéance</th>
                    <th className="text-right py-3 px-3">Montant TTC</th>
                    <th className="text-right py-3 px-3">Payé</th>
                    <th className="text-right py-3 px-3">Reste à payer</th>
                    <th className="text-left py-3 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {factures.map(f => (
                    <tr key={f.id} onClick={() => setSelectedId(f.id)} className={`cursor-pointer ${selectedId === f.id ? "bg-orange-50" : ""}`}>
                      <td className="py-2.5 px-3">{f.numero}</td>
                      <td className="py-2.5 px-3">{f.client.nomRaisonSociale}</td>
                      <td className="py-2.5 px-3">{fmtDate(f.dateEmission)}</td>
                      <td className="py-2.5 px-3">{fmtDate(f.dateEcheance)}</td>
                      <td className="py-2.5 px-3 text-right">{fcfa(n(f.totalTtc))}</td>
                      <td className="py-2.5 px-3 text-right">{fcfa(n(f.montantPaye))}</td>
                      <td className="py-2.5 px-3 text-right">{fcfa(n(f.resteAPayer))}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          f.statut === "PAYEE" ? "bg-emerald-100 text-emerald-700" :
                          f.statut === "EN_RETARD" ? "bg-red-100 text-red-700" :
                          f.statut === "PARTIELLEMENT_PAYEE" ? "bg-orange-100 text-orange-700" :
                          f.statut === "BROUILLON" ? "bg-gray-100 text-gray-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {f.statut === "PARTIELLEMENT_PAYEE" ? "Partiellement payée" : f.statut === "EN_RETARD" ? "En retard" : f.statut === "PAYEE" ? "Payée" : f.statut === "BROUILLON" ? "Brouillon" : "Émise"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {factures.length === 0 && <tr><td className="py-8 text-center text-gray-500" colSpan={8}>Aucune facture.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden no-print self-start h-fit">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Détail facture</h3>
            </div>
            <div className="p-4">
            {!selected && <p className="text-sm text-gray-500">Sélectionne une facture.</p>}
            {selected && (
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-100 bg-white p-3">
                  <p className="font-semibold text-gray-900">{selected.numero}</p>
                  <p className="text-sm text-gray-600">{selected.client.nomRaisonSociale}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 text-sm">
                  <p className="text-gray-500 mb-1">Période</p>
                  <div className="flex items-center justify-between gap-2 text-gray-700">
                    <span>Du. {fmtDate(selected.dateEmission)}</span>
                    <span>{fmtDate(selected.dateEcheance)}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Lignes</p>
                  {selected.lignes.map((l, i) => (
                    <p key={i} className="text-xs text-gray-600">{l.description} — {l.quantite} x {fcfa(n(l.prixUnitaireHt))}</p>
                  ))}
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 text-sm space-y-2">
                  <div className="flex items-center justify-between text-gray-700">
                    <span>Sous-total HT</span>
                    <b>{fcfa(n(selected.sousTotalHt ?? "0"))}</b>
                  </div>
                  <div className="flex items-center justify-between text-gray-700">
                    <span>TVA ({Number(selected.tvaTaux ?? "18")}%)</span>
                    <b>{fcfa(n(selected.montantTva ?? "0"))}</b>
                  </div>
                  <div className="flex items-center justify-between text-gray-700">
                    <span>Total TTC</span>
                    <b>{fcfa(n(selected.totalTtc))}</b>
                  </div>
                  <div className="flex items-center justify-between text-gray-700">
                    <span>Payé</span>
                    <b>{fcfa(n(selected.montantPaye))}</b>
                  </div>
                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-gray-900">
                    <span className="font-semibold">Solde</span>
                    <b>{fcfa(n(selected.resteAPayer))}</b>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold"
                    onClick={async () => {
                      if (n(selected.resteAPayer) <= 0) {
                        setOk("Cette facture est déjà entièrement payée.")
                        return
                      }
                      try {
                        const reste = n(selected.resteAPayer)
                        const montant = prompt(`Montant payé (FCFA) ?\nReste à payer: ${fcfa(reste)}`)
                        if (!montant) return
                        const montantNum = Number(montant)
                        if (!Number.isFinite(montantNum) || montantNum <= 0) {
                          setErr("Montant invalide. Saisis un nombre positif.")
                          return
                        }
                        if (montantNum > reste) {
                          setErr(`Montant trop élevé. Reste à payer: ${fcfa(reste)}.`)
                          return
                        }
                        await addPaiementFacture(selected.id, {
                          datePaiement: ymd(new Date()),
                          montant: montantNum,
                          modePaiement: "VIREMENT",
                        })
                        setOk("Paiement enregistré.")
                        await actualiser()
                      } catch (e: unknown) {
                        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                        setErr(msg || "Échec enregistrement paiement.")
                      }
                    }}
                  >
                    Enregistrer paiement
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold"
                    onClick={() => {
                      setPrintMode("facture")
                      document.title = `FACTURE_${selected.numero}`
                      window.print()
                    }}
                  >
                    Exporter PDF
                  </button>
                </div>
              </div>
            )}
            </div>
          </aside>
        </div>

        {selected && printMode === "facture" && (
          <div className="hidden print:block mt-4">
            <div className="flex items-start justify-between gap-6 mb-5 pb-4 border-b border-gray-200">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">FACTURE</h2>
                <p className="text-sm text-gray-600 mt-1">IvoireCompta</p>
                <p className="text-xs text-gray-500">Cabinet d&apos;expertise comptable</p>
                <p className="text-xs text-gray-500 mt-1">Abidjan - Cote d&apos;Ivoire</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">N° {selected.numero}</p>
                <p className="text-xs text-gray-600 mt-1">Date émission: {fmtDate(selected.dateEmission)}</p>
                <p className="text-xs text-gray-600">Date échéance: {fmtDate(selected.dateEcheance)}</p>
                <p className="text-xs mt-1">
                  <span className="font-semibold text-gray-700">Statut:</span>{" "}
                  <span className="text-gray-900">{selected.statut}</span>
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-3 mb-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Client</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{selected.client.nomRaisonSociale}</p>
            </div>

            <table className="w-full text-sm border-separate [border-spacing:0]">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 px-2">Description</th>
                  <th className="text-right py-2 px-2">Qté</th>
                  <th className="text-right py-2 px-2">PU HT</th>
                  <th className="text-right py-2 px-2">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {selected.lignes.map((l, i) => (
                  <tr key={`print-l-${i}`} className="border-b border-gray-100">
                    <td className="py-2 px-2">{l.description}</td>
                    <td className="py-2 px-2 text-right">{l.quantite}</td>
                    <td className="py-2 px-2 text-right">{fcfa(n(l.prixUnitaireHt))}</td>
                    <td className="py-2 px-2 text-right">{fcfa(n(l.totalLigneHt))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={3}>Sous-total HT</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selected.sousTotalHt ?? "0"))}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={3}>TVA ({Number(selected.tvaTaux ?? "18")}%)</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selected.montantTva ?? "0"))}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={3}>Total TTC</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selected.totalTtc))}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={3}>Montant payé</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selected.montantPaye))}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 px-2" colSpan={3}>Reste à payer</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selected.resteAPayer))}</td>
                </tr>
              </tfoot>
            </table>

            <div className="grid grid-cols-2 gap-6 mt-6 text-xs text-gray-700">
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="font-semibold text-gray-900 mb-1">Conditions de règlement</p>
                <p>Échéance: {fmtDate(selected.dateEcheance)}.</p>
                <p>Tout retard de paiement peut entraîner des pénalités selon la réglementation en vigueur.</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="font-semibold text-gray-900 mb-1">Cachet et signature</p>
                <p>Zone réservée à la validation du client.</p>
                <div className="h-14 border-b border-dashed border-gray-300 mt-4" />
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-gray-200 text-[11px] text-gray-500">
              <p>Document généré par IvoireCompta.</p>
              <p>Merci pour votre confiance.</p>
            </div>
          </div>
        )}

        {selectedDevis && printMode === "devis" && (
          <div className="hidden print:block mt-4">
            <div className="flex items-start justify-between gap-6 mb-5 pb-4 border-b border-gray-200">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">DEVIS</h2>
                <p className="text-sm text-gray-600 mt-1">IvoireCompta</p>
                <p className="text-xs text-gray-500">Cabinet d&apos;expertise comptable</p>
                <p className="text-xs text-gray-500 mt-1">Abidjan - Cote d&apos;Ivoire</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">N° {selectedDevis.numero}</p>
                <p className="text-xs text-gray-600 mt-1">Date émission: {fmtDate(selectedDevis.dateEmission)}</p>
                <p className="text-xs text-gray-600">Date validité: {fmtDate(selectedDevis.dateValidite)}</p>
                <p className="text-xs mt-1">
                  <span className="font-semibold text-gray-700">Statut:</span>{" "}
                  <span className="text-gray-900">{selectedDevis.statut}</span>
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-3 mb-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Client</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{selectedDevis.client.nomRaisonSociale}</p>
            </div>

            <table className="w-full text-sm border-separate [border-spacing:0]">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 px-2">Description</th>
                  <th className="text-right py-2 px-2">Qté</th>
                  <th className="text-right py-2 px-2">PU HT</th>
                  <th className="text-right py-2 px-2">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {(selectedDevis.lignes ?? []).map((l, i) => (
                  <tr key={`print-dl-${i}`} className="border-b border-gray-100">
                    <td className="py-2 px-2">{l.description}</td>
                    <td className="py-2 px-2 text-right">{l.quantite}</td>
                    <td className="py-2 px-2 text-right">{fcfa(n(l.prixUnitaireHt))}</td>
                    <td className="py-2 px-2 text-right">{fcfa(n(l.totalLigneHt))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={3}>Sous-total HT</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selectedDevis.sousTotalHt ?? "0"))}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={3}>TVA ({Number(selectedDevis.tvaTaux ?? "18")}%)</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selectedDevis.montantTva ?? "0"))}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 px-2" colSpan={3}>Total TTC</td>
                  <td className="py-2 px-2 text-right">{fcfa(n(selectedDevis.totalTtc))}</td>
                </tr>
              </tfoot>
            </table>

            <div className="grid grid-cols-2 gap-6 mt-6 text-xs text-gray-700">
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="font-semibold text-gray-900 mb-1">Conditions</p>
                <p>Validité du devis: jusqu&apos;au {fmtDate(selectedDevis.dateValidite)}.</p>
                <p>Règlement: selon les modalités convenues entre les parties.</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="font-semibold text-gray-900 mb-1">Signature client</p>
                <p>Nom, date et signature précédés de la mention &quot;Bon pour accord&quot;.</p>
                <div className="h-14 border-b border-dashed border-gray-300 mt-4" />
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-gray-200 text-[11px] text-gray-500">
              <p>Document généré par IvoireCompta.</p>
              <p>Ce devis n&apos;est pas une facture tant qu&apos;il n&apos;est pas accepté puis converti.</p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

