import { Inter, Nunito } from "next/font/google"
import "./inscription.css"

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-nunito",
})
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
})

export default function InscriptionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className={`${nunito.variable} ${inter.variable}`}>{children}</div>
}
