"use client"

import { authClient } from "@crikket/auth/client"
import { env } from "@crikket/env/web"
import { Icons } from "@crikket/ui/components/icons"
import { Loader } from "@crikket/ui/components/loader"
import { Button } from "@crikket/ui/components/ui/button"
import { useRouter } from "nextjs-toploader/app"
import { parseAsString, useQueryState } from "nuqs"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AuthShell } from "@/components/auth/auth-shell"
import { getAuthErrorMessage } from "@/lib/auth"

export function SignInForm() {
  const router = useRouter()
  const [callbackUrlQuery] = useQueryState(
    "callbackURL",
    parseAsString.withDefault(env.NEXT_PUBLIC_APP_URL)
  )
  const { data: session, isPending } = authClient.useSession()
  const [isSocialSignInPending, setIsSocialSignInPending] = useState(false)

  const callbackURL = useMemo(() => {
    try {
      const appUrl = new URL(env.NEXT_PUBLIC_APP_URL)
      const parsed = new URL(callbackUrlQuery, appUrl)

      if (parsed.origin !== appUrl.origin) {
        return env.NEXT_PUBLIC_APP_URL
      }

      return parsed.toString()
    } catch {
      return env.NEXT_PUBLIC_APP_URL
    }
  }, [callbackUrlQuery])

  useEffect(() => {
    if (session) {
      router.replace("/")
    }
  }, [router, session])

  const handleGoogleSignIn = async () => {
    setIsSocialSignInPending(true)

    const result = await authClient.signIn
      .social({
        provider: "google",
        callbackURL,
      })
      .catch(() => null)

    if (!result) {
      toast.error("Unable to reach the auth server. Please try again.")
      setIsSocialSignInPending(false)
      return
    }

    if (result.error) {
      toast.error(getAuthErrorMessage(result.error))
    }

    setIsSocialSignInPending(false)
  }

  if (isPending) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader />
      </div>
    )
  }

  if (session) {
    return null
  }

  return (
    <AuthShell
      description="Sign in with your Google account to continue"
      title="Welcome back"
    >
      <Button
        className="h-12 w-full font-semibold text-base shadow-sm transition-all hover:bg-muted/50 hover:shadow-md active:scale-[0.98]"
        disabled={isSocialSignInPending}
        onClick={handleGoogleSignIn}
        type="button"
        variant="outline"
      >
        <Icons.google className="mr-3 h-5 w-5" />
        Continue with Google
      </Button>
    </AuthShell>
  )
}
