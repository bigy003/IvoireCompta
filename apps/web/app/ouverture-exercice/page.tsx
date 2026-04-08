"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import { api, checkOuvertureExercice, cloturerExercice, getClients, openExercice } from "@/lib/api"

type Client = { id: string; nomRaisonSociale: string }
type Dossier = { id: string; typeMission: string }
type Exercice = { id: string; annee: number; cloture: boolean; statut: string }
type Controle = {
  code: string
  controle: string
  statut: "BLOQUANT" | "ALERTE" | "OK"
  detail: string
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}
function fcfa(v: number) {
  return `${v.toLocaleString("fr-FR")} FCFA`
}

export default function OuvertureExercicePage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)
  const [err, setErr] = useState("")
  const [ok, setOk] = useState("")
  const [step, setStep] = useState(1)

  const [clients, setClients] = useState<Client[]>([])
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [clientId, setClientId] = useState("")
  const [dossierId, setDossierId] = useState("")
  const [exerciceSourceId, setExerciceSourceId] = useState("")
  const [anneeCible, setAnneeCible] = useState(new Date().getFullYear() + 1)
  const [dateDebut, setDateDebut] = useState(`${new Date().getFullYear() + 1}-01-01`)
  const [dateFin, setDateFin] = useState(`${new Date().getFullYear() + 1}-12-31`)

  const [reprendreSoldesGeneraux, setReprendreSoldesGeneraux] = useState(true)
  const [reprendreSoldesAuxiliaires, setReprendreSoldesAuxiliaires] = useState(true)
  const [creerANouveaux, setCreerANouveaux] = useState(true)

  const [controles, setControles] = useState<Controle[]>([])
  const [stats, setStats] = useState({
    bloquants: 0,
    alertes: 0,
    comptesAReprendre: 0,
    totalDebit: 0,
    totalCredit: 0,
    ecart: 0,
  })
  const [conseils, setConseils] = useState<string[]>([])
  const [createdExerciceId, setCreatedExerciceId] = useState("")

  const exerciceSource = useMemo(() => exercices.find(e => e.id === exerciceSourceId), [exercices, exerciceSourceId])
  const bloquant = stats.bloquants > 0

  async function onClientChange(id: string) {
    setClientId(id)
    setDossierId("")
    setExerciceSourceId("")
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
    setExerciceSourceId("")
    setExercices([])
    if (!id) return
    const re = await api.get(`/exercices?dossierId=${id}`)
    const list = (re.data.exercices ?? []) as Exercice[]
    setExercices(list)
    if (list[0]) {
      setExerciceSourceId(list[0].id)
      const y = (list[0].annee ?? new Date().getFullYear()) + 1
      setAnneeCible(y)
      setDateDebut(`${y}-01-01`)
      setDateFin(`${y}-12-31`)
    }
  }

  async function runCheck() {
    if (!dossierId || !exerciceSourceId) return
    setLoading(true)
    setErr("")
    setOk("")
    try {
      const r = await checkOuvertureExercice({
        dossierId,
        exerciceSourceId,
        anneeCible,
        dateDebut,
        dateFin,
      })
      setControles((r.data.controles ?? []) as Controle[])
      setStats(r.data.stats ?? stats)
      setConseils((r.data.conseils ?? []) as string[])
      setOk("Contrôles effectués.")
      if (step < 2) setStep(2)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Échec des contrôles.")
    } finally {
      setLoading(false)
    }
  }

  async function onOpen() {
    if (!dossierId || !exerciceSourceId) return
    setOpening(true)
    setErr("")
    setOk("")
    try {
      const r = await openExercice({
        dossierId,
        exerciceSourceId,
        anneeCible,
        dateDebut,
        dateFin,
        options: {
          reprendreSoldesGeneraux,
          reprendreSoldesAuxiliaires,
          creerANouveaux,
        },
      })
      setCreatedExerciceId((r.data?.exercice?.id as string) ?? "")
      setOk("Exercice créé avec succès.")
      await onDossierChange(dossierId)
      await runCheck()
      setStep(4)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Impossible d'ouvrir l'exercice.")
    } finally {
      setOpening(false)
    }
  }

  async function onCloturerSource() {
    if (!exerciceSourceId) return
    setClosing(true)
    setErr("")
    try {
      await cloturerExercice(exerciceSourceId)
      setOk("Exercice source clôturé.")
      await runCheck()
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { error?: string; brouillons?: number } } })?.response?.data
      if (data?.brouillons) {
        setErr(`${data.error} Brouillons: ${data.brouillons}.`)
      } else {
        setErr(data?.error || "Impossible de clôturer l'exercice source.")
      }
    } finally {
      setClosing(false)
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
        <h1 className="text-3xl font-bold text-gray-900">Exercices</h1>
        <p className="text-gray-500 mt-1 mb-4">Créez un nouvel exercice avec reprise des soldes de clôture.</p>

        {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
        {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            {["Sélection", "Contrôles", "Reprise des soldes", "Confirmation"].map((label, i) => (
              <button
                key={label}
                className={`rounded-xl border px-3 py-2 text-left ${step === i + 1 ? "border-orange-300 bg-orange-50" : "border-gray-200 bg-white"}`}
                onClick={() => setStep(i + 1)}
                type="button"
              >
                <div className="text-xs text-gray-500">Étape {i + 1}</div>
                <div className="font-semibold text-gray-900">{label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-3">
                <p className="text-xs text-blue-700">Exercice source</p>
                <p className="font-bold text-blue-900 text-xl">{exerciceSource?.annee ?? "—"}</p>
              </div>
              <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-3">
                <p className="text-xs text-emerald-700">Exercice cible</p>
                <p className="font-bold text-emerald-900 text-xl">{anneeCible}</p>
              </div>
              <div className="bg-red-50 rounded-xl border border-red-100 p-3">
                <p className="text-xs text-red-700">Bloquants</p>
                <p className="font-bold text-red-900 text-xl">{stats.bloquants}</p>
              </div>
              <div className="bg-amber-50 rounded-xl border border-amber-100 p-3">
                <p className="text-xs text-amber-700">Alertes</p>
                <p className="font-bold text-amber-900 text-xl">{stats.alertes}</p>
              </div>
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-600">Comptes à reprendre</p>
                <p className="font-bold text-gray-900 text-xl">{stats.comptesAReprendre}</p>
              </div>
            </div>

            {step === 1 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <h2 className="font-semibold text-gray-900 mb-3">1. Sélection des exercices</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={clientId} onChange={e => onClientChange(e.target.value)}>
                    <option value="">Client</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
                  </select>
                  <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={dossierId} onChange={e => onDossierChange(e.target.value)}>
                    <option value="">Dossier</option>
                    {dossiers.map(d => <option key={d.id} value={d.id}>{d.typeMission}</option>)}
                  </select>
                  <select className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" value={exerciceSourceId} onChange={e => setExerciceSourceId(e.target.value)}>
                    <option value="">Exercice source</option>
                    {exercices.map(ex => <option key={ex.id} value={ex.id}>{ex.annee} {ex.cloture || ex.statut === "CLOTURE" ? "(clôturé)" : ""}</option>)}
                  </select>
                  <input
                    type="number"
                    value={anneeCible}
                    onChange={e => setAnneeCible(parseInt(e.target.value || `${new Date().getFullYear() + 1}`, 10))}
                    className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    placeholder="Année cible"
                  />
                  <DatePickerFr value={dateDebut} onChange={setDateDebut} placeholder="Date début exercice cible" fromYear={1990} toYear={2100} />
                  <DatePickerFr value={dateFin} onChange={setDateFin} placeholder="Date fin exercice cible" fromYear={1990} toYear={2100} />
                </div>
                <div className="mt-3">
                  <button className="rounded-xl bg-orange-500 text-white px-4 py-2.5 text-sm font-semibold hover:bg-orange-600 disabled:opacity-60" onClick={runCheck} disabled={!dossierId || !exerciceSourceId || loading}>
                    {loading ? "Vérification..." : "Lancer les contrôles"}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">2. Contrôles de pré-ouverture</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                        <th className="text-left py-3 px-3">Code</th>
                        <th className="text-left py-3 px-3">Contrôle</th>
                        <th className="text-left py-3 px-3">Statut</th>
                        <th className="text-left py-3 px-3">Détail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {controles.map(c => (
                        <tr key={c.code}>
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium">{c.code}</td>
                          <td className="py-2.5 px-3">{c.controle}</td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                              c.statut === "BLOQUANT" ? "bg-red-100 text-red-700" : c.statut === "ALERTE" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                            }`}>
                              {c.statut === "BLOQUANT" ? "Bloquant" : c.statut === "ALERTE" ? "Alerte" : "OK"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-gray-600">{c.detail}</td>
                        </tr>
                      ))}
                      {controles.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">Lance les contrôles pour afficher la liste.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <h2 className="font-semibold text-gray-900 mb-3">3. Reprise des soldes (optionnelle)</h2>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={reprendreSoldesGeneraux} onChange={e => setReprendreSoldesGeneraux(e.target.checked)} />
                    Reprendre soldes généraux
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={reprendreSoldesAuxiliaires} onChange={e => setReprendreSoldesAuxiliaires(e.target.checked)} />
                    Reprendre soldes auxiliaires clients/fournisseurs
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={creerANouveaux} onChange={e => setCreerANouveaux(e.target.checked)} />
                    Créer écriture d&apos;à-nouveaux (journal AN)
                  </label>
                </div>
                <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm">
                  <p className="font-semibold text-gray-900 mb-1">Récapitulatif reprise</p>
                  <p className="text-gray-700">Comptes concernés: <span className="font-semibold">{stats.comptesAReprendre}</span></p>
                  <p className="text-gray-700">Total débit: <span className="font-semibold">{fcfa(stats.totalDebit)}</span></p>
                  <p className="text-gray-700">Total crédit: <span className="font-semibold">{fcfa(stats.totalCredit)}</span></p>
                  <p className={`${stats.ecart === 0 ? "text-emerald-700" : "text-red-700"} font-semibold`}>Écart: {fcfa(stats.ecart)}</p>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <h2 className="font-semibold text-gray-900 mb-3">4. Confirmation</h2>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  <p>Exercice source: {exerciceSource?.annee ?? "—"} {exerciceSource?.cloture || exerciceSource?.statut === "CLOTURE" ? "(clôturé)" : ""}</p>
                  <p>Exercice cible: {anneeCible} ({dateDebut} - {dateFin})</p>
                  <p>Reprise: {reprendreSoldesGeneraux ? "généraux" : "sans généraux"}, {reprendreSoldesAuxiliaires ? "auxiliaires" : "sans auxiliaires"}, {creerANouveaux ? "à-nouveaux" : "sans AN"}</p>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-500">Étape {step} sur 4</div>
              <div className="flex gap-2">
                <button className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>Précédent</button>
                {step < 4 ? (
                  <button className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600" onClick={() => setStep(Math.min(4, step + 1))}>Continuer</button>
                ) : (
                  <button className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-60" onClick={onOpen} disabled={bloquant || opening}>
                    {opening ? "Création en cours..." : "Créer l'exercice"}
                  </button>
                )}
              </div>
            </div>

            {dossierId && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Exercices existants du dossier</div>
                <div className="p-3 flex flex-wrap gap-2">
                  {exercices.map(ex => (
                    <span
                      key={ex.id}
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                        ex.id === createdExerciceId
                          ? "bg-emerald-100 text-emerald-700"
                          : ex.cloture || ex.statut === "CLOTURE"
                            ? "bg-gray-100 text-gray-700"
                            : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {ex.annee} {ex.id === createdExerciceId ? "(nouveau)" : ex.cloture || ex.statut === "CLOTURE" ? "(clôturé)" : "(ouvert)"}
                    </span>
                  ))}
                  {exercices.length === 0 && <p className="text-sm text-gray-500">Aucun exercice trouvé sur ce dossier.</p>}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="bg-orange-50 rounded-2xl border border-orange-100 p-4">
              <h3 className="font-semibold text-orange-900 mb-2">Conseils</h3>
              <ul className="space-y-1 text-sm text-orange-800">
                {(conseils.length ? conseils : ["Clôturez l'exercice N avant ouverture N+1."]).map((c, i) => <li key={i}>• {c}</li>)}
              </ul>
            </div>
            <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Journal d'audit prévu</h3>
              <ul className="space-y-1 text-sm text-blue-800">
                <li>• Création de l'exercice cible</li>
                <li>• Initialisation des journaux</li>
                <li>• Génération de l&apos;écriture d&apos;à-nouveaux</li>
                <li>• Horodatage + utilisateur</li>
              </ul>
            </div>
            {bloquant && (
              <div className="bg-red-50 rounded-2xl border border-red-100 p-4 text-sm text-red-700">
                Corrigez les contrôles bloquants pour activer l&apos;ouverture.
                {controles.some(c => c.code === "CT-01" && c.statut === "BLOQUANT") && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={onCloturerSource}
                      disabled={!exerciceSourceId || closing}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60"
                    >
                      {closing ? "Clôture..." : "Clôturer l'exercice source"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {createdExerciceId && (
              <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-4 text-sm text-emerald-800">
                Nouvel exercice créé.
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/bal-gl?clientId=${encodeURIComponent(clientId)}&exerciceId=${encodeURIComponent(createdExerciceId)}`)}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                  >
                    Aller à BAL | GL
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Layout>
  )
}

