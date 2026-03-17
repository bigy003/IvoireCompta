"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setLoading(false)
  }, [router])

  if (loading) return (
    <Layout>
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-400 text-sm">Chargement...</div>
      </div>
    </Layout>
  )

  return (
    <Layout>
      <div
        className="min-h-screen"
        style={{
          backgroundImage: "url('/images/Background.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-gray-900">Tableau de Bord</h1>
        </div>
      </div>
    </Layout>
  )
}
