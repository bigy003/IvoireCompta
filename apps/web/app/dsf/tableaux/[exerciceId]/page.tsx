"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import {
  deposerDsf,
  getDsfParExercice,
  marquerDsfPrete,
  verifierVisaDsf,
  viserDsf,
} from "@/lib/api"

function fcfa(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  try {
    const s = String(v).replace(/\s/g, "")
    if (!/^-?\d+$/.test(s)) return String(v)
    const n = BigInt(s)
    return new Intl.NumberFormat("fr-FR").format(n) + " FCFA"
  } catch {
    return String(v)
  }
}

type TabRow = { code: string; libelle: string; valide: boolean; donnees: Record<string, unknown> }

function VueT07({ d }: { d: Record<string, unknown> }) {
  const rei = (d.reintegrations as { libelle?: string; montant?: unknown; motif?: string }[]) ?? []
  const ded = (d.deductions as { libelle?: string; montant?: unknown; motif?: string }[]) ?? []
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
          <div className="text-xs text-gray-500 uppercase">Résultat comptable</div>
          <div className="font-bold text-gray-900 mt-1">{fcfa(d.resultatComptable)}</div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
          <div className="text-xs text-gray-500 uppercase">Résultat fiscal</div>
          <div className="font-bold text-gray-900 mt-1">{fcfa(d.resultatFiscal)}</div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
          <div className="text-xs text-gray-500 uppercase">Déficit reporté</div>
          <div className="font-semibold text-gray-800 mt-1">{fcfa(d.deficitReporte)}</div>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-3">
          <div className="text-xs text-orange-800 uppercase">Base imposable IS / IMF</div>
          <div className="font-bold text-orange-900 mt-1">{fcfa(d.baseImposable)}</div>
        </div>
      </div>
      {rei.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Réintégrations</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Libellé</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Motif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rei.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{r.libelle}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fcfa(r.montant)}</td>
                    <td className="px-3 py-2 text-gray-600">{r.motif}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {ded.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Déductions</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Libellé</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Motif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ded.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{r.libelle}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fcfa(r.montant)}</td>
                    <td className="px-3 py-2 text-gray-600">{r.motif}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const LABELS_T08: [string, string][] = [
  ["baseImposable", "Base imposable"],
  ["tauxIs", "Taux IS"],
  ["isCalcule", "IS calculé"],
  ["chiffreAffairesHT", "Chiffre d’affaires HT"],
  ["imfCalcule", "IMF calculée"],
  ["impotDu", "Impôt dû (MAX IS, IMF)"],
  ["modeImposition", "Mode d’imposition"],
  ["acomptesVersesN", "Acomptes versés (N)"],
  ["soldeAPayerAvril", "Solde à payer (avril N+1)"],
]

function fmtT08(key: string, d: Record<string, unknown>): string {
  if (key === "modeImposition") return String(d[key] ?? "—")
  if (key === "tauxIs") {
    const t = Number(d[key])
    if (Number.isNaN(t)) return "—"
    return `${(t * 100).toFixed(1)} %`
  }
  return fcfa(d[key])
}

function VueT08({ d }: { d: Record<string, unknown> }) {
  return (
    <dl className="grid gap-2 text-sm max-w-xl">
      {LABELS_T08.map(([key, label]) => (
        <div
          key={key}
          className="flex flex-wrap justify-between gap-2 py-2 border-b border-gray-100"
        >
          <dt className="text-gray-600">{label}</dt>
          <dd className="font-semibold text-gray-900 text-right">{fmtT08(key, d)}</dd>
        </div>
      ))}
    </dl>
  )
}

const LABELS_T09: [string, string][] = [
  ["isOuImfDu", "IS ou IMF dû"],
  ["tvaARegler", "TVA à régler"],
  ["itsDu", "ITS dû"],
  ["cnpsDu", "CNPS dû"],
  ["totalImpotsDus", "Total impôts dus"],
  ["acomptesDejaPaies", "Acomptes déjà payés"],
  ["soldeNet", "Solde net"],
  ["creditTvaReporte", "Crédit TVA reporté"],
]

function VueT09({ d }: { d: Record<string, unknown> }) {
  const ctx = (d.contentieuxFiscaux as unknown[]) ?? []
  return (
    <div className="space-y-4">
      <dl className="grid gap-2 text-sm max-w-xl">
        {LABELS_T09.map(([key, label]) => (
          <div
            key={key}
            className="flex flex-wrap justify-between gap-2 py-2 border-b border-gray-100"
          >
            <dt className="text-gray-600">{label}</dt>
            <dd className="font-semibold text-gray-900 text-right">{fcfa(d[key])}</dd>
          </div>
        ))}
      </dl>
      {ctx.length > 0 && (
        <p className="text-xs text-amber-700">Contentieux fiscaux : {JSON.stringify(ctx)}</p>
      )}
    </div>
  )
}

export default function DsfTableauxPage() {
  const params = useParams()
  const router = useRouter()
  const exerciceId = params.exerciceId as string
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [meta, setMeta] = useState<{
    exercice: { annee: number; clientNom: string; clientNcc: string }
    declaration: {
      id: string
      statut: string
      montantDu: string | null
      referenceEimpots: string | null
      dateDepot: string | null
      dateVisa: string | null
    }
  } | null>(null)
  const [tableaux, setTableaux] = useState<TabRow[]>([])
  const [sel, setSel] = useState("T07")
  const [cibleExport, setCibleExport] = useState<"all" | "current">("all")
  const [actionLoading, setActionLoading] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr("")
      setMsg("")
      try {
        const r = await getDsfParExercice(exerciceId)
        if (cancelled) return
        setMeta({
          exercice: r.data.exercice,
          declaration: r.data.declaration,
        })
        const tabs = (r.data.tableaux ?? []) as TabRow[]
        setTableaux(tabs)
        if (tabs[0]?.code) setSel(tabs[0].code)
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          setErr(typeof msg === "string" ? msg : "Impossible de charger les tableaux.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [exerciceId, router])

  const courant = tableaux.find(t => t.code === sel)
  const donnees = (courant?.donnees ?? {}) as Record<string, unknown>
  const titrePdf = meta
    ? `DSF-${meta.exercice.annee}-${meta.exercice.clientNom}-${cibleExport === "current" ? sel : "all"}`.replace(/[^\w\-]+/g, "_")
    : `DSF-${cibleExport === "current" ? sel : "all"}`

  function renderTableau(code: string, d: Record<string, unknown>) {
    if (code === "T07") return <VueT07 d={d} />
    if (code === "T08") return <VueT08 d={d} />
    if (code === "T09") return <VueT09 d={d} />
    return (
      <pre className="text-xs bg-gray-50 p-4 rounded-xl overflow-x-auto">
        {JSON.stringify(d, null, 2)}
      </pre>
    )
  }

  const codesExport =
    cibleExport === "all"
      ? tableaux.map(t => t.code)
      : [sel]

  async function reload() {
    const r = await getDsfParExercice(exerciceId)
    setMeta({
      exercice: r.data.exercice,
      declaration: r.data.declaration,
    })
    const tabs = (r.data.tableaux ?? []) as TabRow[]
    setTableaux(tabs)
    if (!tabs.find(t => t.code === sel) && tabs[0]?.code) setSel(tabs[0].code)
  }

  async function onPrete() {
    if (!meta?.declaration.id) return
    setActionLoading(true)
    setErr("")
    setMsg("")
    try {
      const r = await marquerDsfPrete(meta.declaration.id)
      setMsg(r.data?.message ?? "DSF marquée prête.")
      await reload()
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(typeof m === "string" ? m : "Échec marquage PRETE.")
    } finally {
      setActionLoading(false)
    }
  }

  async function onViser() {
    if (!meta?.declaration.id) return
    const code = window.prompt(
      "Code TOTP (6 chiffres) pour visa DSF :\n(En local/dev, code fictif autorisé : 000000)"
    )
    if (!code) return
    setActionLoading(true)
    setErr("")
    setMsg("")
    try {
      const vr = await verifierVisaDsf(code.trim())
      const visaToken = vr.data?.visaToken as string | undefined
      if (!visaToken) throw new Error("Visa token manquant")
      const r = await viserDsf(meta.declaration.id, visaToken)
      setMsg(r.data?.message ?? "DSF visée.")
      await reload()
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(typeof m === "string" ? m : "Échec visa DSF.")
    } finally {
      setActionLoading(false)
    }
  }

  async function onDeposer() {
    if (!meta?.declaration.id) return
    const ref = window.prompt("Référence e-impôts (obligatoire) :")
    if (!ref?.trim()) return
    setActionLoading(true)
    setErr("")
    setMsg("")
    try {
      const r = await deposerDsf(meta.declaration.id, ref.trim())
      setMsg(r.data?.message ?? "DSF déposée.")
      await reload()
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(typeof m === "string" ? m : "Échec dépôt DSF.")
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-3">
            <Link
              href="/dsf"
              className="text-sm font-semibold text-orange-600 hover:text-orange-700 inline-block"
            >
              ← Retour DSF & Déclarations
            </Link>
            <div className="flex items-center gap-2">
              <select
                value={cibleExport}
                onChange={e => setCibleExport(e.target.value as "all" | "current")}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                title="Choisir le contenu du PDF"
              >
                <option value="all">Exporter tous les tableaux</option>
                <option value="current">Exporter le tableau affiché</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  document.title = titrePdf
                  window.print()
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-100"
              >
                Exporter PDF
              </button>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Tableaux DSF (DGI-CI)</h1>
          {meta && (
            <p className="text-gray-600 mt-1">
              {meta.exercice.clientNom} — NCC {meta.exercice.clientNcc} — Exercice{" "}
              <span className="font-semibold">{meta.exercice.annee}</span>
              {meta.declaration.montantDu && (
                <>
                  {" "}
                  · Impôt dû estimé :{" "}
                  {new Intl.NumberFormat("fr-FR").format(Number(meta.declaration.montantDu))} FCFA
                </>
              )}
            </p>
          )}
          {meta && (
            <div className="no-print mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold rounded-full bg-gray-100 text-gray-700 px-2.5 py-1">
                Statut: {meta.declaration.statut}
              </span>
              {meta.declaration.dateVisa && (
                <span className="text-xs text-gray-500">Visée le {new Date(meta.declaration.dateVisa).toLocaleString("fr-FR")}</span>
              )}
              {meta.declaration.dateDepot && (
                <span className="text-xs text-gray-500">
                  Déposée le {new Date(meta.declaration.dateDepot).toLocaleString("fr-FR")} · Réf {meta.declaration.referenceEimpots}
                </span>
              )}
            </div>
          )}
          {meta && (
            <div className="no-print mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={actionLoading || meta.declaration.statut === "DEPOSEE" || meta.declaration.statut === "ACCEPTEE"}
                onClick={onPrete}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:border-orange-300 disabled:opacity-50"
              >
                Marquer prête
              </button>
              <button
                type="button"
                disabled={actionLoading || meta.declaration.statut === "DEPOSEE" || meta.declaration.statut === "ACCEPTEE"}
                onClick={onViser}
                className="px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-sm font-semibold hover:bg-orange-100 disabled:opacity-50"
              >
                Viser (TOTP)
              </button>
              <button
                type="button"
                disabled={actionLoading || meta.declaration.statut === "DEPOSEE" || meta.declaration.statut === "ACCEPTEE"}
                onClick={onDeposer}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                Marquer déposée
              </button>
            </div>
          )}
        </div>

        {loading && <p className="text-gray-500">Chargement…</p>}
        {msg && <p className="mb-4 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{msg}</p>}
        {err && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 text-amber-900 px-4 py-3 text-sm mb-6">
            {err}
            <div className="mt-3">
              <Link href="/dsf" className="font-semibold text-orange-700 underline">
                Retour à la liste
              </Link>
            </div>
          </div>
        )}

        {!loading && !err && tableaux.length > 0 && (
          <>
            <div className="no-print">
              <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
                {tableaux.map(t => (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => setSel(t.code)}
                    className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                      sel === t.code
                        ? "border-orange-500 text-orange-600"
                        : "border-transparent text-gray-500 hover:text-gray-800"
                    }`}
                  >
                    {t.code}
                    {!t.valide && (
                      <span className="ml-1 text-amber-600" title="Contrôles non validés">
                        *
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5 sm:p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">
                  {courant?.code} — {courant?.libelle}
                </h2>
                <p className="text-xs text-gray-500 mb-6">
                  Données issues des écritures validées (passage comptable → fiscal, IS/IMF, synthèse).
                </p>
                {renderTableau(sel, donnees)}
              </div>
            </div>

            <div className="hidden print:block mt-6 space-y-6">
              {codesExport.map(code => {
                const tab = tableaux.find(t => t.code === code)
                if (!tab) return null
                const d = (tab.donnees ?? {}) as Record<string, unknown>
                return (
                  <section key={`print-${code}`} className="rounded-2xl border border-gray-200 p-5 break-inside-avoid">
                    <h2 className="text-lg font-bold text-gray-900 mb-1">
                      {tab.code} — {tab.libelle}
                    </h2>
                    <p className="text-xs text-gray-500 mb-5">
                      Données issues des écritures validées (passage comptable → fiscal, IS/IMF, synthèse).
                    </p>
                    {renderTableau(tab.code, d)}
                  </section>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
