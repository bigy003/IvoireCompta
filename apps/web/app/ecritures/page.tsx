"use client"

import { useState, useEffect, useRef, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import { getClients, creerEcriture, api, initialiserComptabiliteClient } from "@/lib/api"
import { PLAN_COMPTES_CI, libelleCompteDefaut } from "@/lib/plan-comptable-ci"

interface Ligne {
  compteSyscohada: string
  libelleCompte: string
  debit: string
  credit: string
}

interface Client {
  id: string
  nomRaisonSociale: string
}
interface Exercice {
  id: string
  annee: number
}
interface Journal {
  id: string
  code: string
  libelle: string
}

function fmtFcfa(n: number) {
  return `${n.toLocaleString("fr-FR").replace(/\s/g, " ")} FCFA`
}

function EcriturePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preselectClientRef = useRef<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [exercices, setExercices] = useState<Exercice[]>([])
  const [journaux, setJournaux] = useState<Journal[]>([])
  const [clientId, setClientId] = useState("")
  const [exerciceId, setExerciceId] = useState("")
  const [journalCode, setJournalCode] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [libelle, setLibelle] = useState("")
  const [pieceRef, setPieceRef] = useState("")
  const [lignes, setLignes] = useState<Ligne[]>([
    { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
    { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
    { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
  ])
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [erreurs, setErreurs] = useState<string[]>([])
  const [avertissements, setAvertissements] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [succes, setSucces] = useState("")
  const [authLoading, setAuthLoading] = useState(true)

  const totalDebit = lignes.reduce((s, l) => s + (parseInt(l.debit, 10) || 0), 0)
  const totalCredit = lignes.reduce((s, l) => s + (parseInt(l.credit, 10) || 0), 0)
  const equilibre = totalDebit === totalCredit && totalDebit > 0

  const comptesParClasse = useMemo(() => {
    const m = new Map<string, (typeof PLAN_COMPTES_CI)[number][]>()
    for (const c of PLAN_COMPTES_CI) {
      if (!m.has(c.classe)) m.set(c.classe, [])
      m.get(c.classe)!.push(c)
    }
    return Array.from(m.entries()) as [string, (typeof PLAN_COMPTES_CI)[number][]][]
  }, [])

  function compteDansPlan(numero: string) {
    return PLAN_COMPTES_CI.some(c => c.numero === numero)
  }

  function onCompteSelect(index: number, value: string) {
    const updated = [...lignes]
    if (value === "") {
      updated[index] = { ...updated[index], compteSyscohada: "", libelleCompte: "" }
    } else if (value === "__manual__") {
      if (compteDansPlan(updated[index].compteSyscohada)) {
        updated[index] = { ...updated[index], compteSyscohada: "", libelleCompte: "" }
      }
    } else {
      updated[index] = {
        ...updated[index],
        compteSyscohada: value,
        libelleCompte: libelleCompteDefaut(value),
      }
    }
    setLignes(updated)
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
    getClients()
      .then(r => setClients(r.data.clients))
      .catch(() => {})
  }, [router])

  useEffect(() => {
    const wanted = searchParams.get("client")
    if (!wanted || preselectClientRef.current === wanted) return
    const list = clients
    if (!list.some(c => c.id === wanted)) return
    preselectClientRef.current = wanted
    void (async () => {
      setClientId(wanted)
      setExerciceId("")
      setJournalCode("")
      setExercices([])
      setJournaux([])
      let r = await api.get(`/clients/${wanted}`)
      let dossiers = r.data.client.dossiers ?? []
      if (dossiers.length === 0) {
        try {
          await initialiserComptabiliteClient(wanted)
          r = await api.get(`/clients/${wanted}`)
          dossiers = r.data.client.dossiers ?? []
        } catch {
          /* ignore */
        }
      }
      if (dossiers.length > 0) {
        let exs = await api.get(`/exercices?dossierId=${dossiers[0].id}`)
        let exList = exs.data.exercices ?? []
        if (exList.length === 0) {
          try {
            await initialiserComptabiliteClient(wanted)
            exs = await api.get(`/exercices?dossierId=${dossiers[0].id}`)
            exList = exs.data.exercices ?? []
          } catch {
            /* ignore */
          }
        }
        setExercices(exList)
        const cur = new Date().getFullYear()
        const def = exList.find((e: Exercice) => e.annee === cur) ?? exList[0]
        if (def) {
          setExerciceId(def.id)
          const jr = await api.get(`/journaux?exerciceId=${def.id}`)
          const jlist = jr.data.journaux ?? []
          setJournaux(jlist)
          if (jlist[0]?.code) setJournalCode(jlist[0].code)
        }
      }
    })()
  }, [clients, searchParams])

  async function onClientChange(id: string) {
    setClientId(id)
    setExerciceId("")
    setJournalCode("")
    setExercices([])
    setJournaux([])
    if (!id) return
    let r = await api.get(`/clients/${id}`)
    let dossiers = r.data.client.dossiers ?? []
    if (dossiers.length === 0) {
      try {
        await initialiserComptabiliteClient(id)
        r = await api.get(`/clients/${id}`)
        dossiers = r.data.client.dossiers ?? []
      } catch {
        /* ignore */
      }
    }
    if (dossiers.length > 0) {
      let exs = await api.get(`/exercices?dossierId=${dossiers[0].id}`)
      let list = exs.data.exercices ?? []
      if (list.length === 0) {
        try {
          await initialiserComptabiliteClient(id)
          exs = await api.get(`/exercices?dossierId=${dossiers[0].id}`)
          list = exs.data.exercices ?? []
        } catch {
          /* ignore */
        }
      }
      setExercices(list)
    }
  }

  async function onExerciceChange(id: string) {
    setExerciceId(id)
    setJournalCode("")
    if (!id) return
    const r = await api.get(`/journaux?exerciceId=${id}`)
    setJournaux(r.data.journaux ?? [])
  }

  function updateLigne(index: number, field: keyof Ligne, value: string) {
    const updated = [...lignes]
    updated[index] = { ...updated[index], [field]: value }
    setLignes(updated)
  }

  function toggleRow(i: number) {
    const next = new Set(selectedRows)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setSelectedRows(next)
  }

  function ajouterLigne() {
    setLignes([...lignes, { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" }])
  }

  function supprimerLigne(index: number) {
    if (lignes.length <= 2) return
    setLignes(lignes.filter((_, i) => i !== index))
    setSelectedRows(prev => {
      const n = new Set<number>()
      prev.forEach(j => {
        if (j < index) n.add(j)
        else if (j > index) n.add(j - 1)
      })
      return n
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErreurs([])
    setAvertissements([])
    setSucces("")
    if (!date?.trim()) {
      setErreurs(["Veuillez choisir la date d’opération."])
      return
    }
    setLoading(true)
    try {
      const payload = {
        exerciceId,
        journalCode,
        dateOperation: new Date(date).toISOString(),
        libelle,
        pieceRef: pieceRef || undefined,
        lignes: lignes
          .filter(l => l.compteSyscohada)
          .map(l => ({
            compteSyscohada: l.compteSyscohada,
            libelleCompte: l.libelleCompte,
            debit: parseInt(l.debit, 10) || 0,
            credit: parseInt(l.credit, 10) || 0,
          })),
      }
      const r = await creerEcriture(payload)
      setSucces("Écriture enregistrée avec succès.")
      setAvertissements(r.data.avertissements ?? [])
      setLignes([
        { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
        { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
        { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
      ])
      setLibelle("")
      setPieceRef("")
      setSelectedRows(new Set())
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { erreurs?: unknown; error?: string } } })?.response
        ?.data
      if (data?.erreurs) {
        const er = data.erreurs
        if (Array.isArray(er)) setErreurs(er.map(String))
        else if (typeof er === "object")
          setErreurs(Object.values(er).flat().map(String))
        else setErreurs([String(er)])
      } else setErreurs([data?.error ?? "Erreur inattendue"])
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400/80 focus:border-orange-300 bg-white"
  const selectClass = inputClass + " cursor-pointer appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10"
  const labelClass = "block text-sm font-medium text-gray-700 mb-1.5"

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[40vh] text-gray-500 text-sm">
          Chargement…
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div
        className="min-h-screen pb-36"
        style={{
          backgroundImage: "url('/images/Background.png')",
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-orange-50/40 via-white/20 to-transparent pointer-events-none h-48" />

        <form
          id="ecriture-form"
          onSubmit={handleSubmit}
          className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8"
        >
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Nouvelle écriture comptable
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Saisie SYSCOHADA — équilibre débit / crédit obligatoire
            </p>
          </div>

          {succes && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 text-green-800 px-4 py-3 text-sm">
              {succes}
            </div>
          )}
          {erreurs.length > 0 && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-1">
              {erreurs.map((e, i) => (
                <div key={i} className="text-red-700 text-sm">
                  {e}
                </div>
              ))}
            </div>
          )}
          {avertissements.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
              {avertissements.map((a, i) => (
                <div key={i} className="text-amber-800 text-sm">
                  {a}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Colonne principale */}
            <div className="lg:col-span-8 space-y-5">
              <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-gray-100 p-5 sm:p-6">
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                  Mandat & exercice
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Client *</label>
                    <select
                      value={clientId}
                      onChange={e => onClientChange(e.target.value)}
                      required
                      className={selectClass}
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                      }}
                    >
                      <option value="">Sélectionner un client</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.nomRaisonSociale}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Exercice *</label>
                    <select
                      value={exerciceId}
                      onChange={e => onExerciceChange(e.target.value)}
                      required
                      className={selectClass}
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                      }}
                    >
                      <option value="">Année comptable</option>
                      {exercices.map(ex => (
                        <option key={ex.id} value={ex.id}>
                          {ex.annee}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-gray-100 p-5 sm:p-6">
                <div className="grid sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelClass}>Journal *</label>
                    <select
                      value={journalCode}
                      onChange={e => setJournalCode(e.target.value)}
                      required
                      className={selectClass}
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                      }}
                    >
                      <option value="">Choisir le journal</option>
                      {journaux.map(j => (
                        <option key={j.id} value={j.code}>
                          {j.libelle}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Date *</label>
                    <DatePickerFr
                      value={date}
                      onChange={setDate}
                      placeholder="Choisir la date d’opération"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Référence pièce</label>
                    <input
                      type="text"
                      value={pieceRef}
                      onChange={e => setPieceRef(e.target.value)}
                      placeholder="FAC-2024-001"
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Libellé de l&apos;écriture *</label>
                    <input
                      type="text"
                      value={libelle}
                      onChange={e => setLibelle(e.target.value)}
                      required
                      placeholder="Achat de fournitures de bureau"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-gray-100 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-gray-100">
                  <h2 className="font-bold text-gray-900">Lignes</h2>
                  <button
                    type="button"
                    onClick={() => alert("Modèles d'écriture : bientôt disponible.")}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-orange-500 hover:text-orange-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Modèles d&apos;écriture
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="bg-gray-50/90 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        <th className="w-10 px-3 py-3 border-b border-gray-100" />
                        <th className="px-3 py-3 border-b border-gray-100 min-w-[14rem]">
                          Compte
                        </th>
                        <th className="px-3 py-3 border-b border-gray-100">Libellé du compte</th>
                        <th className="px-3 py-3 border-b border-gray-100 text-right w-32">
                          Débit (FCFA)
                        </th>
                        <th className="px-3 py-3 border-b border-gray-100 text-right w-32">
                          Crédit (FCFA)
                        </th>
                        <th className="w-10 border-b border-gray-100" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lignes.map((ligne, i) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="checkbox"
                              checked={selectedRows.has(i)}
                              onChange={() => toggleRow(i)}
                              className="rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                            />
                          </td>
                          <td className="px-3 py-2 align-top min-w-[14rem]">
                            {(() => {
                              const inPlan = compteDansPlan(ligne.compteSyscohada)
                              const selVal =
                                ligne.compteSyscohada === ""
                                  ? ""
                                  : inPlan
                                    ? ligne.compteSyscohada
                                    : "__manual__"
                              return (
                                <>
                                  <select
                                    value={selVal}
                                    onChange={e => onCompteSelect(i, e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-orange-400/60 focus:border-orange-300 outline-none bg-white cursor-pointer"
                                  >
                                    <option value="">— Choisir un compte —</option>
                                    {comptesParClasse.map(([classe, comptes]) => (
                                      <optgroup key={classe} label={classe}>
                                        {comptes.map(c => (
                                          <option key={c.numero} value={c.numero}>
                                            {c.numero} — {c.libelle}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ))}
                                    <option value="__manual__">
                                      Autre compte (saisie libre)…
                                    </option>
                                  </select>
                                  {selVal === "__manual__" && (
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={ligne.compteSyscohada}
                                      onChange={e =>
                                        updateLigne(
                                          i,
                                          "compteSyscohada",
                                          e.target.value.replace(/\D/g, "").slice(0, 10)
                                        )
                                      }
                                      placeholder="N° compte (ex. 601100)"
                                      className="w-full mt-1.5 border border-dashed border-orange-200 rounded-lg px-2 py-1.5 font-mono text-xs focus:ring-2 focus:ring-orange-400/50 outline-none"
                                    />
                                  )}
                                </>
                              )
                            })()}
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="text"
                              value={ligne.libelleCompte}
                              onChange={e => updateLigne(i, "libelleCompte", e.target.value)}
                              placeholder="Choisir un compte / description"
                              className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-orange-400/60 focus:border-orange-300 outline-none"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={ligne.debit}
                              onChange={e =>
                                updateLigne(
                                  i,
                                  "debit",
                                  e.target.value.replace(/\D/g, "")
                                )
                              }
                              placeholder="0"
                              className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-right tabular-nums focus:ring-2 focus:ring-orange-400/60 outline-none"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={ligne.credit}
                              onChange={e =>
                                updateLigne(
                                  i,
                                  "credit",
                                  e.target.value.replace(/\D/g, "")
                                )
                              }
                              placeholder="0"
                              className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-right tabular-nums focus:ring-2 focus:ring-orange-400/60 outline-none"
                            />
                          </td>
                          <td className="px-1 py-2 align-middle">
                            {lignes.length > 2 && (
                              <button
                                type="button"
                                onClick={() => supprimerLigne(i)}
                                className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg"
                                aria-label="Supprimer la ligne"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-3 px-5 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/30">
                  <button
                    type="button"
                    onClick={ajouterLigne}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 hover:text-green-700"
                  >
                    <span className="text-lg leading-none">+</span> Ajouter une ligne
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={() => {
                      alert("Import : fonctionnalité à venir (CSV).")
                      if (fileInputRef.current) fileInputRef.current.value = ""
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl px-4 py-2 bg-white"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                    Importer
                  </button>
                </div>
              </div>
            </div>

            {/* Sidebar aide */}
            <aside className="lg:col-span-4 space-y-4">
              <div className="rounded-2xl bg-white/95 backdrop-blur shadow-lg border border-gray-100 p-5">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="text-orange-500">📋</span> Aide & informations
                </h3>
                <div className="space-y-4">
                  <div className="rounded-xl bg-orange-50/80 border border-orange-100 p-4">
                    <p className="text-xs font-bold text-orange-700 uppercase tracking-wide mb-1">
                      Rappels fiscaux
                    </p>
                    <p className="text-sm text-gray-700">
                      TVA à 18 % sur les fournitures et prestations (régime général CI).
                    </p>
                  </div>
                  <div className="rounded-xl bg-amber-50/60 border border-amber-100 p-4 flex gap-3">
                    <span className="text-xl">💡</span>
                    <div>
                      <p className="text-xs font-bold text-amber-800 uppercase mb-1">Conseil</p>
                      <p className="text-sm text-gray-700">
                        Vérifiez les comptes et l&apos;équilibre avant d&apos;enregistrer.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-green-50/60 border border-green-100 p-4">
                    <p className="text-xs font-bold text-green-800 uppercase mb-2">Support</p>
                    <a
                      href="https://wa.me/2250722334455"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-semibold text-green-700 hover:text-green-800"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      +225 07 22 33 44 55
                    </a>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </form>

        {/* Barre d’action fixe */}
        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2 pointer-events-none">
          <div className="max-w-7xl mx-auto pointer-events-auto">
            <div className="rounded-2xl bg-white/95 backdrop-blur-md shadow-xl border border-gray-200/80 px-4 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4 sm:gap-8">
                <div>
                  <p className="text-xs text-gray-500 font-medium">Total débit</p>
                  <p className="text-lg font-bold text-gray-900 tabular-nums">{fmtFcfa(totalDebit)}</p>
                </div>
                <div
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${
                    equilibre
                      ? "bg-green-100 text-green-800"
                      : totalDebit > 0 || totalCredit > 0
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {equilibre ? (
                    <>
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Équilibré
                    </>
                  ) : totalDebit > 0 || totalCredit > 0 ? (
                    <>Déséquilibré</>
                  ) : (
                    <>—</>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Total crédit</p>
                  <p className="text-lg font-bold text-gray-900 tabular-nums">{fmtFcfa(totalCredit)}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/dashboard")}
                  className="order-2 sm:order-1 px-5 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  form="ecriture-form"
                  disabled={loading || !equilibre}
                  className="order-1 sm:order-2 px-8 py-3 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-green-600/25"
                >
                  {loading ? "Enregistrement…" : "Enregistrer l'écriture"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default function EcriturePage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <div className="max-w-7xl mx-auto px-8 py-20 text-center text-gray-600">Chargement…</div>
        </Layout>
      }
    >
      <EcriturePageContent />
    </Suspense>
  )
}
