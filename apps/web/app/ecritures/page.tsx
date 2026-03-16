"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import { getClients, creerEcriture, api } from "@/lib/api"

interface Ligne {
  compteSyscohada: string
  libelleCompte: string
  debit: string
  credit: string
}

interface Client { id: string; nomRaisonSociale: string }
interface Exercice { id: string; annee: number }
interface Journal { id: string; code: string; libelle: string }

export default function EcriturePage() {
  const router = useRouter()
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
  ])
  const [erreurs, setErreurs] = useState<string[]>([])
  const [avertissements, setAvertissements] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [succes, setSucces] = useState("")

  const totalDebit = lignes.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCredit = lignes.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const equilibre = totalDebit === totalCredit && totalDebit > 0

  useEffect(() => {
    if (!Cookies.get("token")) { router.push("/login"); return }
    getClients().then(r => setClients(r.data.clients))
  }, [router])

  async function onClientChange(id: string) {
    setClientId(id)
    setExerciceId("")
    setJournalCode("")
    setExercices([])
    setJournaux([])
    if (!id) return
    const r = await api.get(`/clients/${id}`)
    const dossiers = r.data.client.dossiers ?? []
    if (dossiers.length > 0) {
      const exs = await api.get(`/exercices?dossierId=${dossiers[0].id}`)
      setExercices(exs.data.exercices ?? [])
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

  function ajouterLigne() {
    setLignes([...lignes, { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" }])
  }

  function supprimerLigne(index: number) {
    if (lignes.length <= 2) return
    setLignes(lignes.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErreurs([])
    setAvertissements([])
    setSucces("")
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
            debit: parseInt(l.debit) || 0,
            credit: parseInt(l.credit) || 0,
          })),
      }
      const r = await creerEcriture(payload)
      setSucces(`Ecriture validee avec succes`)
      setAvertissements(r.data.avertissements ?? [])
      setLignes([
        { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
        { compteSyscohada: "", libelleCompte: "", debit: "", credit: "" },
      ])
      setLibelle("")
      setPieceRef("")
    } catch (err: any) {
      const data = err.response?.data
      if (data?.erreurs) setErreurs(data.erreurs)
      else setErreurs([data?.error ?? "Erreur inattendue"])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/dashboard")} className="text-slate-400 hover:text-slate-600 text-sm">
              Tableau de bord
            </button>
            <span className="text-slate-300">|</span>
            <span className="font-semibold text-slate-800">Nouvelle ecriture</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">

          {succes && (
            <div className="bg-teal-50 border border-teal-200 text-teal-800 rounded-lg px-4 py-3 text-sm">{succes}</div>
          )}

          {erreurs.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {erreurs.map((e, i) => <div key={i} className="text-red-700 text-sm">{e}</div>)}
            </div>
          )}

          {avertissements.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              {avertissements.map((a, i) => <div key={i} className="text-amber-700 text-sm">{a}</div>)}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-800 mb-4">Informations generales</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
                <select value={clientId} onChange={e => onClientChange(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Selectionner...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.nomRaisonSociale}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Exercice</label>
                <select value={exerciceId} onChange={e => onExerciceChange(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Selectionner...</option>
                  {exercices.map(ex => <option key={ex.id} value={ex.id}>{ex.annee}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Journal</label>
                <select value={journalCode} onChange={e => setJournalCode(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Selectionner...</option>
                  {journaux.map(j => <option key={j.id} value={j.code}>{j.code} - {j.libelle}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date operation</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Libelle</label>
                <input type="text" value={libelle} onChange={e => setLibelle(e.target.value)} required
                  placeholder="Ex: Achat fournitures bureau"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">N piece</label>
                <input type="text" value={pieceRef} onChange={e => setPieceRef(e.target.value)}
                  placeholder="Ex: FACT-2025-001"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-800 mb-4">Lignes ecriture</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-3 py-2 text-slate-600 font-medium w-32">Compte</th>
                  <th className="text-left px-3 py-2 text-slate-600 font-medium">Libelle</th>
                  <th className="text-right px-3 py-2 text-slate-600 font-medium w-36">Debit (FCFA)</th>
                  <th className="text-right px-3 py-2 text-slate-600 font-medium w-36">Credit (FCFA)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lignes.map((ligne, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input type="text" value={ligne.compteSyscohada}
                        onChange={e => updateLigne(i, "compteSyscohada", e.target.value)}
                        placeholder="601100"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-teal-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" value={ligne.libelleCompte}
                        onChange={e => updateLigne(i, "libelleCompte", e.target.value)}
                        placeholder="Libelle du compte"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={ligne.debit}
                        onChange={e => updateLigne(i, "debit", e.target.value)}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal-500" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={ligne.credit}
                        onChange={e => updateLigne(i, "credit", e.target.value)}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal-500" />
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => supprimerLigne(i)}
                        className="text-slate-300 hover:text-red-400 text-lg">x</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200">
                  <td colSpan={2} className="px-3 py-3 text-sm font-medium text-slate-600">Total</td>
                  <td className="px-3 py-3 text-right font-bold text-teal-700">{totalDebit.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-bold text-purple-700">{totalCredit.toLocaleString()}</td>
                  <td></td>
                </tr>
                {totalDebit > 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2">
                      <span className={`text-xs font-medium px-3 py-1 rounded-full ${equilibre ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-700"}`}>
                        {equilibre ? "Ecriture equilibree" : "Ecriture desequilibree"}
                      </span>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
            <button type="button" onClick={ajouterLigne}
              className="mt-3 text-sm text-teal-600 hover:text-teal-800 font-medium">
              + Ajouter une ligne
            </button>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => router.push("/dashboard")}
              className="px-6 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              Annuler
            </button>
            <button type="submit" disabled={loading || !equilibre}
              className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm">
              {loading ? "Validation..." : "Valider"}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}