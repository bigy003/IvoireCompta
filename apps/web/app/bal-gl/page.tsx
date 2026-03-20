"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { getBalance, getClients, getEcritures, api } from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Exercice = { id: string; annee: number }
type Journal = { id: string; code: string; libelle: string }
type BalanceRow = { compte: string; libelle: string; debit: string; credit: string; solde: string }
type GLRow = {
  id: string
  date: string
  compte: string
  journal: string
  piece: string
  libelle: string
  debit: number
  credit: number
  soldeCumule: number
}

const GL_ALL_ACCOUNTS = "__ALL__"

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

export default function BalGlPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [ok, setOk] = useState("")
  const [tab, setTab] = useState<"BAL" | "GL">("BAL")

  const [clients, setClients] = useState<Client[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [journaux, setJournaux] = useState<Journal[]>([])
  const [clientId, setClientId] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [journalCode, setJournalCode] = useState("")
  const [du, setDu] = useState(ymd(new Date(new Date().getFullYear(), 0, 1)))
  const [au, setAu] = useState(ymd(new Date()))

  const [balance, setBalance] = useState<BalanceRow[]>([])
  const [searchBal, setSearchBal] = useState("")
  const [classe, setClasse] = useState("")
  const [mouvementsOnly, setMouvementsOnly] = useState(true)

  const [glCompte, setGlCompte] = useState("")
  const [glRows, setGlRows] = useState<GLRow[]>([])
  const [exportTarget, setExportTarget] = useState<"BAL" | "GL">("BAL")

  async function loadClients() {
    const r = await getClients()
    setClients((r.data.clients ?? []) as Client[])
  }

  async function onClientChange(id: string) {
    setClientId(id)
    setExerciceId("")
    setJournaux([])
    if (!id) return
    const rc = await api.get(`/clients/${id}`)
    const dossierId = rc.data.client?.dossiers?.[0]?.id
    if (!dossierId) return
    const re = await api.get(`/exercices?dossierId=${dossierId}`)
    const list = (re.data.exercices ?? []) as Exercice[]
    setExercices(list)
    if (list[0]?.id) await onExerciceChange(list[0].id)
  }

  async function onExerciceChange(id: string) {
    setExerciceId(id)
    setBalance([])
    setGlRows([])
    if (!id) return
    const rj = await api.get(`/journaux?exerciceId=${id}`)
    const js = (rj.data.journaux ?? []) as Journal[]
    setJournaux(js)
    setJournalCode("")
  }

  async function actualiser() {
    if (!exerciceId) return
    setLoading(true)
    setErr("")
    setOk("")
    try {
      const rb = await getBalance(exerciceId)
      const bal = (rb.data.balance ?? []) as BalanceRow[]
      setBalance(bal)
      const compteSelectionne = glCompte || bal[0]?.compte || ""
      setGlCompte(compteSelectionne)
      if (compteSelectionne) {
        const isAllAccounts = compteSelectionne === GL_ALL_ACCOUNTS
        const rg = await getEcritures({
          exerciceId,
          ...(isAllAccounts ? {} : { compte: compteSelectionne }),
          ...(journalCode ? { journal: journalCode } : {}),
        })
        const ecritures = rg.data.ecritures ?? []
        const duMs = new Date(du).getTime()
        const auMs = new Date(au + "T23:59:59").getTime()
        const rowsBruts: Omit<GLRow, "soldeCumule">[] = []
        for (const e of ecritures) {
          const dms = new Date(e.dateOperation).getTime()
          if (Number.isNaN(dms) || dms < duMs || dms > auMs) continue
          const lignes = (e.lignes ?? []).filter((l: { compteSyscohada: string }) =>
            isAllAccounts ? true : l.compteSyscohada.startsWith(compteSelectionne)
          )
          for (const l of lignes) {
            const debit = n(l.debit)
            const credit = n(l.credit)
            rowsBruts.push({
              id: `${e.id}-${rowsBruts.length}`,
              date: e.dateOperation,
              compte: l.compteSyscohada ?? "—",
              journal: e.journal?.code ?? "—",
              piece: e.pieceRef ?? "—",
              libelle: e.libelle ?? l.libelleCompte ?? "—",
              debit,
              credit,
            })
          }
        }

        rowsBruts.sort((a, b) => {
          const d = new Date(a.date).getTime() - new Date(b.date).getTime()
          return d !== 0 ? d : a.id.localeCompare(b.id)
        })

        const cumuls = new Map<string, number>()
        const rows: GLRow[] = rowsBruts.map(r => {
          const precedent = cumuls.get(r.compte) ?? 0
          const courant = precedent + r.debit - r.credit
          cumuls.set(r.compte, courant)
          return { ...r, soldeCumule: courant }
        })
        setGlRows(rows)
      }
      setOk("BAL | GL actualisé.")
    } catch {
      setErr("Impossible de charger BAL | GL.")
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
    loadClients().catch(() => setErr("Impossible de charger les clients."))
  }, [router])

  const balanceFiltered = useMemo(() => {
    let list = balance
    if (classe) list = list.filter(r => r.compte.startsWith(classe))
    if (mouvementsOnly) list = list.filter(r => n(r.debit) !== 0 || n(r.credit) !== 0)
    const q = searchBal.trim().toLowerCase()
    if (q) {
      list = list.filter(
        r => r.compte.toLowerCase().includes(q) || r.libelle.toLowerCase().includes(q)
      )
    }
    return list
  }, [balance, classe, mouvementsOnly, searchBal])

  const totalDebit = balanceFiltered.reduce((s, r) => s + n(r.debit), 0)
  const totalCredit = balanceFiltered.reduce((s, r) => s + n(r.credit), 0)
  const ecart = Math.abs(totalDebit - totalCredit)

  const comptesSansMvt = balance.filter(r => n(r.debit) === 0 && n(r.credit) === 0).length
  const ecrituresNonValidees = 0 // MVP: endpoint dédié ultérieurement

  function exportCsv() {
    const rows =
      exportTarget === "BAL"
        ? [
            ["Compte", "Libellé", "Débit", "Crédit", "Solde", "Nature"],
            ...balanceFiltered.map(r => [
              r.compte,
              r.libelle,
              `${n(r.debit)}`,
              `${n(r.credit)}`,
              `${n(r.solde)}`,
              n(r.solde) >= 0 ? "Débiteur" : "Créditeur",
            ]),
            ["", "Total", `${totalDebit}`, `${totalCredit}`, `${totalDebit - totalCredit}`, ""],
          ]
        : (() => {
            const totalDebitGl = glRows.reduce((s, r) => s + r.debit, 0)
            const totalCreditGl = glRows.reduce((s, r) => s + r.credit, 0)
            const soldeFinal = glRows.length > 0 ? glRows[glRows.length - 1].soldeCumule : 0
            return [
              ["Date", "Compte", "Journal", "Pièce", "Libellé", "Débit", "Crédit", "Solde cumulé"],
              ...glRows.map(r => [
                fmtDate(r.date),
                r.compte,
                r.journal,
                r.piece,
                r.libelle,
                `${r.debit}`,
                `${r.credit}`,
                `${r.soldeCumule}`,
              ]),
              ["", "", "", "", "Total", `${totalDebitGl}`, `${totalCreditGl}`, `${soldeFinal}`],
            ]
          })()
    const csv = rows
      .map(r => r.map(v => `"${sanitizeCsvCell(v)}"`).join(";"))
      .join("\r\n")
    const csvExcel = `sep=;\r\n${csv}`
    const utf16le = toUtf16Le(csvExcel)
    const bom = new Uint8Array([0xff, 0xfe])
    const blob = new Blob([bom, utf16le], { type: "text/csv;charset=utf-16le;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = exportTarget === "BAL" ? "balance-generale.csv" : "grand-livre.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function toUtf16Le(text: string): Uint8Array {
    const buf = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      buf[i * 2] = code & 0xff
      buf[i * 2 + 1] = code >> 8
    }
    return buf
  }

  function sanitizeCsvCell(value: unknown): string {
    return String(value)
      .normalize("NFC")
      .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
      .replace(/[\u25A1\u25A0]/g, "'")
      .replace(/\uFFFD/g, "'")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
      .replace(/[^\p{L}\p{N}\s.,;:!?'"()\-_/&@+%€$]/gu, " ")
      .replace(/\s+/g, " ")
      .replace(/"/g, '""')
      .trim()
  }

  function exportPdf() {
    if (exportTarget === "BAL") {
      document.title = "BALANCE_GENERALE"
    } else {
      const cible = !glCompte || glCompte === GL_ALL_ACCOUNTS ? "tous_les_comptes" : glCompte
      document.title = `GRAND_LIVRE_${cible}`
    }
    window.print()
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
        <h1 className="text-3xl font-bold text-gray-900">BAL | GL</h1>
        <p className="text-gray-500 mt-1 mb-4">Balance générale et Grand Livre</p>

        {ok && <div className="no-print mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
        {err && <div className="no-print mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

        <div className="bg-white/95 rounded-2xl border border-gray-100 p-4 mb-4 space-y-3 no-print">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
              <option value="">Client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
            </select>
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={exerciceId} onChange={e => onExerciceChange(e.target.value)} disabled={!clientId}>
              <option value="">Exercice</option>
              {exercices.map(e => <option key={e.id} value={e.id}>{e.annee}</option>)}
            </select>
            <input type="date" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={du} onChange={e => setDu(e.target.value)} />
            <input type="date" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={au} onChange={e => setAu(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={journalCode} onChange={e => setJournalCode(e.target.value)}>
              <option value="">Journal (tous)</option>
              {journaux.map(j => <option key={j.id} value={j.code}>{j.code} — {j.libelle}</option>)}
            </select>
            <button className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600" onClick={actualiser} disabled={!exerciceId || loading}>
              {loading ? "Chargement…" : "Actualiser"}
            </button>
            <select
              value={exportTarget}
              onChange={e => setExportTarget(e.target.value as "BAL" | "GL")}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white"
              title="Choisir le contenu à exporter"
            >
              <option value="BAL">Exporter : Balance générale</option>
              <option value="GL">Exporter : Grand Livre</option>
            </select>
            <button className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={exportPdf}>
              Exporter PDF
            </button>
            <button className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700 hover:bg-emerald-100" onClick={exportCsv}>
              Exporter Excel
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 no-print">
          <div className="bg-white/95 rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 pt-4">
              <div className="flex gap-1 border-b border-gray-200">
                {(["BAL", "GL"] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === t ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500"}`}>
                    {t === "BAL" ? "Balance générale" : "Grand Livre"}
                  </button>
                ))}
              </div>
            </div>

            {tab === "BAL" && (
              <div className="p-4">
                <div className="flex flex-wrap gap-2 mb-3">
                  <input value={searchBal} onChange={e => setSearchBal(e.target.value)} placeholder="Rechercher un compte, libellé…" className="flex-1 min-w-[220px] rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
                  <select value={classe} onChange={e => setClasse(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
                    <option value="">Toutes classes</option>
                    {["1", "2", "3", "4", "5", "6", "7"].map(c => <option key={c} value={c}>Classe {c}</option>)}
                  </select>
                  <label className="text-sm text-gray-600 inline-flex items-center gap-2 px-3 py-2">
                    <input type="checkbox" checked={mouvementsOnly} onChange={e => setMouvementsOnly(e.target.checked)} />
                    Avec mouvements uniquement
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                        <th className="text-left py-3">Compte</th>
                        <th className="text-left py-3">Libellé</th>
                        <th className="text-right py-3">Débit</th>
                        <th className="text-right py-3">Crédit</th>
                        <th className="text-right py-3">Solde</th>
                        <th className="text-center py-3">Nature</th>
                        <th className="text-center py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {balanceFiltered.map(r => (
                        <tr key={r.compte}>
                          <td className="py-2.5 font-semibold text-gray-900">{r.compte}</td>
                          <td className="py-2.5 text-gray-700">{r.libelle}</td>
                          <td className="py-2.5 text-right tabular-nums">{fcfa(n(r.debit))}</td>
                          <td className="py-2.5 text-right tabular-nums">{fcfa(n(r.credit))}</td>
                          <td className="py-2.5 text-right tabular-nums">{fcfa(Math.abs(n(r.solde)))}</td>
                          <td className="py-2.5 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${n(r.solde) >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>
                              {n(r.solde) >= 0 ? "Débiteur" : "Créditeur"}
                            </span>
                          </td>
                          <td className="py-2.5 text-center">
                            <button className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs hover:border-orange-300" onClick={() => { setGlCompte(r.compte); setTab("GL"); actualiser() }}>
                              Voir GL
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 font-bold text-gray-900">
                        <td className="py-3">Total</td>
                        <td />
                        <td className="py-3 text-right">{fcfa(totalDebit)}</td>
                        <td className="py-3 text-right">{fcfa(totalCredit)}</td>
                        <td className="py-3 text-right">{fcfa(ecart)}</td>
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {tab === "GL" && (
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <select value={glCompte} onChange={e => setGlCompte(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm min-w-[200px]">
                    <option value={GL_ALL_ACCOUNTS}>Tous les comptes</option>
                    {balance.map(r => <option key={r.compte} value={r.compte}>{r.compte} — {r.libelle}</option>)}
                  </select>
                  <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm" onClick={actualiser}>Charger</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                        <th className="text-left py-3">Date</th>
                        <th className="text-left py-3">Compte</th>
                        <th className="text-left py-3">Journal</th>
                        <th className="text-left py-3">Pièce</th>
                        <th className="text-left py-3">Libellé</th>
                        <th className="text-right py-3">Débit</th>
                        <th className="text-right py-3">Crédit</th>
                        <th className="text-right py-3">Solde cumulé</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {glRows.map(r => (
                        <tr key={r.id}>
                          <td className="py-2.5">{fmtDate(r.date)}</td>
                          <td className="py-2.5">{r.compte}</td>
                          <td className="py-2.5">{r.journal}</td>
                          <td className="py-2.5">{r.piece}</td>
                          <td className="py-2.5">{r.libelle}</td>
                          <td className="py-2.5 text-right tabular-nums">{fcfa(r.debit)}</td>
                          <td className="py-2.5 text-right tabular-nums">{fcfa(r.credit)}</td>
                          <td className="py-2.5 text-right tabular-nums font-semibold">{fcfa(Math.abs(r.soldeCumule))}</td>
                        </tr>
                      ))}
                      {glRows.length === 0 && (
                        <tr><td className="py-8 text-center text-gray-500" colSpan={8}>Aucun mouvement pour cette sélection/période.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
              <h3 className="font-bold text-gray-900 mb-3">Contrôles & alertes</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-gray-100 pb-2">
                  <span className="text-gray-600">Comptes sans mouvement</span>
                  <span className="font-bold text-gray-900">{comptesSansMvt}</span>
                </div>
                <div className="flex justify-between border-b border-gray-100 pb-2">
                  <span className="text-gray-600">Écritures non validées</span>
                  <span className="font-bold text-gray-900">{ecrituresNonValidees}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Écart débit/crédit</span>
                  <span className={`font-bold ${ecart === 0 ? "text-emerald-600" : "text-red-600"}`}>{fcfa(ecart)}</span>
                </div>
              </div>
            </div>
            <div className="bg-white/95 rounded-2xl border border-gray-100 p-4">
              <h3 className="font-bold text-gray-900 mb-2">Conseils de révision</h3>
              <p className="text-sm text-gray-600">
                Vérifie en priorité les classes 4 et 5, puis les écarts de solde non justifiés.
              </p>
            </div>
          </aside>
        </div>

        <div className="hidden print:block">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            {exportTarget === "BAL"
              ? "Balance générale"
              : `Grand Livre${
                  glCompte && glCompte !== GL_ALL_ACCOUNTS ? ` — Compte ${glCompte}` : " — Tous les comptes"
                }`}
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Client: {clients.find(c => c.id === clientId)?.nomRaisonSociale ?? "—"} · Exercice:{" "}
            {exercices.find(e => e.id === exerciceId)?.annee ?? "—"} · Période: {fmtDate(du)} → {fmtDate(au)}
          </p>

          {exportTarget === "BAL" ? (
            <table className="w-full text-sm border-separate [border-spacing:0]">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 px-2">Compte</th>
                  <th className="text-left py-2 px-2">Libellé</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Débit</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Crédit</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Solde</th>
                  <th className="text-center py-2 px-2 whitespace-nowrap">Nature</th>
                </tr>
              </thead>
              <tbody>
                {balanceFiltered.map(r => (
                  <tr key={`p-${r.compte}`} className="border-b border-gray-100">
                    <td className="py-2 px-2 whitespace-nowrap">{r.compte}</td>
                    <td className="py-2 px-2">{r.libelle}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(n(r.debit))}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(n(r.credit))}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(Math.abs(n(r.solde)))}</td>
                    <td className="py-2 px-2 text-center whitespace-nowrap">{n(r.solde) >= 0 ? "Débiteur" : "Créditeur"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t border-gray-300">
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(totalDebit)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(totalCredit)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(ecart)}</td>
                  <td className="py-2 px-2" />
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="w-full text-sm border-separate [border-spacing:0]">
              <thead>
                <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 px-2 whitespace-nowrap">Date</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">Compte</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">Journal</th>
                  <th className="text-left py-2 px-2 whitespace-nowrap">Pièce</th>
                  <th className="text-left py-2 px-2">Libellé</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Débit</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Crédit</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Solde cumulé</th>
                </tr>
              </thead>
              <tbody>
                {glRows.map(r => (
                  <tr key={`pgl-${r.id}`} className="border-b border-gray-100">
                    <td className="py-2 px-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{r.compte}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{r.journal}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{r.piece}</td>
                    <td className="py-2 px-2">{r.libelle}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(r.debit)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(r.credit)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(Math.abs(r.soldeCumule))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t border-gray-300">
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(glRows.reduce((s, r) => s + r.debit, 0))}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(glRows.reduce((s, r) => s + r.credit, 0))}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{fcfa(Math.abs(glRows.length ? glRows[glRows.length - 1].soldeCumule : 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </Layout>
  )
}

