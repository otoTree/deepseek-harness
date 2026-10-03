import AdminShell from '../../../../admin-shell'
export default async function Page({ params }: { params: Promise<{ providerId: string }> }) { return <AdminShell segments={['identity', 'providers', (await params).providerId, 'mapping']} /> }
