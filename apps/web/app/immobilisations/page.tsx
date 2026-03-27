"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import {
  api,
  createImmobilisation,
  getClients,
  getImmobilisation,
  getImmobilisations,
  patchImmobilisation,
  sortirImmobilisation,
} from "@/lib/api"
import { sanitizeLibelleCompta } from "@/lib/sanitize-text"

type Client = { id: string; nomRaisonSociale: string }
type Exercice = { id: string; annee: number }
type Categorie = "MATERIEL" | "VEHICULE" | "LOGICIEL" | "MOBILIER" | "BATIMENT" | "AUTRE"
type StatutImmo = "EN_SERVICE" | "CEDEE" | "SORTIE"
type Methode = "LINEAIRE" | "DEGRESSIF"

type ImmoRow = {
  id: string
  reference: string
  libelle: string
  categorie: Categorie
  fournisseur: string | null
  compteImmobilisation: string
  compteAmortissement: string
  dateAcquisition: string
  dateMiseEnService: string
  valeurOrigine: string
  valeurResiduelle: string
  dureeAnnees: number
  methodeAmortissement: Methode
  notes: string | null
  statut: StatutImmo
  dateSortie: string | null
  client: { id: string; nomRaisonSociale: string }
  exercice: { id: string; annee: number }
  amortCumule: string
  vnc: string
  dotationMois: string
  tauxAnnuelPct: string
}

type EcheancierRow = { annee: number; dotation: number; cumul: number; vnc: number }

function n(v: string | number) {
  if (typeof v === "number") return v
  const x = parseInt(v, 10)
  return Number.isNaN(x) ? 0 : x
}
function fcfa(v: number) {
  return `${v.toLocaleString("fr-FR")} FCFA`
}
function fmtDate(iso: string) {
  if (!iso) return "—"
  const d = iso.slice(0, 10).split("-")
  if (d.length !== 3) return iso
  return `${d[2]}/${d[1]}/${d[0]}`
}

const CAT_LABELS: Record<Categorie, string> = {
  MATERIEL: "Matériel",
  VEHICULE: "Véhicule",
  LOGICIEL: "Logiciel",
  MOBILIER: "Mobilier",
  BATIMENT: "Bâtiment",
  AUTRE: "Autre",
}
const STATUT_LABELS: Record<StatutImmo, string> = {
  EN_SERVICE: "En service",
  CEDEE: "Cédée",
  SORTIE: "Sortie",
}
const METHODE_LABELS: Record<Methode, string> = {
  LINEAIRE: "Linéaire",
  DEGRESSIF: "Dégressif",
}

