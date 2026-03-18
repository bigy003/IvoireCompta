"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { getDashboard } from "@/lib/api"

const TYPE_DECL_LABEL: Record<string, string> = {
  TVA_MENSUELLE: "TVA mensuelle",
  IS_ACOMPTE_1: "IS — 1er acompte",
  IS_ACOMPTE_2: "IS — 2e acompte",
  IS_ACOMPTE_3: "IS — 3e acompte",
  IS_SOLDE: "IS — solde",
  IMF: "IMF",
  DSF_ANNUELLE: "DSF annuelle",
  CNPS_MENSUELLE: "CNPS mensuelle",
  ITS_MENSUEL: "ITS mensuel",
  PATENTE: "Patente",
  DECLARATION_EMPLOI: "Déclaration emploi",
}

type DossiersParStatut = {
  EN_COURS: number
  SUSPENDU: number
  CLOTURE: number
  ARCHIVE: number
}

type EcheanceRow = {
  id: string
  clientNom: string
  typeDeclaration: string
  periodeLabel: string
  dateEcheance: string
  joursRestants: number
  urgence: string
}

type ActiviteMois = {
  label: string
  declarationsDeposees: number
  ecrituresValidees: number
}

type DashboardData = {
  kpis: {
    nbClients: number
    nbDossiersEnCours: number
    declarationsEnRetard: number
    declarationsDeposeesMois: number
    echeancesProchaines: number
    ecrituresBrouillon: number
  }
  dossiersParStatut: DossiersParStatut
  activiteMensuelle: ActiviteMois[]
  echeances: EcheanceRow[]
  alertes: EcheanceRow[]
}

const emptyDashboard: DashboardData = {
  kpis: {
    nbClients: 0,
    nbDossiersEnCours: 0,
    declarationsEnRetard: 0,
    declarationsDeposeesMois: 0,
    echeancesProchaines: 0,
    ecrituresBrouillon: 0,
  },
  dossiersParStatut: { EN_COURS: 0, SUSPENDU: 0, CLOTURE: 0, ARCHIVE: 0 },
  activiteMensuelle: [],
  echeances: [],
  alertes: [],
}

function formatDateFr(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

function DonutDossiers({ d }: { d: DossiersParStatut }) {
  const segments = [
    { key: "EN_COURS", label: "En cours", color: "#16a34a", n: d.EN_COURS },
    { key: "SUSPENDU", label: "Suspendus", color: "#f59e0b", n: d.SUSPENDU },
    { key: "CLOTURE", label: "Clôturés", color: "#94a3b8", n: d.CLOTURE },
    { key: "ARCHIVE", label: "Archivés", color: "#cbd5e1", n: d.ARCHIVE },
  ]
  const total = segments.reduce((s, x) => s + x.n, 0)
  const r = 52
  const c = 2 * Math.PI * r

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="relative h-32 w-32 rounded-full border-8 border-gray-100 flex items-center justify-center">
          <span className="text-sm font-semibold text-gray-400">—</span>
        </div>
        <p className="mt-3 text-sm text-gray-500">Aucun dossier pour l’instant</p>
        <Link
          href="/clients"
          className="mt-2 text-sm font-semibold text-orange-500 hover:text-orange-600"
        >
          Créer un client
        </Link>
      </div>
    )
  }

    const arcLen = (n: number) => (n / total) * c
    let dashOffset = 0
    const arcs = segments
      .filter(seg => seg.n > 0)
      .map(seg => {
        const len = arcLen(seg.n)
        const el = (
          <circle
            key={seg.key}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="16"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-dashOffset}
            className="transition-all"
          />
        )
        dashOffset += len
        return el
      })

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg width="140" height="140" viewBox="0 0 120 120" className="shrink-0 -rotate-90">
        {arcs}
      </svg>
      <div className="space-y-2 min-w-[140px]">
        {segments.map(seg => (
          <div key={seg.key} className="flex items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 text-gray-600">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
              {seg.label}
            </span>
            <span className="font-semibold text-gray-900">{seg.n}</span>
          </div>
        ))}
        <p className="text-xs text-gray-400 pt-1">{total} dossier{total > 1 ? "s" : ""} au total</p>
      </div>
    </div>
  )
}

