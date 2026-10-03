import AdminShell from '../../admin-shell'
export default async function Page({ params }: { params: Promise<{ accountId: string }> }) { return <AdminShell segments={['accounts', (await params).accountId]} /> }