function IconBuilding({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 9.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-4.5a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75V21" />
    </svg>
  )
}
function IconChart({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}
function IconCheck({ className = "w-4 h-4 text-emerald-600" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function csvCell(v: string | number) {
  const s = typeof v === "number" ? String(v) : sanitizeLibelleCompta(String(v ?? ""))
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Excel Windows ouvre souvent un .csv double-cliqué en ANSI (CP1252) : l’UTF-8 devient illisible (ex. « RÃ©fÃ©rence »).
 * UTF-16 LE + BOM (FF FE) est en général reconnu correctement pour le français.
 */
function stringToUtf16Le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    out[i * 2] = code & 0xff
    out[i * 2 + 1] = code >>> 8
  }
  return out
}

const emptyForm = {
  reference: "",
  libelle: "",
  categorie: "MATERIEL" as Categorie,
  fournisseur: "",
  compteImmobilisation: "218000",
  compteAmortissement: "681300",
  dateAcquisition: new Date().toISOString().slice(0, 10),
  dateMiseEnService: new Date().toISOString().slice(0, 10),
  valeurOrigine: "",
  valeurResiduelle: "0",
  dureeAnnees: "5",
  methodeAmortissement: "LINEAIRE" as Methode,
  notes: "",
}

export default function ImmobilisationsPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState("")
  const [err, setErr] = useState("")

  const [clients, setClients] = useState<Client[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [categorieFiltre, setCategorieFiltre] = useState<string>("TOUS")
  const [statutFiltre, setStatutFiltre] = useState<string>("TOUS")
  const [search, setSearch] = useState("")

  const [liste, setListe] = useState<ImmoRow[]>([])
  const [kpi, setKpi] = useState({
    valeurBruteTotale: "0",
    amortissementsCumules: "0",
    valeurNetteComptable: "0",
    dotationDuMois: "0",
  })
  const [selectedId, setSelectedId] = useState<string>("")
  const [detail, setDetail] = useState<{ immobilisation: ImmoRow; echeancier: EcheancierRow[] } | null>(null)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [printReady, setPrintReady] = useState(false)

  const selectedListe = useMemo(() => liste.find(i => i.id === selectedId) ?? null, [liste, selectedId])

  async function loadClients() {
    const r = await getClients()
    setClients((r.data.clients ?? []) as Client[])
  }

  async function onClientChange(id: string) {
    setClientId(id)
    setExerciceId("")
    setExercices([])
    setListe([])
    setSelectedId("")
    setDetail(null)
    if (!id) return
    const rc = await api.get(`/clients/${id}`)
    const dossierId = rc.data.client?.dossiers?.[0]?.id
    if (!dossierId) return
    const re = await api.get(`/exercices?dossierId=${dossierId}`)
    const list = (re.data.exercices ?? []) as Exercice[]
    setExercices(list)
    if (list[0]?.id) setExerciceId(list[0].id)
  }

  async function actualiserListe() {
    if (!exerciceId) return
    setLoading(true)
    setErr("")
    try {
      const params: Record<string, string> = { exerciceId }
      if (categorieFiltre !== "TOUS") params.categorie = categorieFiltre
      if (statutFiltre !== "TOUS") params.statut = statutFiltre
      if (search.trim()) params.search = search.trim()
      const r = await getImmobilisations(params)
      setListe((r.data.immobilisations ?? []) as ImmoRow[])
      setKpi(r.data.kpi ?? kpi)
      setOk("Registre actualisé.")
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Impossible de charger les immobilisations.")
    } finally {
      setLoading(false)
    }
  }

  async function chargerDetail(id: string) {
    if (!id) {
      setDetail(null)
      return
    }
    try {
      const r = await getImmobilisation(id)
      setDetail({
        immobilisation: r.data.immobilisation as ImmoRow,
        echeancier: (r.data.echeancier ?? []) as EcheancierRow[],
      })
    } catch {
      setDetail(null)
    }
  }

  function ouvrirCreation() {
    setEditId(null)
    setForm({
      ...emptyForm,
      dateAcquisition: new Date().toISOString().slice(0, 10),
      dateMiseEnService: new Date().toISOString().slice(0, 10),
    })
    setModalOuvert(true)
  }

  function ouvrirEdition() {
    const src = detail?.immobilisation ?? selectedListe
    if (!src) return
    setEditId(src.id)
    setForm({
      reference: src.reference,
      libelle: sanitizeLibelleCompta(src.libelle),
      categorie: src.categorie,
      fournisseur: src.fournisseur ?? "",
      compteImmobilisation: src.compteImmobilisation,
      compteAmortissement: src.compteAmortissement,
      dateAcquisition: src.dateAcquisition.slice(0, 10),
      dateMiseEnService: src.dateMiseEnService.slice(0, 10),
      valeurOrigine: src.valeurOrigine,
      valeurResiduelle: src.valeurResiduelle,
      dureeAnnees: String(src.dureeAnnees),
      methodeAmortissement: src.methodeAmortissement,
      notes: src.notes ?? "",
    })
    setModalOuvert(true)
  }

  function exportCsv() {
    const sep = ";"
    const header = ["Référence", "Libellé", "Catégorie", "Date acquisition", "Valeur origine", "Durée", "Méthode", "Amort. cumulé", "VNC", "Statut"]
    const rows = [
      header.join(sep),
      ...liste.map(i =>
        [
          csvCell(i.reference),
          csvCell(i.libelle),
          csvCell(CAT_LABELS[i.categorie]),
          csvCell(fmtDate(i.dateAcquisition)),
          csvCell(i.valeurOrigine),
          csvCell(i.dureeAnnees),
          csvCell(METHODE_LABELS[i.methodeAmortissement]),
          csvCell(i.amortCumule),
          csvCell(i.vnc),
          csvCell(STATUT_LABELS[i.statut]),
        ].join(sep)
      ),
    ].join("\r\n")
    const body = `sep=${sep}\r\n${rows}\r\n`
    const bom = new Uint8Array([0xff, 0xfe])
    const blob = new Blob([bom, stringToUtf16Le(body)], { type: "text/csv;charset=utf-16le" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `immobilisations_${exerciceId.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
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
    if (exerciceId) actualiserListe().catch(() => setErr("Erreur de chargement."))
  }, [exerciceId, categorieFiltre, statutFiltre]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedId) chargerDetail(selectedId).catch(() => {})
    else setDetail(null)
  }, [selectedId])

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-500">Chargement…</div>
      </Layout>
    )
  }

  const panneau = detail?.immobilisation ?? selectedListe

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="no-print">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Immobilisations</h1>
              <p className="text-gray-500 mt-1">Registre des actifs et plan d&apos;amortissement</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                onClick={ouvrirCreation}
                disabled={!clientId || !exerciceId}
              >
                Nouvelle immobilisation
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  document.title = `IMMOBILISATIONS_${exerciceId.slice(0, 8)}`
                  setPrintReady(true)
                  let fallbackId = 0
                  const onAfterPrint = () => {
                    window.clearTimeout(fallbackId)
                    setPrintReady(false)
                    window.removeEventListener("afterprint", onAfterPrint)
                  }
                  window.addEventListener("afterprint", onAfterPrint)
                  fallbackId = window.setTimeout(onAfterPrint, 5_000)
                  // Attendre le repaint : sinon le bloc `print:` n’est pas encore au DOM et l’aperçu est vide.
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      window.print()
                    })
                  })
                }}
                disabled={!exerciceId || liste.length === 0}
              >
                Exporter PDF
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={exportCsv}
                disabled={!exerciceId || liste.length === 0}
              >
                Exporter Excel
              </button>
            </div>
          </div>

          {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
          {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
                <option value="">Client</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nomRaisonSociale}
                  </option>
                ))}
              </select>
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={exerciceId} onChange={e => setExerciceId(e.target.value)} disabled={!clientId}>
                <option value="">Exercice</option>
                {exercices.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.annee}
                  </option>
                ))}
              </select>
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={categorieFiltre} onChange={e => setCategorieFiltre(e.target.value)}>
                <option value="TOUS">Toutes les catégories</option>
                {(Object.keys(CAT_LABELS) as Categorie[]).map(k => (
                  <option key={k} value={k}>
                    {CAT_LABELS[k]}
                  </option>
                ))}
              </select>
              <select className="rounded-xl border border-gray-200 px-3 py-2 text-sm" value={statutFiltre} onChange={e => setStatutFiltre(e.target.value)}>
                <option value="TOUS">Tous les statuts</option>
                <option value="EN_SERVICE">En service</option>
                <option value="CEDEE">Cédée</option>
                <option value="SORTIE">Sortie</option>
              </select>
              <input
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm md:col-span-2"
                placeholder="Libellé / Référence"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && actualiserListe()}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold" onClick={actualiserListe} disabled={!exerciceId || loading}>
                {loading ? "Chargement…" : "Actualiser"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
            <p className="text-sm text-gray-500">Valeur brute totale</p>
            <p className="text-2xl font-bold text-gray-900">{fcfa(n(kpi.valeurBruteTotale))}</p>
          </div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
            <p className="text-sm text-gray-500">Amortissements cumulés</p>
            <p className="text-2xl font-bold text-orange-600">{fcfa(n(kpi.amortissementsCumules))}</p>
          </div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
            <p className="text-sm text-gray-500">Valeur nette comptable</p>
            <p className="text-2xl font-bold text-emerald-700">{fcfa(n(kpi.valeurNetteComptable))}</p>
          </div>
          <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
            <p className="text-sm text-gray-500">Dotation du mois</p>
            <p className="text-2xl font-bold text-indigo-600">{fcfa(n(kpi.dotationDuMois))}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden no-print self-start w-full min-h-0 h-fit">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Registre des immobilisations</div>
            <div className="overflow-x-auto max-h-[min(70vh,720px)] overflow-y-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="text-left py-3 px-3">Réf.</th>
                    <th className="text-left py-3 px-3">Libellé</th>
                    <th className="text-left py-3 px-3">Catégorie</th>
                    <th className="text-left py-3 px-3">Date acq.</th>
                    <th className="text-right py-3 px-3">Valeur origine</th>
                    <th className="text-right py-3 px-3">Durée</th>
                    <th className="text-left py-3 px-3">Méthode</th>
                    <th className="text-right py-3 px-3">Amort. cumulé</th>
                    <th className="text-right py-3 px-3">VNC</th>
                    <th className="text-left py-3 px-3">Statut</th>
                    <th className="text-right py-3 px-3">Modifier</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.map(i => (
                    <tr
                      key={i.id}
                      onClick={() => setSelectedId(i.id)}
                      className={`cursor-pointer border-b border-gray-50 hover:bg-orange-50/50 ${selectedId === i.id ? "bg-orange-50" : ""}`}
                    >
                      <td className="py-2 px-3 font-medium text-gray-900">{i.reference}</td>
                      <td className="py-2 px-3 text-gray-700">{sanitizeLibelleCompta(i.libelle)}</td>
                      <td className="py-2 px-3">{CAT_LABELS[i.categorie]}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{fmtDate(i.dateAcquisition)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{fcfa(n(i.valeurOrigine))}</td>
                      <td className="py-2 px-3 text-right">{i.dureeAnnees}</td>
                      <td className="py-2 px-3">{METHODE_LABELS[i.methodeAmortissement]}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{fcfa(n(i.amortCumule))}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{fcfa(n(i.vnc))}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            i.statut === "EN_SERVICE"
                              ? "bg-emerald-100 text-emerald-800"
                              : i.statut === "CEDEE"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {STATUT_LABELS[i.statut]}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          className="text-gray-600 hover:underline text-xs font-semibold"
                          onClick={() => {
                            setSelectedId(i.id)
                            setTimeout(() => {
                              setEditId(i.id)
                              setForm({
                                reference: i.reference,
                                libelle: sanitizeLibelleCompta(i.libelle),
                                categorie: i.categorie,
                                fournisseur: i.fournisseur ?? "",
                                compteImmobilisation: i.compteImmobilisation,
                                compteAmortissement: i.compteAmortissement,
                                dateAcquisition: i.dateAcquisition.slice(0, 10),
                                dateMiseEnService: i.dateMiseEnService.slice(0, 10),
                                valeurOrigine: i.valeurOrigine,
                                valeurResiduelle: i.valeurResiduelle,
                                dureeAnnees: String(i.dureeAnnees),
                                methodeAmortissement: i.methodeAmortissement,
                                notes: i.notes ?? "",
                              })
                              setModalOuvert(true)
                            }, 0)
                          }}
                        >
                          Modifier
                        </button>
                      </td>
                    </tr>
                  ))}
                  {liste.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-4 text-center text-gray-500 text-sm">
                        {exerciceId ? "Aucune immobilisation pour ces filtres — créez-en une avec « Nouvelle immobilisation »." : "Sélectionnez un client et un exercice."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="bg-white rounded-2xl border border-gray-200/80 shadow-sm no-print self-start h-fit max-w-lg 2xl:max-w-none w-full mx-auto xl:mx-0 overflow-hidden">
            <div className="px-5 pt-5 pb-3 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">Détail immobilisation</h3>
            </div>
            <div className="p-5">
            {!panneau && <p className="text-sm text-gray-500">Sélectionnez une ligne du registre.</p>}
            {panneau && (
              <div className="space-y-5">
                <section>
                  <h4 className="text-sm font-bold text-gray-900 mb-1">Infos générales</h4>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-gray-500">Référence</span>
                      <span className="text-sm font-semibold text-gray-900 text-right">{panneau.reference}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-gray-500">Fournisseur</span>
                      <span className="text-sm font-semibold text-gray-900 text-right">{panneau.fournisseur || "—"}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-gray-500">Compte</span>
                      <span className="text-sm font-semibold text-gray-900 text-right font-mono">{panneau.compteImmobilisation}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-gray-500">Mise en service</span>
                      <span className="text-sm font-semibold text-gray-900 text-right">{fmtDate(panneau.dateMiseEnService)}</span>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200/90 bg-slate-50/90 p-4 shadow-inner">
                  <div className="flex items-center gap-2 mb-3 text-slate-800">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 text-orange-600">
                      <IconBuilding className="w-5 h-5" />
                    </span>
                    <h4 className="text-sm font-bold">Bloc financier</h4>
                  </div>
                  <div className="space-y-0 rounded-xl bg-white/80 border border-slate-100/80 px-1">
                    <div className="flex justify-between items-baseline gap-2 px-3 py-3 border-b border-slate-100">
                      <span className="text-sm text-gray-600">Valeur d&apos;origine</span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{fcfa(n(panneau.valeurOrigine))}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 px-3 py-3 border-b border-slate-100">
                      <span className="text-sm text-gray-600">Valeur résiduelle</span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{fcfa(n(panneau.valeurResiduelle))}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 px-3 py-3 border-b border-slate-100">
                      <span className="text-sm text-gray-600">Base amortissable</span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{fcfa(n(panneau.valeurOrigine) - n(panneau.valeurResiduelle))}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2 px-3 py-3">
                      <span className="text-sm text-gray-600">Taux</span>
                      <div className="text-right">
                        <span className="text-sm font-bold text-gray-900">{panneau.tauxAnnuelPct} %</span>
                        <p className="text-[11px] text-gray-500 mt-0.5">{METHODE_LABELS[panneau.methodeAmortissement]}</p>
                      </div>
                    </div>
                  </div>
                </section>

                {detail?.echeancier && detail.echeancier.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3 text-gray-900">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 border border-orange-100 text-orange-600">
                        <IconChart className="w-5 h-5" />
                      </span>
                      <h4 className="text-sm font-bold">Amortissement</h4>
                    </div>
                    <div className="rounded-xl border border-gray-200 overflow-hidden max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-[1]">
                          <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                            <th className="text-left py-2.5 pl-3 pr-2 font-semibold">Année</th>
                            <th className="text-right py-2.5 px-2 font-semibold">Dotation</th>
                            <th className="text-right py-2.5 px-2 font-semibold">Cumul</th>
                            <th className="text-right py-2.5 px-2 font-semibold">VNC</th>
                            <th className="w-10 py-2.5 pr-3 text-center font-semibold" aria-label="Statut" />
                          </tr>
                        </thead>
                        <tbody>
                          {detail.echeancier.map((row, idx) => (
                            <tr key={row.annee} className={`border-b border-gray-100 last:border-0 ${idx % 2 === 1 ? "bg-gray-50/70" : "bg-white"}`}>
                              <td className="py-2.5 pl-3 pr-2 font-semibold text-gray-900">{row.annee}</td>
                              <td className="py-2.5 px-2 text-right tabular-nums text-gray-800">{fcfa(row.dotation)}</td>
                              <td className="py-2.5 px-2 text-right tabular-nums text-gray-800">{fcfa(row.cumul)}</td>
                              <td className="py-2.5 px-2 text-right tabular-nums font-medium text-gray-900">{fcfa(row.vnc)}</td>
                              <td className="py-2.5 pr-3 text-center">
                                <span className="inline-flex justify-center" title="Dotation retenue">
                                  <IconCheck />
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {panneau.notes && (
                  <section className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 text-sm text-gray-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Notes</p>
                    <p className="leading-relaxed">{panneau.notes}</p>
                  </section>
                )}

                <div className="flex flex-nowrap items-center gap-2 pt-1 border-t border-gray-100 overflow-x-auto hide-scrollbar">
                  <button type="button" className="shrink-0 px-2.5 py-2 rounded-xl border border-gray-200 text-xs sm:text-sm font-semibold whitespace-nowrap" onClick={ouvrirEdition}>
                    Modifier
                  </button>
                  {panneau.statut === "EN_SERVICE" && (
                    <button
                      type="button"
                      className="shrink-0 px-2.5 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs sm:text-sm font-semibold whitespace-nowrap"
                      onClick={async () => {
                        if (!confirm("Marquer cette immobilisation comme cédée ?")) return
                        try {
                          await patchImmobilisation(panneau.id, { statut: "CEDEE" })
                          setOk("Statut mis à jour (cédée).")
                          await actualiserListe()
                          await chargerDetail(panneau.id)
                        } catch (e: unknown) {
                          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                          setErr(msg || "Échec.")
                        }
                      }}
                    >
                      Marquer cédée
                    </button>
                  )}
                  <button
                    type="button"
                    className="shrink-0 px-2.5 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs sm:text-sm font-semibold whitespace-nowrap disabled:opacity-50"
                    disabled={panneau.statut === "SORTIE"}
                    onClick={async () => {
                      const ds = window.prompt("Date de sortie (AAAA-MM-JJ) :", new Date().toISOString().slice(0, 10))
                      if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return
                      try {
                        await sortirImmobilisation(panneau.id, ds)
                        setOk("Immobilisation sortie du registre actif.")
                        await actualiserListe()
                        setSelectedId("")
                      } catch (e: unknown) {
                        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                        setErr(msg || "Échec sortie.")
                      }
                    }}
                  >
                    Sortir l&apos;actif
                  </button>
                </div>
              </div>
            )}
            </div>
          </aside>
        </div>

        {modalOuvert && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 no-print">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">{editId ? "Modifier l'immobilisation" : "Nouvelle immobilisation"}</h3>
              <div className="space-y-3 text-sm">
                {!editId && (
                  <p className="text-xs text-gray-500">
                    Client : {clients.find(c => c.id === clientId)?.nomRaisonSociale ?? "—"} · Exercice : {exercices.find(e => e.id === exerciceId)?.annee ?? "—"}
                  </p>
                )}
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  placeholder="Référence"
                  value={form.reference}
                  onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                />
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  placeholder="Libellé"
                  value={form.libelle}
                  onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
                />
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  placeholder="Fournisseur"
                  value={form.fournisseur}
                  onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))}
                />
                <select className="w-full rounded-xl border border-gray-200 px-3 py-2" value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value as Categorie }))}>
                  {(Object.keys(CAT_LABELS) as Categorie[]).map(k => (
                    <option key={k} value={k}>
                      {CAT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Date acquisition</label>
                    <DatePickerFr value={form.dateAcquisition} onChange={v => setForm(f => ({ ...f, dateAcquisition: v }))} className="w-full rounded-xl border border-gray-200 px-2 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Mise en service</label>
                    <DatePickerFr value={form.dateMiseEnService} onChange={v => setForm(f => ({ ...f, dateMiseEnService: v }))} className="w-full rounded-xl border border-gray-200 px-2 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Valeur d&apos;origine (FCFA)</label>
                    <input
                      className="w-full rounded-xl border border-gray-200 px-3 py-2"
                      type="number"
                      min={0}
                      value={form.valeurOrigine}
                      onChange={e => setForm(f => ({ ...f, valeurOrigine: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Valeur résiduelle</label>
                    <input
                      className="w-full rounded-xl border border-gray-200 px-3 py-2"
                      type="number"
                      min={0}
                      value={form.valeurResiduelle}
                      onChange={e => setForm(f => ({ ...f, valeurResiduelle: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Durée (années)</label>
                    <input
                      className="w-full rounded-xl border border-gray-200 px-3 py-2"
                      type="number"
                      min={1}
                      max={50}
                      value={form.dureeAnnees}
                      onChange={e => setForm(f => ({ ...f, dureeAnnees: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Méthode</label>
                    <select className="w-full rounded-xl border border-gray-200 px-3 py-2" value={form.methodeAmortissement} onChange={e => setForm(f => ({ ...f, methodeAmortissement: e.target.value as Methode }))}>
                      <option value="LINEAIRE">Linéaire</option>
                      <option value="DEGRESSIF">Dégressif</option>
                    </select>
                  </div>
                </div>
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  placeholder="Compte immobilisation"
                  value={form.compteImmobilisation}
                  onChange={e => setForm(f => ({ ...f, compteImmobilisation: e.target.value }))}
                />
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  placeholder="Compte amortissement"
                  value={form.compteAmortissement}
                  onChange={e => setForm(f => ({ ...f, compteAmortissement: e.target.value }))}
                />
                <textarea
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  rows={3}
                  placeholder="Notes"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold" onClick={() => setModalOuvert(false)}>
                  Annuler
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold"
                  onClick={async () => {
                    const vo = parseInt(form.valeurOrigine, 10)
                    const vr = parseInt(form.valeurResiduelle || "0", 10)
                    const duree = parseInt(form.dureeAnnees, 10)
                    const refS = sanitizeLibelleCompta(form.reference)
                    const libS = sanitizeLibelleCompta(form.libelle)
                    if (!refS || !libS) {
                      setErr("Référence et libellé obligatoires (caractères spéciaux non acceptés retirés — complétez le texte).")
                      return
                    }
                    if (Number.isNaN(vo) || vo < 0) {
                      setErr("Valeur d'origine invalide.")
                      return
                    }
                    if (vr > vo) {
                      setErr("La valeur résiduelle ne peut pas dépasser la valeur d'origine.")
                      return
                    }
                    try {
                      setErr("")
                      if (editId) {
                        await patchImmobilisation(editId, {
                          reference: refS,
                          libelle: libS,
                          categorie: form.categorie,
                          fournisseur: form.fournisseur.trim() ? sanitizeLibelleCompta(form.fournisseur) : undefined,
                          compteImmobilisation: form.compteImmobilisation.trim(),
                          compteAmortissement: form.compteAmortissement.trim(),
                          dateAcquisition: form.dateAcquisition,
                          dateMiseEnService: form.dateMiseEnService,
                          valeurOrigine: vo,
                          valeurResiduelle: vr,
                          dureeAnnees: duree,
                          methodeAmortissement: form.methodeAmortissement,
                          notes: form.notes.trim() ? sanitizeLibelleCompta(form.notes) : undefined,
                        })
                        setOk("Immobilisation mise à jour.")
                        setModalOuvert(false)
                        await actualiserListe()
                        await chargerDetail(editId)
                      } else {
                        if (!clientId || !exerciceId) return
                        const res = await createImmobilisation({
                          clientId,
                          exerciceId,
                          reference: refS,
                          libelle: libS,
                          categorie: form.categorie,
                          fournisseur: form.fournisseur.trim() ? sanitizeLibelleCompta(form.fournisseur) : undefined,
                          compteImmobilisation: form.compteImmobilisation.trim(),
                          compteAmortissement: form.compteAmortissement.trim(),
                          dateAcquisition: form.dateAcquisition,
                          dateMiseEnService: form.dateMiseEnService,
                          valeurOrigine: vo,
                          valeurResiduelle: vr,
                          dureeAnnees: duree,
                          methodeAmortissement: form.methodeAmortissement,
                          notes: form.notes.trim() ? sanitizeLibelleCompta(form.notes) : undefined,
                        })
                        setOk("Immobilisation créée.")
                        const newId = (res.data as { immobilisation?: { id: string } })?.immobilisation?.id
                        setModalOuvert(false)
                        await actualiserListe()
                        if (newId) {
                          setSelectedId(newId)
                          await chargerDetail(newId)
                        }
                      }
                    } catch (e: unknown) {
                      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                      setErr(msg || "Échec d'enregistrement.")
                    }
                  }}
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}

        {printReady && exerciceId && (
          <div className="hidden print:!block mt-8 bg-white text-black w-full">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Immobilisations — export</h2>
            <p className="text-sm text-gray-600 mb-4">Exercice sélectionné · {liste.length} ligne(s)</p>
            <div className="grid grid-cols-4 gap-3 mb-6 text-sm">
              <div className="border border-gray-200 rounded-lg p-2">
                <p className="text-gray-500">Valeur brute</p>
                <p className="font-semibold">{fcfa(n(kpi.valeurBruteTotale))}</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-2">
                <p className="text-gray-500">Amort. cumulés</p>
                <p className="font-semibold">{fcfa(n(kpi.amortissementsCumules))}</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-2">
                <p className="text-gray-500">VNC</p>
                <p className="font-semibold">{fcfa(n(kpi.valeurNetteComptable))}</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-2">
                <p className="text-gray-500">Dotation du mois</p>
                <p className="font-semibold">{fcfa(n(kpi.dotationDuMois))}</p>
              </div>
            </div>
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-1 px-1">Réf.</th>
                  <th className="text-left py-1 px-1">Libellé</th>
                  <th className="text-left py-1 px-1">Cat.</th>
                  <th className="text-right py-1 px-1">Origine</th>
                  <th className="text-right py-1 px-1">Amort.</th>
                  <th className="text-right py-1 px-1">VNC</th>
                </tr>
              </thead>
              <tbody>
                {liste.map(i => (
                  <tr key={i.id} className="border-b border-gray-100">
                    <td className="py-1 px-1">{i.reference}</td>
                    <td className="py-1 px-1">{sanitizeLibelleCompta(i.libelle)}</td>
                    <td className="py-1 px-1">{CAT_LABELS[i.categorie]}</td>
                    <td className="text-right py-1 px-1">{fcfa(n(i.valeurOrigine))}</td>
                    <td className="text-right py-1 px-1">{fcfa(n(i.amortCumule))}</td>
                    <td className="text-right py-1 px-1">{fcfa(n(i.vnc))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}
