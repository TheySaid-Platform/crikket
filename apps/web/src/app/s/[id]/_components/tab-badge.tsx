export function TabBadge({ label }: { label: string }) {
  return (
    <span className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
      {label}
    </span>
  )
}
