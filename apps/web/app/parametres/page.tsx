"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { changePassword, getMe, patchMe, totpConfirmer, totpSetup } from "@/lib/api"

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
    createdAt?: string
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
  CLIENT_VIEWER: "Lecture client",
}

const SPEC_CHOICES = [
  "Audit & Commissariat aux comptes",
  "Expertise comptable",
  "Conseil et fiscalité",
  "Comptabilité et reporting",
  "Social et paie",
] as const

const SPEC_AUTRE = "__autre__"

type NavKey = "compte" | "securite" | "cabinet"

function fmtDateTime(iso: string | null) {
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

function fmtDateOnly(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  } catch {
    return "—"
  }
}

function isToday(iso: string | null) {
  if (!iso) return false
  try {
    const d = new Date(iso)
    const t = new Date()
    return (
      d.getFullYear() === t.getFullYear() &&
      d.getMonth() === t.getMonth() &&
      d.getDate() === t.getDate()
    )
  } catch {
    return false
  }
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value?.trim() || "—"
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 py-2.5 border-b border-gray-100 last:border-0">
      <dt className="text-xs font-medium text-gray-500 sm:w-40 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-900 break-words flex-1">{v}</dd>
    </div>
  )
}

function EyeButton({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
      aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
    >
      {visible ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
          />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
      )}
    </button>
  )
}

