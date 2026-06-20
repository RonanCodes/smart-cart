import { createFileRoute } from '@tanstack/react-router'
import { getBenchmarkMeta } from '#/lib/admin-server'
import { BenchmarkConsole } from '#/components/admin/benchmark/BenchmarkConsole'

export const Route = createFileRoute('/admin/benchmark')({
  loader: async () => ({ benchmarkMeta: await getBenchmarkMeta() }),
  component: BenchmarkTab,
})

function BenchmarkTab() {
  const { benchmarkMeta } = Route.useLoaderData()
  return <BenchmarkConsole meta={benchmarkMeta} />
}
