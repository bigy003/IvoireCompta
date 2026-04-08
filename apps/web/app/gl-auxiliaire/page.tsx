"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import {
  api,
  delettrerGlAuxiliaire,
  getAuditGlAuxiliaire,
  getClients,
  getGlAuxiliaire,
  lettrerGlAuxiliaire,
} from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Dossier = { id: string; typeMission: string }
type Exercice = { id: string; annee: number }
type CompteRow = { compte: string; intitule: string; debit: number; credit: number; solde: number; nb: number; letrees: number; pctLettre: number }
const defaultGlStats = {
  soldeTotal: 0,
  soldeTousComptes: 0,
  nonLettres: 0,
  montantNonLettres: 0,
  lettres: 0,
  montantLettres: 0,
  pctLettresLignes: 0,
  ecart: 0,
}

type MvtRow = {
  id: string
  ligneId: string
  date: string
  journal: string
  piece?: string | null
  libelle: string
  debit: number
  credit: number
  soldeCumule: number
  lettrage?: string | null
}

function fcfa(v: number) {
  return `${v.toLocaleString("fr-FR")} FCFA`
}
/** yyyy-MM-dd en calendrier local (évite le décalage UTC de toISOString). */
function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function periodForExerciseYear(annee: number) {
  return { du: `${annee}-01-01`, au: `${annee}-12-31` }
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR")
  } catch {
    return iso
  }
}

