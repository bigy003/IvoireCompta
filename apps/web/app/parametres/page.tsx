"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { getMe, totpSetup, totpConfirmer } from "@/lib/api"

type MeResponse = {
  utilisateur: {
    id: string
    prenom: string
    nom: string
    email: string
    role: string
    numeroOrdre: string | null
    specialisation: string | null
    totpActif: boolean
    dernierAcces: string | null
  }
  cabinet: {
    id: string
    nom: string
    numeroOrdre: string
    rccm: string | null
    ncc: string | null
    secteurActivite: string | null
    adresse: string | null
    telephone: string | null
    email: string
    regimeFiscal: string
    planComptable: string
  }
}

const ROLE_LABEL: Record<string, string> = {
  EXPERT_COMPTABLE: "Expert-comptable",
  COLLABORATEUR: "Collaborateur",
  STAGIAIRE: "Stagiaire",
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return "—"
  }
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value?.trim() || "—"
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-3 border-b border-gray-100 last:border-0">
      <dt className="text-sm font-medium text-gray-500 sm:w-44 shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900 break-words">{v}</dd>
    </div>
  )
}

export default function ParametresPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [data, setData] = useState<MeResponse | null>(null)
  const [loadErr, setLoadErr] = useState("")
  const [totpStep, setTotpStep] = useState<"idle" | "scan" | "done">("idle")
  const [otpAuthUrl, setOtpAuthUrl] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [totpErr, setTotpErr] = useState("")
  const [totpOk, setTotpOk] = useState("")
  const [totpLoading, setTotpLoading] = useState(false)

  async function refresh() {
    try {
      const r = await getMe()
      setData(r.data)
      const u = r.data.utilisateur
      Cookies.set(
        "user",
        JSON.stringify({
          prenom: u.prenom,
          nom: u.nom,
          email: u.email,
          role: u.role,
          totpActif: u.totpActif,
        }),
        { sameSite: "lax", path: "/" }
      )
    } catch {
      setLoadErr("Impossible de charger votre profil.")
    }
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
    void refresh()
  }, [router])

  async function onStartTotp() {
    setTotpErr("")
    setTotpOk("")
    setTotpLoading(true)
    try {
      const r = await totpSetup()
      setOtpAuthUrl(r.data.otpAuthUrl as string)
      setTotpStep("scan")
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setTotpErr(typeof msg === "string" ? msg : "Action impossible.")
    } finally {
      setTotpLoading(false)
    }
  }

  async function onConfirmTotp(e: React.FormEvent) {
    e.preventDefault()
    setTotpErr("")
    setTotpOk("")
    setTotpLoading(true)
    try {
      await totpConfirmer(totpCode.replace(/\s/g, ""))
      setTotpOk("Authentification à deux facteurs activée.")
      setTotpStep("done")
      setTotpCode("")
      await refresh()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setTotpErr(typeof msg === "string" ? msg : "Code incorrect.")
    } finally {
      setTotpLoading(false)
    }
  }

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-600">Chargement…</div>
      </Layout>
    )
  }

  const u = data?.utilisateur
  const c = data?.cabinet
  const isExpert = u?.role === "EXPERT_COMPTABLE"
  const qrSrc = otpAuthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpAuthUrl)}`
    : ""

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-6 py-8 pb-20">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
          <p className="text-sm text-gray-500 mt-1">Votre compte et les informations du cabinet</p>
        </div>

        {loadErr && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{loadErr}</div>
        )}

        {data && (
          <div className="space-y-8">
            {/* Mon compte */}
            <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-orange-50/50">
                <h2 className="text-lg font-semibold text-gray-900">Mon compte</h2>
                <p className="text-xs text-gray-500 mt-0.5">Informations de connexion (lecture seule)</p>
              </div>
              <dl className="px-6 py-2">
                <Row label="Prénom" value={u.prenom} />
                <Row label="Nom" value={u.nom} />
                <Row label="E-mail" value={u.email} />
                <Row label="Rôle" value={ROLE_LABEL[u.role] ?? u.role} />
                <Row label="N° d'ordre ONECCA" value={u.numeroOrdre} />
                <Row label="Spécialisation" value={u.specialisation} />
                <Row label="Dernière connexion" value={fmtDate(u.dernierAcces)} />
              </dl>
              <div className="px-6 py-4 bg-gray-50/80 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Modification du profil ou du mot de passe : <strong>bientôt disponible</strong>.
                </p>
              </div>
            </section>

            {/* Cabinet */}
            <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-orange-50/50">
                <h2 className="text-lg font-semibold text-gray-900">Mon cabinet</h2>
                <p className="text-xs text-gray-500 mt-0.5">Données du tenant (lecture seule)</p>
              </div>
              <dl className="px-6 py-2">
                <Row label="Raison sociale" value={c.nom} />
                <Row label="N° d'ordre ONECCA" value={c.numeroOrdre} />
                <Row label="E-mail cabinet" value={c.email} />
                <Row label="Téléphone" value={c.telephone} />
                <Row label="Adresse" value={c.adresse} />
                <Row label="RCCM" value={c.rccm} />
                <Row label="NCC (NIF)" value={c.ncc} />
                <Row label="Secteur d'activité" value={c.secteurActivite} />
                <Row label="Régime fiscal" value={c.regimeFiscal} />
                <Row label="Plan comptable" value={c.planComptable} />
              </dl>
            </section>

            {/* Sécurité / 2FA */}
            <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-orange-50/50">
                <h2 className="text-lg font-semibold text-gray-900">Sécurité</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Double authentification pour le visa électronique DSF (ONECCA)
                </p>
              </div>
              <div className="px-6 py-5">
                {!isExpert && (
                  <p className="text-sm text-gray-600">
                    La configuration du 2FA est réservée aux <strong>experts-comptables</strong> (visa DSF).
                  </p>
                )}
                {isExpert && u.totpActif && totpStep !== "scan" && (
                  <div className="flex items-start gap-3">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      2FA activé
                    </span>
                    <p className="text-sm text-gray-600 flex-1">
                      Votre application d’authentification est liée. Un code sera demandé lors du visa sur une DSF.
                    </p>
                  </div>
                )}
                {isExpert && !u.totpActif && totpStep === "idle" && (
                  <div>
                    <p className="text-sm text-gray-600 mb-4">
                      Activez l’authentification à deux facteurs (TOTP) pour sécuriser le visa électronique des
                      déclarations.
                    </p>
                    <button
                      type="button"
                      disabled={totpLoading}
                      onClick={onStartTotp}
                      className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                    >
                      {totpLoading ? "…" : "Configurer le 2FA"}
                    </button>
                  </div>
                )}
                {isExpert && totpStep === "scan" && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      Scannez ce QR code avec <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong>{" "}
                      ou équivalent, puis saisissez le code à 6 chiffres.
                    </p>
                    {qrSrc && (
                      <img src={qrSrc} alt="QR code 2FA" className="rounded-xl border border-gray-200 p-2 bg-white" />
                    )}
                    <form onSubmit={onConfirmTotp} className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Code TOTP</label>
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={8}
                          className="rounded-xl border border-gray-200 px-3 py-2 text-sm w-36 tracking-widest"
                          placeholder="000000"
                          value={totpCode}
                          onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={totpLoading || totpCode.length < 6}
                        className="px-5 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                      >
                        Confirmer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTotpStep("idle")
                          setTotpCode("")
                          setTotpErr("")
                        }}
                        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                      >
                        Annuler
                      </button>
                    </form>
                    {totpErr && <p className="text-sm text-red-600">{totpErr}</p>}
                  </div>
                )}
                {totpOk && <p className="text-sm text-emerald-700 font-medium">{totpOk}</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </Layout>
  )
}
