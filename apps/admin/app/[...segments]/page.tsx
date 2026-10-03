import AdminShell from '../admin-shell'

/** Resolve every shareable administration URL through the domain shell. */
export default async function Page({ params }: { params: Promise<{ segments: string[] }> }) {
  return <AdminShell segments={(await params).segments} />
}
