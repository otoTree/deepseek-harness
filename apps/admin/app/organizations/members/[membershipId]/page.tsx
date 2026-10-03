import AdminShell from '../../../admin-shell'
export default async function Page({ params }: { params: Promise<{ membershipId: string }> }) { return <AdminShell segments={['organizations', 'members', (await params).membershipId]} /> }
