import AdminShell from '../../../admin-shell'
export default async function Page({ params }: { params: Promise<{ runtimeId: string }> }) { return <AdminShell segments={['models', 'runtimes', (await params).runtimeId]} /> }
