import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { listAdminRecipes } from '#/lib/admin-recipes-server'
import { RecipesPanel } from '#/components/admin/RecipesPanel'

async function loadRecipes() {
  return { recipes: await listAdminRecipes() }
}

export const Route = createFileRoute('/admin/recipes')({
  loader: loadRecipes,
  component: RecipesTab,
})

function RecipesTab() {
  const loaderData = Route.useLoaderData()
  // Cache the recipe list under the shared QueryClient so flicking back to this
  // tab is instant. The loader's server-rendered result seeds the cache, so
  // first paint stays SSR (the Users/Waitlist tab pattern).
  const { data } = useQuery({
    queryKey: ['admin', 'recipes'],
    queryFn: loadRecipes,
    initialData: loaderData,
  })
  return <RecipesPanel recipes={data.recipes} />
}