function BarActivite({ data }: { data: ActiviteMois[] }) {
  const max = Math.max(
    1,
    ...data.flatMap(m => [m.declarationsDeposees, m.ecrituresValidees])
  )
  const h = 140
  return (
    <div className="flex items-end justify-between gap-2 sm:gap-3 pt-4" style={{ height: h + 48 }}>
      {data.map(m => {
        const hDep = Math.round((m.declarationsDeposees / max) * h)
        const hEc = Math.round((m.ecrituresValidees / max) * h)
        return (
          <div key={m.label} className="flex flex-1 flex-col items-center gap-1 min-w-0">
            <div className="flex items-end justify-center gap-0.5 w-full h-[140px]">
              <div
                className="w-[42%] max-w-[28px] rounded-t-md bg-green-500 min-h-[2px] transition-all"
                style={{ height: Math.max(hDep, m.declarationsDeposees ? 4 : 2) }}
                title={`Dépôts : ${m.declarationsDeposees}`}
              />
              <div
                className="w-[42%] max-w-[28px] rounded-t-md bg-orange-400 min-h-[2px] transition-all"
                style={{ height: Math.max(hEc, m.ecrituresValidees ? 4 : 2) }}
                title={`Écritures validées : ${m.ecrituresValidees}`}
              />
            </div>
            <span className="text-[10px] sm:text-xs text-gray-500 text-center leading-tight truncate w-full">
              {m.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData>(emptyDashboard)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await getDashboard()
        if (!cancelled && res.data) {
          const payload = res.data as DashboardData
          setData({
            ...emptyDashboard,
            ...payload,
            kpis: { ...emptyDashboard.kpis, ...payload.kpis },
            dossiersParStatut: {
              ...emptyDashboard.dossiersParStatut,
              ...payload.dossiersParStatut,
            },
            activiteMensuelle: payload.activiteMensuelle ?? [],
            echeances: payload.echeances ?? [],
            alertes: payload.alertes ?? [],
          })
        }
      } catch {
        if (!cancelled) {
          setFetchError("Données tableau de bord indisponibles (mode hors ligne ou API).")
          setData(emptyDashboard)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const activiteChart = useMemo(() => {
    if (data.activiteMensuelle.length === 6) return data.activiteMensuelle
    const now = new Date()
    const out: ActiviteMois[] = []
    for (let i = 5; i >= 0; i--) {
      const x = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({
        label: x.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
        declarationsDeposees: 0,
        ecrituresValidees: 0,
      })
    }
    data.activiteMensuelle.forEach((row, i) => {
      if (i < 6 && out[i]) {
        out[i] = { ...out[i], ...row, label: row.label || out[i].label }
      }
    })
    return out
  }, [data.activiteMensuelle])

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-gray-500 text-sm">Chargement du tableau de bord…</div>
        </div>
      </Layout>
    )
  }

  const { kpis, dossiersParStatut, echeances, alertes } = data
  const totalDossiers =
    dossiersParStatut.EN_COURS +
    dossiersParStatut.SUSPENDU +
    dossiersParStatut.CLOTURE +
    dossiersParStatut.ARCHIVE

  return (
    <Layout>
      <div
        className="min-h-screen pb-12"
        style={{
          backgroundImage: "url('/images/Background.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Tableau de bord</h1>
              <p className="text-gray-500 text-sm mt-1">
                Vue cabinet — mandats, fiscalité et charge de travail
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500 bg-white/90 border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
                Période : mois en cours
              </span>
              <span className="text-xs font-medium text-gray-500 bg-white/90 border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
                Tous les dossiers
              </span>
            </div>
          </div>

          {fetchError && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {fetchError}
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5">
              <p className="text-sm font-medium text-gray-500">Clients actifs</p>
              <p className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{kpis.nbClients}</p>
              <p className="text-xs text-gray-400 mt-2">Entreprises suivies par le cabinet</p>
            </div>
            <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5">
              <p className="text-sm font-medium text-gray-500">Dossiers en cours</p>
              <p className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">
                {kpis.nbDossiersEnCours}
              </p>
              <p className="text-xs text-gray-400 mt-2">Missions comptables actives</p>
            </div>
            <div
              className={`rounded-2xl bg-white/95 backdrop-blur shadow-lg border p-5 ${
                kpis.declarationsEnRetard > 0
                  ? "border-red-200 ring-1 ring-red-100"
                  : "border-white/80"
              }`}
            >
              <p className="text-sm font-medium text-gray-500">Déclarations en retard</p>
              <p
                className={`text-3xl font-bold mt-1 tabular-nums ${
                  kpis.declarationsEnRetard > 0 ? "text-red-600" : "text-gray-900"
                }`}
              >
                {kpis.declarationsEnRetard}
              </p>
              <p className="text-xs text-gray-400 mt-2">À préparer ou déposer en urgence</p>
            </div>
            <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5">
              <p className="text-sm font-medium text-gray-500">Dépôts fiscaux ce mois</p>
              <p className="text-3xl font-bold text-green-600 mt-1 tabular-nums">
                {kpis.declarationsDeposeesMois}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Déclarations déposées · {kpis.echeancesProchaines} échéance(s) sous 30 j.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5 lg:col-span-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-900">Dossiers par statut</h2>
              </div>
              <DonutDossiers d={dossiersParStatut} />
              <Link
                href="/clients"
                className="mt-4 inline-flex text-sm font-semibold text-orange-500 hover:text-orange-600"
              >
                Voir les clients & dossiers →
              </Link>
            </div>

            <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5">
              <h2 className="font-bold text-gray-900 mb-4">Charge comptable</h2>
              <ul className="space-y-3 text-sm">
                <li className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Écritures en brouillon</span>
                  <span className="font-bold text-amber-600 tabular-nums">
                    {kpis.ecrituresBrouillon}
                  </span>
                </li>
                <li className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Dossiers actifs</span>
                  <span className="font-bold text-gray-900 tabular-nums">{totalDossiers}</span>
                </li>
                <li className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-600">Échéances à venir (30 j.)</span>
                  <span className="font-bold text-gray-900 tabular-nums">
                    {kpis.echeancesProchaines}
                  </span>
                </li>
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/ecritures"
                  className="text-sm font-semibold text-green-600 hover:text-green-700"
                >
                  Saisie écritures
                </Link>
                <span className="text-gray-300">|</span>
                <Link href="/dsf" className="text-sm font-semibold text-orange-500 hover:text-orange-600">
                  DSF & déclarations
                </Link>
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-green-50 border border-orange-100 p-5">
              <h2 className="font-bold text-gray-900 mb-3">Aide & ressources</h2>
              <ul className="space-y-3 text-sm text-gray-700">
                <li>
                  <span className="font-medium text-gray-900">Modèles d&apos;écriture</span>
                  <p className="text-xs text-gray-500 mt-0.5">SYSCOHADA — bientôt disponible</p>
                </li>
                <li className="pt-2 border-t border-orange-100">
                  <span className="font-medium text-gray-900">Support IvoireCompta</span>
                  <p className="text-xs text-gray-600 mt-1">+225 07 22 33 44 55</p>
                </li>
              </ul>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-white border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Envoyer un message
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5">
              <h2 className="font-bold text-gray-900 mb-1">Activité sur 6 mois</h2>
              <p className="text-xs text-gray-500 mb-2">
                Barres vertes : déclarations déposées · Orange : écritures validées
              </p>
              <BarActivite data={activiteChart} />
            </div>

            <div className="lg:col-span-2 rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-white/80 p-5">
              <h2 className="font-bold text-gray-900 mb-1">Échéances & alertes</h2>
              <p className="text-xs text-gray-500 mb-4">Prochaines obligations fiscales (cabinet)</p>
              <ul className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {alertes.length > 0 && (
                  <li className="text-xs font-bold text-red-600 uppercase tracking-wide">
                    Urgent (≤ 7 j.)
                  </li>
                )}
                {alertes.map(e => (
                  <li
                    key={`a-${e.id}`}
                    className="rounded-xl border border-red-100 bg-red-50/80 px-3 py-2.5 text-sm"
                  >
                    <p className="font-semibold text-gray-900">{e.clientNom}</p>
                    <p className="text-red-700 text-xs mt-0.5">
                      {TYPE_DECL_LABEL[e.typeDeclaration] ?? e.typeDeclaration} —{" "}
                      {formatDateFr(e.dateEcheance)} ({e.joursRestants} j.)
                    </p>
                  </li>
                ))}
                {echeances
                  .filter(e => e.urgence !== "ROUGE")
                  .slice(0, 8)
                  .map(e => (
                    <li
                      key={e.id}
                      className={`rounded-xl border px-3 py-2.5 text-sm ${
                        e.urgence === "ORANGE"
                          ? "border-amber-100 bg-amber-50/80"
                          : "border-gray-100 bg-gray-50/80"
                      }`}
                    >
                      <p className="font-semibold text-gray-900">{e.clientNom}</p>
                      <p className="text-gray-600 text-xs mt-0.5">
                        {TYPE_DECL_LABEL[e.typeDeclaration] ?? e.typeDeclaration} ·{" "}
                        {e.periodeLabel}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Échéance {formatDateFr(e.dateEcheance)} · J-{e.joursRestants}
                      </p>
                    </li>
                  ))}
                {echeances.length === 0 && alertes.length === 0 && (
                  <li className="text-sm text-gray-500 py-8 text-center">
                    Aucune échéance dans les 30 prochains jours.
                    <br />
                    <span className="text-xs">Les échéances liées à vos clients apparaîtront ici.</span>
                  </li>
                )}
              </ul>
              <Link
                href="/dsf"
                className="mt-4 inline-block text-sm font-semibold text-orange-500 hover:text-orange-600"
              >
                Voir toutes les déclarations →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
