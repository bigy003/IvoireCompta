"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { getDsfParExercice } from "@/lib/api"

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
    declaration: { statut: string; montantDu: string | null }
  } | null>(null)
  const [tableaux, setTableaux] = useState<TabRow[]>([])
  const [sel, setSel] = useState("T07")

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr("")
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

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <Link
            href="/dsf"
            className="text-sm font-semibold text-orange-600 hover:text-orange-700 mb-3 inline-block"
          >
            ← Retour DSF & Déclarations
          </Link>
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
        </div>

        {loading && <p className="text-gray-500">Chargement…</p>}
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
              {sel === "T07" && <VueT07 d={donnees} />}
              {sel === "T08" && <VueT08 d={donnees} />}
              {sel === "T09" && <VueT09 d={donnees} />}
              {!["T07", "T08", "T09"].includes(sel) && (
                <pre className="text-xs bg-gray-50 p-4 rounded-xl overflow-x-auto">
                  {JSON.stringify(donnees, null, 2)}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
