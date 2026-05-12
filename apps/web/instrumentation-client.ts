import { env } from "@crikket/env/web"
import { initPostHog } from "@crikket/shared/lib/posthog"

initPostHog({
  key: env.NEXT_PUBLIC_POSTHOG_KEY,
  host: env.NEXT_PUBLIC_POSTHOG_HOST,
})
