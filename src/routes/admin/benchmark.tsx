import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getBenchmarkMeta } from '#/lib/admin-server'
import { BenchmarkConsole } from '#/components/admin/benchmark/BenchmarkConsole'
import { BenchmarkSkeleton } from '#/components/admin/AdminSkeletons'

async function loadBenchmarkMeta() {
  return { benchmarkMeta: await getBenchmarkMeta() }
}

export const Route = createFileRoute('/admin/benchmark')({
  loader: loadBenchmarkMeta,
  // Skeleton while the loader resolves (#231); SSR-hydrated first paint is
  // untouched, this only shows on client tab switches + slow reads.
  pendingComponent: BenchmarkSkeleton,
  component: BenchmarkTab,
})

function BenchmarkTab() {
  const loaderData = Route.useLoaderData()
  // Cache the benchmark meta under the shared QueryClient (#230), seeded from
  // the loader so first paint stays SSR and tab revisits are instant.
  const { data } = useQuery({
    queryKey: ['admin', 'benchmark', 'meta'],
    queryFn: loadBenchmarkMeta,
    initialData: loaderData,
  })
  return <BenchmarkConsole meta={data.benchmarkMeta} />
}
