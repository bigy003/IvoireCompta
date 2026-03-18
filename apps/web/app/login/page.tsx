"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import Cookies from "js-cookie"
import { login } from "@/lib/api"
import { AuthFloatingHeader } from "@/components/auth-floating-header"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [registeredOk, setRegisteredOk] = useState(false)

  useEffect(() => {
    const registered = searchParams.get("registered")
    const emailParam = searchParams.get("email")
    if (emailParam) {
      try {
        setEmail(decodeURIComponent(emailParam))
      } catch {
        setEmail(emailParam)
      }
    }
    if (registered === "1") {
      setRegisteredOk(true)
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await login(email, password)
      Cookies.set("token", res.data.token, { expires: 1 })
      Cookies.set("user", JSON.stringify(res.data.utilisateur), { expires: 1 })
      router.push("/dashboard")
    } catch {
      setError("Email ou mot de passe incorrect")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col"
      style={{
        backgroundImage: "url('/images/Background.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <AuthFloatingHeader logoHref="/" />

      <div className="flex flex-1 flex-col items-center justify-center px-4 pt-24 pb-8">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Connectez-vous à IvoireCompta
            </h1>
            <p className="text-gray-500 text-sm">
              Bienvenue, veuillez vous connecter à votre compte
            </p>
          </div>

          {registeredOk && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 mb-5 text-sm">
              <p className="font-semibold">Compte créé avec succès</p>
              <p className="mt-1 text-emerald-700">
                Vous pouvez vous connecter — saisissez votre mot de passe ci-dessous.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Adresse Email
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="exemple@mail.com"
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Mot de Passe
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-20 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-500 hover:text-gray-700 font-medium"
                >
                  {showPassword ? "Masquer" : "Afficher"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button type="button" className="text-sm text-orange-500 hover:text-orange-600 font-medium">
                Mot de passe oublié ?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
            >
              {loading ? "Connexion..." : "Se Connecter"}
            </button>

            <p className="text-center text-sm text-gray-500">
              Pas encore de compte ?{" "}
              <Link
                href="/inscription"
                className="text-orange-500 hover:text-orange-600 font-medium"
              >
                Inscrivez-vous
              </Link>
            </p>
          </form>
        </div>
      </div>

      <div className="text-center py-4 text-xs text-gray-400">
        © 2024 IvoireCompta. Tous droits réservés. |{" "}
        <span className="hover:text-gray-600 cursor-pointer">Sécurité</span> |{" "}
        <span className="hover:text-gray-600 cursor-pointer">Vie Privée.</span>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 text-gray-600 text-sm">
          Chargement…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
