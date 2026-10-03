import AdminShell from './admin-shell'

/** Enterprise administration only; user onboarding lives in the user portal. */
export default function Page() {
  return <AdminShell segments={[]} />
}
