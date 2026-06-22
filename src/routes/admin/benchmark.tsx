import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getBenchmarkMeta } from '#/lib/admin-server'
import { showBenchmark } from '#/lib/admin-dev-only'
import { BenchmarkConsole } from '#/components/admin/benchmark/BenchmarkConsole'
import { BenchmarkSkeleton } from '#/components/admin/AdminSkeletons'

async function loadBenchmarkMeta() {
  return { benchmarkMeta: await getBenchmarkMeta() }
}

export const Route = createFileRoute('/admin/benchmark')({
  // Dev-only (#460): the benchmark / algorithm-testing console no longer makes
  // sense after the matching rework AND only runs on localhost, so a deployed
  // visitor who deep-links /admin/benchmark is bounced back to /admin. The nav
  // link is hidden in route.tsx; this guard closes the direct-URL path too.
  beforeLoad: () => {
    if (!showBenchmark(import.meta.env.DEV)) {
      throw redirect({ to: '/admin' })
    }
  },
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
