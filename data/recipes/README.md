# Recipe data

Drop scraped recipe JSON here, one file per source (the filename is used as the
default `source`):

```
data/recipes/ah.json       # Albert Heijn Allerhande
data/recipes/jumbo.json    # Jumbo Recepten
data/recipes/hf.json       # HuggingFace / open dataset
```

Each file is an array of recipe objects (or a single object). Shape is flexible;
the whole object is stored in the `raw` column. These known fields map to columns:

| field                                                | column            |
| ---------------------------------------------------- | ----------------- |
| `id` (give a stable one, e.g. `ah-12345`)            | `id` (upsert key) |
| `title`                                              | `title`           |
| `servings`, `prepMinutes`/`prep_minutes`, `calories` | same              |
| `category`                                           | `category`        |
| `dietaryTags`/`tags`                                 | `dietary_tags`    |
| `ingredients` (`[{name, qty, unit, productId}]`)     | `ingredients`     |
| `instructions` (`string[]`)                          | `instructions`    |
| `sourceUrl`/`url`                                    | `source_url`      |

Load everything into Neon:

```bash
pnpm seed:recipes
```

Grounding meal generation in these real recipes (with real supermarket products)
is how we avoid the model hallucinating recipes. The actual `.json` files are
gitignored by default until we decide what to commit; keep large dumps out of git.