export default function GlAuxiliairePage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [ok, setOk] = useState("")

  const [clients, setClients] = useState<Client[]>([])
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [dossierId, setDossierId] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [typeAux, setTypeAux] = useState<"CLIENTS" | "FOURNISSEURS">("CLIENTS")
  const [compte, setCompte] = useState("")
  const [du, setDu] = useState(ymd(new Date(new Date().getFullYear(), 0, 1)))
  const [au, setAu] = useState(ymd(new Date()))
  const [search, setSearch] = useState("")

  const [comptes, setComptes] = useState<CompteRow[]>([])
  const [mouvements, setMouvements] = useState<MvtRow[]>([])
  const [stats, setStats] = useState(defaultGlStats)
  const [intituleCompteGl, setIntituleCompteGl] = useState("")
  const [selectedLignes, setSelectedLignes] = useState<string[]>([])
  const [audit, setAudit] = useState<
    Array<{ id: string; action: string; createdAt: string; userId?: string | null; user?: { nomComplet?: string; email?: string | null } | null }>
  >([])

  const anneeExercice = useMemo(() => exercices.find(e => e.id === exerciceId)?.annee, [exercices, exerciceId])
  const yearPickerFrom = anneeExercice != null ? anneeExercice - 1 : 2020
  const yearPickerTo = anneeExercice != null ? anneeExercice + 1 : new Date().getFullYear() + 3

  function auditActionLabel(action: string) {
    if (action === "GL_AUX_LETTRAGE") return "Lettrage appliqué"
    if (action === "GL_AUX_DELETTRAGE") return "Délettrage"
    return action
  }
  function auditDotClass(action: string) {
    if (action === "GL_AUX_DELETTRAGE") return "bg-amber-500"
    return "bg-emerald-500"
  }

  const debitSel = useMemo(
    () => mouvements.filter(m => selectedLignes.includes(m.ligneId)).reduce((s, m) => s + m.debit, 0),
    [mouvements, selectedLignes]
  )
  const creditSel = useMemo(
    () => mouvements.filter(m => selectedLignes.includes(m.ligneId)).reduce((s, m) => s + m.credit, 0),
    [mouvements, selectedLignes]
  )
  const ecartSel = Math.abs(debitSel - creditSel)
  const selectionEquilibree = selectedLignes.length >= 2 && ecartSel === 0
  const selectionALettrees = useMemo(
    () => mouvements.some(m => selectedLignes.includes(m.ligneId) && Boolean(m.lettrage)),
    [mouvements, selectedLignes]
  )

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
    if (xs[0]?.id) {
      setExerciceId(xs[0].id)
      const p = periodForExerciseYear(xs[0].annee)
      setDu(p.du)
      setAu(p.au)
    }
  }

  function onExerciceSelect(id: string) {
    setExerciceId(id)
    const ex = exercices.find(e => e.id === id)
    if (ex) {
      const p = periodForExerciseYear(ex.annee)
      setDu(p.du)
      setAu(p.au)
    }
  }

  async function loadData(opts?: { compteFilter?: string }) {
    if (!exerciceId) return
    setLoading(true)
    setErr("")
    const compteQ =
      opts?.compteFilter !== undefined ? opts.compteFilter || undefined : compte || undefined
    try {
      const r = await getGlAuxiliaire({
        exerciceId,
        type: typeAux,
        du,
        au,
        search,
        compte: compteQ,
      })
      setComptes((r.data.comptes ?? []) as CompteRow[])
      setMouvements((r.data.mouvements ?? []) as MvtRow[])
      setStats({ ...defaultGlStats, ...(r.data.stats as object) } as typeof defaultGlStats)
      setIntituleCompteGl(String(r.data.intituleCompteSelectionne ?? ""))
      setCompte((r.data.compteSelected as string) ?? "")
      setSelectedLignes([])
      const ra = await getAuditGlAuxiliaire(exerciceId)
      setAudit(
        (ra.data.audit ?? []) as Array<{
          id: string
          action: string
          createdAt: string
          userId?: string | null
          user?: { nomComplet?: string; email?: string | null } | null
        }>
      )
      setOk("GL auxiliaire actualisé.")
    } catch {
      setErr("Impossible de charger le GL auxiliaire.")
    } finally {
      setLoading(false)
    }
  }

  async function onLettrer() {
    if (!selectionEquilibree || !exerciceId) return
    setErr("")
    try {
      await lettrerGlAuxiliaire({ exerciceId, ligneIds: selectedLignes })
      setOk("Lettrage appliqué.")
      await loadData()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Lettrage impossible. Vérifiez la sélection."
      setErr(msg)
    }
  }
  async function onDelettrer() {
    if (!exerciceId || selectedLignes.length === 0) return
    const idsLettrees = mouvements.filter(m => selectedLignes.includes(m.ligneId) && m.lettrage).map(m => m.ligneId)
    if (idsLettrees.length === 0) {
      setErr("Délettrage : sélectionnez au moins une ligne déjà lettrée. L’équilibre débit/crédit n’est pas requis pour délettrer.")
      return
    }
    setErr("")
    try {
      await delettrerGlAuxiliaire({ exerciceId, ligneIds: idsLettrees })
      setOk("Délettrage appliqué.")
      await loadData()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Délettrage impossible."
      setErr(msg)
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
    if (exerciceId) loadData().catch(() => setErr("Impossible de charger le GL auxiliaire."))
  }, [exerciceId, typeAux]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <h1 className="text-3xl font-bold text-gray-900">Grand Livre auxiliaire</h1>
        <p className="text-gray-500 mt-1 mb-4">Suivi clients/fournisseurs, lettrage et export</p>
        {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
        {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 items-end">
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
              <option value="">Client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={dossierId} onChange={e => onDossierChange(e.target.value)}>
              <option value="">Dossier</option>
              {dossiers.map(d => <option key={d.id} value={d.id}>{d.typeMission}</option>)}
            </select>
            <select
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              value={exerciceId}
              lang="fr"
              title="La période Du / Au est ajustée sur l’année civile de l’exercice."
              onChange={e => onExerciceSelect(e.target.value)}
            >
              <option value="">Exercice</option>
              {exercices.map(ex => <option key={ex.id} value={ex.id}>{ex.annee}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={typeAux} onChange={e => setTypeAux(e.target.value as "CLIENTS" | "FOURNISSEURS")}>
              <option value="CLIENTS">Clients (411)</option>
              <option value="FOURNISSEURS">Fournisseurs (401)</option>
            </select>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Période du</p>
              <DatePickerFr value={du} onChange={setDu} fromYear={yearPickerFrom} toYear={yearPickerTo} className="w-full" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">au</p>
              <DatePickerFr value={au} onChange={setAu} fromYear={yearPickerFrom} toYear={yearPickerTo} className="w-full" />
            </div>
            <button className="rounded-xl bg-orange-500 text-white px-4 py-2.5 text-sm font-semibold hover:bg-orange-600" onClick={loadData} disabled={!exerciceId || loading}>
              {loading ? "Chargement..." : "Actualiser"}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_170px] gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher (libellé, pièce, référence...)" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
            <select
              value={compte}
              onChange={e => {
                const v = e.target.value
                setCompte(v)
                void loadData({ compteFilter: v })
              }}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            >
              <option value="">Compte auxiliaire (optionnel)</option>
              {comptes.map(c => <option key={c.compte} value={c.compte}>{c.compte} - {c.intitule}</option>)}
            </select>
            <button
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              onClick={() => {
                const rows = [["Date", "Journal", "Pièce", "Libellé", "Débit", "Crédit", "Solde", "Lettrage"], ...mouvements.map(m => [fmtDate(m.date), m.journal, m.piece ?? "", m.libelle, `${m.debit}`, `${m.credit}`, `${m.soldeCumule}`, m.lettrage ?? ""])]
                const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n")
                const blob = new Blob([`sep=;\r\n${csv}`], { type: "text/csv;charset=utf-8;" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = "gl-auxiliaire.csv"
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Exporter CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
          <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
            <p className="text-xs text-emerald-700 font-medium">Solde total auxiliaire</p>
            <p className="text-2xl font-bold text-emerald-900 mt-1">{fcfa(stats.soldeTotal)}</p>
            <p className="text-[11px] text-emerald-700/80 mt-2">Compte affiché{compte ? ` · ${compte}` : ""}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
            <p className="text-xs text-amber-700 font-medium">Écritures non lettrées</p>
            <p className="text-2xl font-bold text-amber-900 mt-1">{stats.nonLettres}</p>
            <p className="text-[11px] text-amber-800/85 mt-2">Total {fcfa(stats.montantNonLettres)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
            <p className="text-xs text-blue-700 font-medium">Écritures lettrées</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{stats.lettres}</p>
            <p className="text-[11px] text-blue-800/85 mt-2">
              Total {fcfa(stats.montantLettres)} · {stats.pctLettresLignes}% des lignes
            </p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-100 p-4">
            <p className="text-xs text-red-700 font-medium">Écart Débit/Crédit</p>
            <p className="text-2xl font-bold text-red-900 mt-1">{fcfa(stats.ecart)}</p>
            <p className="text-[11px] text-red-800/80 mt-2">Sur les mouvements du compte (période)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr_290px] gap-3 items-start">
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Comptes auxiliaires</div>
            <div className="max-h-[580px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="text-left py-2 px-3">Compte</th>
                    <th className="text-right py-2 px-3">Solde</th>
                    <th className="text-right py-2 px-3">% lettré</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {comptes.map(c => (
                    <tr
                      key={c.compte}
                      className={`cursor-pointer ${compte === c.compte ? "bg-orange-50" : ""}`}
                      onClick={() => {
                        setCompte(c.compte)
                        void loadData({ compteFilter: c.compte })
                      }}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-medium">{c.compte}</div>
                        <div className="text-xs text-gray-500">{c.intitule}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right">{fcfa(c.solde)}</td>
                      <td className="py-2.5 px-3 text-right">{c.pctLettre}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">
              Mouvements
              {(intituleCompteGl || compte) && (
                <span className="font-normal text-gray-500">
                  {" : "}
                  {intituleCompteGl || compte}
                </span>
              )}
            </div>
            <div className="max-h-[520px] overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                    <th className="py-2 px-2"></th>
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-left py-2 px-2">Journal</th>
                    <th className="text-left py-2 px-2">Pièce</th>
                    <th className="text-left py-2 px-2">Libellé</th>
                    <th className="text-right py-2 px-2">Débit</th>
                    <th className="text-right py-2 px-2">Crédit</th>
                    <th className="text-right py-2 px-2">Solde</th>
                    <th className="text-left py-2 px-2">Lettrage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mouvements.map(m => (
                    <tr key={m.id} className={selectedLignes.includes(m.ligneId) ? "bg-orange-50" : ""}>
                      <td className="py-2 px-2">
                        <input
                          type="checkbox"
                          checked={selectedLignes.includes(m.ligneId)}
                          onChange={e => setSelectedLignes(prev => e.target.checked ? [...prev, m.ligneId] : prev.filter(x => x !== m.ligneId))}
                        />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(m.date)}</td>
                      <td className="py-2 px-2">{m.journal}</td>
                      <td className="py-2 px-2">{m.piece || "—"}</td>
                      <td className="py-2 px-2">{m.libelle}</td>
                      <td className="py-2 px-2 text-right">{fcfa(m.debit)}</td>
                      <td className="py-2 px-2 text-right">{fcfa(m.credit)}</td>
                      <td className="py-2 px-2 text-right">{fcfa(m.soldeCumule)}</td>
                      <td className="py-2 px-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${m.lettrage ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {m.lettrage || "Non lettré"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedLignes.length > 0 && (
              <div className="shrink-0 border-t border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
                <span className="font-medium">{selectedLignes.length} ligne(s) sélectionnée(s)</span>
                <span className="text-emerald-700"> · Écart : {fcfa(ecartSel)}</span>
                {ecartSel === 0 && selectionEquilibree && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-emerald-200/80 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                    Équilibré
                  </span>
                )}
              </div>
            )}
          </div>

          <aside className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <h3 className="font-semibold text-gray-900">Lettrage</h3>
            <div className="text-sm space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Résumé de la sélection</p>
              <p className="flex justify-between">
                <span className="text-gray-500">Montant débit</span>
                <span className="font-semibold">{fcfa(debitSel)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-gray-500">Montant crédit</span>
                <span className="font-semibold">{fcfa(creditSel)}</span>
              </p>
              <p className="flex justify-between items-center">
                <span className="text-gray-500">Écart</span>
                <span className="flex items-center gap-2">
                  <span className={`font-semibold ${ecartSel === 0 ? "text-emerald-600" : "text-red-600"}`}>{fcfa(ecartSel)}</span>
                  {ecartSel === 0 && selectedLignes.length >= 2 && (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                      Équilibré
                    </span>
                  )}
                </span>
              </p>
            </div>
            <button
              type="button"
              className="w-full px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-60"
              disabled={!selectionEquilibree}
              onClick={() => void onLettrer()}
            >
              Lettrer la sélection
            </button>
            <button
              type="button"
              title="Retire le code de lettrage sur les lignes sélectionnées (au moins une doit être lettrée). Pas besoin d’équilibre débit/crédit."
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-60"
              disabled={selectedLignes.length === 0 || !selectionALettrees}
              onClick={() => void onDelettrer()}
            >
              Délettrer
            </button>
            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-semibold text-gray-900 mb-3">Dernières actions de lettrage</p>
              <ul className="space-y-2 max-h-52 overflow-y-auto">
                {audit.slice(0, 8).map(a => (
                  <li key={a.id} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${auditDotClass(a.action)}`} />
                    <div className="min-w-0">
                      <p className="text-gray-800 font-medium">{auditActionLabel(a.action)}</p>
                      <p className="text-gray-500">
                        {new Date(a.createdAt).toLocaleDateString("fr-FR")}{" "}
                        {new Date(a.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {a.user?.nomComplet || a.user?.email || "Système"}
                      </p>
                    </div>
                  </li>
                ))}
                {audit.length === 0 && <li className="text-xs text-gray-500">Aucune action enregistrée.</li>}
              </ul>
            </div>
          </aside>
        </div>

        <div className="sticky bottom-2 mt-4 bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">
            {selectedLignes.length === 0
              ? "Cochez des lignes pour lettrer ou délettrer."
              : selectionEquilibree
                ? (
                  <>
                    <span className="font-medium text-gray-900">Sélection prête pour lettrage.</span>{" "}
                    {selectedLignes.length} écriture(s) sélectionnée(s) · Écart = {fcfa(ecartSel)}
                  </>
                )
                : (
                  <>
                    <span className="font-medium text-gray-800">Lettrage :</span> la somme des débits doit égaler la somme des crédits.
                    {" "}({selectedLignes.length} ligne(s) · Écart {fcfa(ecartSel)})
                  </>
                )}
          </p>
          <div className="flex gap-2 shrink-0">
            <button type="button" className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setSelectedLignes([])}>
              Annuler
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60"
              disabled={!selectionEquilibree}
              onClick={() => void onLettrer()}
            >
              Appliquer
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}

