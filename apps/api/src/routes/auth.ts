/**
 * IvoireCompta — Route /auth
 * Login JWT + 2FA TOTP pour visa expert-comptable
 */

import { FastifyInstance } from "fastify"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { authenticator } from "otplib"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  totp:     z.string().length(6).optional(), // Requis pour visa expert
})

export async function authRoutes(app: FastifyInstance) {

  /**
   * POST /auth/login
   * Authentification standard (email + mot de passe)
   * Le 2FA TOTP est vérifié séparément pour le visa DSF
   */
  app.post("/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "Données invalides" })
    }
    const { email, password } = parsed.data

    const utilisateur = await prisma.utilisateur.findFirst({
      where: { email, actif: true },
      include: { cabinet: { select: { id: true, nom: true, numeroOrdre: true } } },
    })

    if (!utilisateur || !(await bcrypt.compare(password, utilisateur.passwordHash))) {
      return reply.status(401).send({ error: "Email ou mot de passe incorrect" })
    }

    // Mise à jour dernier accès
    await prisma.utilisateur.update({
      where: { id: utilisateur.id },
      data: { dernierAcces: new Date() },
    })

    const token = app.jwt.sign({
      id:        utilisateur.id,
      cabinetId: utilisateur.cabinetId,
      role:      utilisateur.role,
      nom:       `${utilisateur.prenom} ${utilisateur.nom}`,
    })

    return reply.send({
      token,
      utilisateur: {
        id:           utilisateur.id,
        nom:          utilisateur.nom,
        prenom:       utilisateur.prenom,
        email:        utilisateur.email,
        role:         utilisateur.role,
        totpActif:    utilisateur.totpActif,
        cabinet:      utilisateur.cabinet,
      },
    })
  })

  /**
   * POST /auth/visa/verifier
   * Vérifie le code TOTP avant d'apposer un visa sur une DSF
   * Endpoint séparé — action critique avec traçabilité
   */
  app.post("/visa/verifier", async (request, reply) => {
    const user = request.user as { id: string; role: string; cabinetId: string }

    if (user.role !== "EXPERT_COMPTABLE") {
      return reply.status(403).send({
        error: "Seul un expert-comptable inscrit à l'ONECCA-CI peut viser une DSF"
      })
    }

    const { totpCode } = request.body as { totpCode: string }

    const utilisateur = await prisma.utilisateur.findUnique({
      where: { id: user.id },
    })

    if (!utilisateur?.totpActif || !utilisateur.totpSecret) {
      return reply.status(400).send({
        error: "L'authentification à deux facteurs n'est pas configurée. Activez-la dans vos paramètres de compte."
      })
    }

    const isValid = authenticator.verify({
      token:  totpCode,
      secret: utilisateur.totpSecret,
    })

    if (!isValid) {
      await prisma.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId:    user.id,
          action:    "VISA_TOTP_ECHEC",
          entite:    "utilisateurs",
          entiteId:  user.id,
        },
      })
      return reply.status(401).send({ error: "Code d'authentification incorrect ou expiré" })
    }

    // Token de visa à courte durée (15 minutes)
    const visaToken = app.jwt.sign(
      { id: user.id, cabinetId: user.cabinetId, scope: "VISA_DSF" },
      { expiresIn: "15m" }
    )

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId:    user.id,
        action:    "VISA_TOTP_VALIDE",
        entite:    "utilisateurs",
        entiteId:  user.id,
      },
    })

    return reply.send({ visaToken, expiresIn: 900 })
  })

  /**
   * POST /auth/totp/setup
   * Configure le 2FA pour un expert-comptable
   */
  app.post("/totp/setup", async (request, reply) => {
    const user = request.user as { id: string; role: string }

    if (user.role !== "EXPERT_COMPTABLE") {
      return reply.status(403).send({ error: "Réservé aux experts-comptables" })
    }

    const secret = authenticator.generateSecret()
    const utilisateur = await prisma.utilisateur.findUnique({ where: { id: user.id } })

    const otpAuthUrl = authenticator.keyuri(
      utilisateur?.email ?? "",
      "IvoireCompta",
      secret
    )

    // Stocker temporairement (avant confirmation)
    await prisma.utilisateur.update({
      where: { id: user.id },
      data:  { totpSecret: secret, totpActif: false },
    })

    return reply.send({ secret, otpAuthUrl })
  })

  /**
   * POST /auth/totp/confirmer
   * Confirme la configuration 2FA avec un premier code valide
   */
  app.post("/totp/confirmer", async (request, reply) => {
    const user = request.user as { id: string }
    const { totpCode } = request.body as { totpCode: string }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id: user.id } })
    if (!utilisateur?.totpSecret) {
      return reply.status(400).send({ error: "Configurez d'abord le 2FA via /auth/totp/setup" })
    }

    const isValid = authenticator.verify({ token: totpCode, secret: utilisateur.totpSecret })
    if (!isValid) {
      return reply.status(401).send({ error: "Code incorrect — réessayez" })
    }

    await prisma.utilisateur.update({
      where: { id: user.id },
      data:  { totpActif: true },
    })

    return reply.send({ message: "Authentification à deux facteurs activée avec succès" })
  })
}