export default function ParametresPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [data, setData] = useState<MeResponse | null>(null)
  const [loadErr, setLoadErr] = useState("")
  const [nav, setNav] = useState<NavKey>("compte")

  const [prenom, setPrenom] = useState("")
  const [nom, setNom] = useState("")
  const [email, setEmail] = useState("")
  const [specSelect, setSpecSelect] = useState<string>(SPEC_CHOICES[0])
  const [specAutre, setSpecAutre] = useState("")
  const [numeroOrdre, setNumeroOrdre] = useState("")

  const [profileBaseline, setProfileBaseline] = useState<string>("")
  const [profileDirty, setProfileDirty] = useState(false)
  const [profileOk, setProfileOk] = useState("")
  const [profileErr, setProfileErr] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)

  const [pwdCurrent, setPwdCurrent] = useState("")
  const [pwdNew, setPwdNew] = useState("")
  const [pwdConfirm, setPwdConfirm] = useState("")
  const [showPwd1, setShowPwd1] = useState(false)
  const [showPwd2, setShowPwd2] = useState(false)
  const [showPwd3, setShowPwd3] = useState(false)
  const [pwdOk, setPwdOk] = useState("")
  const [pwdErr, setPwdErr] = useState("")
  const [savingPwd, setSavingPwd] = useState(false)

  const [totpStep, setTotpStep] = useState<"idle" | "scan" | "done">("idle")
  const [otpAuthUrl, setOtpAuthUrl] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [totpErr, setTotpErr] = useState("")
  const [totpOk, setTotpOk] = useState("")
  const [totpLoading, setTotpLoading] = useState(false)

  const profileSnapshot = useMemo(
    () =>
      JSON.stringify({
        prenom: prenom.trim(),
        nom: nom.trim(),
        email: email.trim().toLowerCase(),
        specSelect,
        specAutre: specAutre.trim(),
        numeroOrdre: numeroOrdre.trim(),
      }),
    [prenom, nom, email, specSelect, specAutre, numeroOrdre]
  )

  useEffect(() => {
    setProfileDirty(profileSnapshot !== profileBaseline)
  }, [profileSnapshot, profileBaseline])

  function applyUserToForm(u: MeResponse["utilisateur"]) {
    setPrenom(u.prenom)
    setNom(u.nom)
    setEmail(u.email)
    const s = u.specialisation?.trim() || ""
    if (s && !SPEC_CHOICES.includes(s as (typeof SPEC_CHOICES)[number])) {
      setSpecSelect(SPEC_AUTRE)
      setSpecAutre(s)
    } else if (s) {
      setSpecSelect(s)
      setSpecAutre("")
    } else {
      setSpecSelect(SPEC_CHOICES[0])
      setSpecAutre("")
    }
    setNumeroOrdre(u.numeroOrdre?.trim() ?? "")
  }

  async function refresh() {
    try {
      const r = await getMe()
      const payload = r.data as MeResponse
      setData(payload)
      const u = payload.utilisateur
      applyUserToForm(u)
      const specVal =
        u.specialisation?.trim() &&
        !SPEC_CHOICES.includes(u.specialisation.trim() as (typeof SPEC_CHOICES)[number])
          ? SPEC_AUTRE
          : u.specialisation?.trim() || SPEC_CHOICES[0]
      const specOther =
        specVal === SPEC_AUTRE ? (u.specialisation?.trim() ?? "") : ""
      setProfileBaseline(
        JSON.stringify({
          prenom: u.prenom.trim(),
          nom: u.nom.trim(),
          email: u.email.trim().toLowerCase(),
          specSelect: specVal,
          specAutre: specOther,
          numeroOrdre: (u.numeroOrdre ?? "").trim(),
        })
      )
      setProfileDirty(false)
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

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileErr("")
    setProfileOk("")
    setSavingProfile(true)
    try {
      const specFinal =
        specSelect === SPEC_AUTRE ? (specAutre.trim() || null) : specSelect.trim() || null
      const isExpert = data?.utilisateur.role === "EXPERT_COMPTABLE"
      const payload: Parameters<typeof patchMe>[0] = {
        prenom: prenom.trim(),
        nom: nom.trim(),
        email: email.trim().toLowerCase(),
        specialisation: specFinal,
        ...(isExpert ? { numeroOrdre: numeroOrdre.trim() || null } : {}),
      }
      const r = await patchMe(payload)
      const next = r.data as MeResponse
      setData(next)
      applyUserToForm(next.utilisateur)
      const u = next.utilisateur
      const specVal =
        u.specialisation?.trim() &&
        !SPEC_CHOICES.includes(u.specialisation.trim() as (typeof SPEC_CHOICES)[number])
          ? SPEC_AUTRE
          : u.specialisation?.trim() || SPEC_CHOICES[0]
      const specOther =
        specVal === SPEC_AUTRE ? (u.specialisation?.trim() ?? "") : ""
      setProfileBaseline(
        JSON.stringify({
          prenom: u.prenom.trim(),
          nom: u.nom.trim(),
          email: u.email.trim().toLowerCase(),
          specSelect: specVal,
          specAutre: specOther,
          numeroOrdre: (u.numeroOrdre ?? "").trim(),
        })
      )
      setProfileDirty(false)
      setProfileOk("Profil enregistré.")
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
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setProfileErr(typeof msg === "string" ? msg : "Enregistrement impossible.")
    } finally {
      setSavingProfile(false)
    }
  }

  async function onSavePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwdErr("")
    setPwdOk("")
    if (pwdNew !== pwdConfirm) {
      setPwdErr("La confirmation ne correspond pas au nouveau mot de passe.")
      return
    }
    setSavingPwd(true)
    try {
      await changePassword(pwdCurrent, pwdNew)
      setPwdOk("Mot de passe mis à jour.")
      setPwdCurrent("")
      setPwdNew("")
      setPwdConfirm("")
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setPwdErr(typeof msg === "string" ? msg : "Impossible de mettre à jour le mot de passe.")
    } finally {
      setSavingPwd(false)
    }
  }

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
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-600">Chargement…</div>
      </Layout>
    )
  }

  const u = data?.utilisateur
  const c = data?.cabinet
  const isExpert = u?.role === "EXPERT_COMPTABLE"
  const qrSrc = otpAuthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpAuthUrl)}`
    : ""

  const navBtn = (key: NavKey, title: string, sub: string) => (
    <button
      type="button"
      onClick={() => setNav(key)}
      aria-current={nav === key ? "page" : undefined}
      className={`w-full text-left rounded-[10px] px-4 py-3 transition-colors border ${
        nav === key
          ? "bg-[#FFF5EB] border-orange-200/90 text-[#7c2d12]"
          : "border-transparent hover:bg-gray-50 text-gray-700"
      }`}
    >
      <div className={`text-sm font-semibold ${nav === key ? "text-[#7c2d12]" : "text-gray-800"}`}>{title}</div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
    </button>
  )

  const inputClass =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/80 focus:border-orange-300 bg-white"

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-20">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
          <p className="text-sm text-gray-500 mt-1">Votre compte et les informations du cabinet</p>
        </div>

        <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50/90 px-4 py-3 flex gap-3 items-start">
          <span className="text-orange-600 shrink-0 mt-0.5" aria-hidden>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <p className="text-sm text-orange-900">
            Gérez vos informations personnelles, sécurisez votre compte et consultez les informations de votre
            cabinet.
          </p>
        </div>

        {loadErr && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{loadErr}</div>
        )}

        {data && u && c && (
          <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
            {/* Sidebar */}
            <aside className="lg:w-56 shrink-0 space-y-2 lg:sticky lg:top-24">
              <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-2 space-y-1">
                {navBtn("compte", "Mon compte", "Profil et informations personnelles")}
                {navBtn("securite", "Sécurité", "Mot de passe et authentification")}
                {navBtn("cabinet", "Mon cabinet", "Informations du cabinet (lecture)")}
              </div>
              <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-4">
                <div className="flex gap-2 items-start">
                  <span className="text-blue-500 shrink-0">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Besoin d&apos;aide ?</div>
                    <p className="text-xs text-gray-600 mt-1">Contactez le support ou l&apos;administrateur de votre cabinet.</p>
                    <a
                      href="mailto:support@ivoirecompta.ci"
                      className="text-xs font-medium text-orange-600 hover:text-orange-700 mt-2 inline-block"
                    >
                      support@ivoirecompta.ci
                    </a>
                  </div>
                </div>
              </div>
            </aside>

            <div className="flex-1 min-w-0 min-h-[320px]">
              {nav === "compte" && (
                <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-2 bg-orange-50/40">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Mon compte</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Vos informations personnelles</p>
                    </div>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        profileDirty ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {profileDirty ? "Modifications non enregistrées" : "À jour"}
                    </span>
                  </div>
                  <form onSubmit={onSaveProfile} className="px-5 py-5 space-y-4">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Prénom</label>
                        <input className={inputClass} value={prenom} onChange={e => setPrenom(e.target.value)} required />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                        <input className={inputClass} value={nom} onChange={e => setNom(e.target.value)} required />
                      </div>
                      <div className="sm:col-span-2 lg:col-span-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
                        <input
                          type="email"
                          className={inputClass}
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                          autoComplete="email"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Rôle</label>
                        <select className={`${inputClass} text-gray-600`} disabled value={u.role}>
                          <option value={u.role}>{ROLE_LABEL[u.role] ?? u.role}</option>
                        </select>
                        <p className="text-[11px] text-gray-400 mt-1">Le rôle est défini par l&apos;administrateur du cabinet.</p>
                      </div>
                      {isExpert && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">N° d&apos;ordre ONECCA</label>
                          <input
                            className={inputClass}
                            value={numeroOrdre}
                            onChange={e => setNumeroOrdre(e.target.value)}
                            placeholder="Ex. EC-012345"
                          />
                        </div>
                      )}
                      <div className={isExpert ? "" : "sm:col-span-2"}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Spécialisation</label>
                        <select
                          className={`${inputClass} mb-2`}
                          value={specSelect}
                          onChange={e => setSpecSelect(e.target.value)}
                        >
                          {SPEC_CHOICES.map(s => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                          <option value={SPEC_AUTRE}>Autre (préciser)</option>
                        </select>
                        {specSelect === SPEC_AUTRE && (
                          <input
                            className={inputClass}
                            value={specAutre}
                            onChange={e => setSpecAutre(e.target.value)}
                            placeholder="Précisez votre spécialisation"
                          />
                        )}
                      </div>
                    </div>
                    {profileErr && <p className="text-sm text-red-600">{profileErr}</p>}
                    {profileOk && <p className="text-sm text-emerald-700 font-medium">{profileOk}</p>}
                    <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-gray-100">
                      <button
                        type="submit"
                        disabled={savingProfile || !profileDirty}
                        className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                      >
                        {savingProfile ? "Enregistrement…" : "Enregistrer le profil"}
                      </button>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          Dernière connexion :{" "}
                          {isToday(u.dernierAcces)
                            ? `Aujourd'hui à ${new Date(u.dernierAcces!).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                            : fmtDateTime(u.dernierAcces)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
                          Session active
                        </span>
                        <span>Membre depuis : {fmtDateOnly(u.createdAt ?? null)}</span>
                      </div>
                    </div>
                  </form>
                </section>
              )}

              {nav === "securite" && (
                <div className="space-y-6">
                <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Changer de mot de passe</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Sécurisez votre compte en utilisant un mot de passe fort
                      </p>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                      Bonnes pratiques
                    </span>
                  </div>
                  <form onSubmit={onSavePassword} className="px-5 py-5 space-y-4">
                    <div className="space-y-3 max-w-md">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Mot de passe actuel</label>
                        <div className="relative">
                          <input
                            type={showPwd1 ? "text" : "password"}
                            className={`${inputClass} pr-10`}
                            value={pwdCurrent}
                            onChange={e => setPwdCurrent(e.target.value)}
                            autoComplete="current-password"
                          />
                          <EyeButton visible={showPwd1} onToggle={() => setShowPwd1(v => !v)} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Nouveau mot de passe</label>
                        <div className="relative">
                          <input
                            type={showPwd2 ? "text" : "password"}
                            className={`${inputClass} pr-10`}
                            value={pwdNew}
                            onChange={e => setPwdNew(e.target.value)}
                            autoComplete="new-password"
                            minLength={8}
                          />
                          <EyeButton visible={showPwd2} onToggle={() => setShowPwd2(v => !v)} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Confirmer le mot de passe</label>
                        <div className="relative">
                          <input
                            type={showPwd3 ? "text" : "password"}
                            className={`${inputClass} pr-10`}
                            value={pwdConfirm}
                            onChange={e => setPwdConfirm(e.target.value)}
                            autoComplete="new-password"
                            minLength={8}
                          />
                          <EyeButton visible={showPwd3} onToggle={() => setShowPwd3(v => !v)} />
                        </div>
                      </div>
                    </div>
                    {pwdErr && <p className="text-sm text-red-600">{pwdErr}</p>}
                    {pwdOk && <p className="text-sm text-emerald-700 font-medium">{pwdOk}</p>}
                    <button
                      type="submit"
                      disabled={savingPwd || pwdCurrent.length === 0 || pwdNew.length < 8}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                      Mettre à jour le mot de passe
                    </button>
                  </form>
                </section>

                <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-2 bg-orange-50/40">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Sécurité</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Double authentification (2FA)</p>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">
                      Recommandé
                    </span>
                  </div>
                  <div className="px-5 py-5">
                    {!isExpert && (
                      <p className="text-sm text-gray-600">
                        La configuration du 2FA est réservée aux <strong>experts-comptables</strong> (visa DSF).
                      </p>
                    )}
                    {isExpert && u.totpActif && totpStep !== "scan" && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
                          <span className="font-semibold">2FA activée.</span> Un code sera demandé lors du visa sur une
                          DSF.
                        </div>
                      </div>
                    )}
                    {isExpert && !u.totpActif && totpStep === "idle" && (
                      <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                          Renforcez la sécurité du visa électronique : activez l&apos;authentification à deux facteurs
                          (TOTP) avec une application du type Google Authenticator ou Microsoft Authenticator.
                        </p>
                        <div className="rounded-lg border border-amber-100 bg-amber-50/80 px-4 py-2 text-sm text-amber-900">
                          2FA non configurée
                        </div>
                        <button
                          type="button"
                          disabled={totpLoading}
                          onClick={onStartTotp}
                          className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                        >
                          {totpLoading ? "…" : "Activer le 2FA"}
                        </button>
                      </div>
                    )}
                    {isExpert && totpStep === "scan" && (
                      <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                          Scannez ce QR code avec <strong>Google Authenticator</strong>,{" "}
                          <strong>Microsoft Authenticator</strong> ou équivalent, puis saisissez le code à 6 chiffres.
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

              {nav === "cabinet" && (
                <section className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 bg-orange-50/40">
                    <h2 className="text-lg font-semibold text-gray-900">Mon cabinet</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Informations de votre cabinet (lecture seule)</p>
                  </div>
                  <dl className="px-5 py-3">
                    <Row label="Raison sociale" value={c.nom} />
                    <Row label="N° d'ordre ONECCA" value={c.numeroOrdre} />
                    <Row label="E-mail" value={c.email} />
                    <Row label="Téléphone" value={c.telephone} />
                    <Row label="Adresse" value={c.adresse} />
                    <Row label="RCCM" value={c.rccm} />
                    <Row label="NIF (NCC)" value={c.ncc} />
                    <Row label="Secteur d'activité" value={c.secteurActivite} />
                    <Row label="Régime fiscal" value={c.regimeFiscal} />
                    <Row label="Plan comptable" value={c.planComptable} />
                  </dl>
                  <div className="px-5 py-4 bg-blue-50/60 border-t border-blue-100/80">
                    <p className="text-xs text-blue-900">
                      Ces informations sont gérées au niveau du cabinet. Pour toute modification, contactez le support ou
                      l&apos;administrateur.
                    </p>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
