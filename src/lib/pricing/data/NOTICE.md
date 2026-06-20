# Vendored data notice

`supermarkets.json` in this directory is a **trimmed snapshot** of the price data
published by [supermarkt/checkjebon](https://github.com/supermarkt/checkjebon)
(file: `data/supermarkets.json`). checkjebon is MIT-licensed and the README states
the price data "may be reused in other projects".

## What was trimmed and why

The upstream file is ~10 MB (about 107k products across 12 stores). Committing it
wholesale would bloat the repo and slow every test run. This vendored copy keeps:

- All stores present upstream (so store coverage is faithful), and
- A representative subset of each store's products filtered to common grocery
  keywords (pasta, melk, kaas, kip, groente, etc.), capped per store.

Refresh the full file (or re-trim) with `pnpm tsx scripts/sync-checkjebon.ts`.

## Licence and ToS caveat

checkjebon is MIT (Copyright (c) 2022 supermarkt). The MIT notice is reproduced
below as required. The licence covers checkjebon's own snapshot; it cannot grant
rights over the underlying supermarket data, which is scraped from stores whose
own terms of service prohibit bulk extraction, and which may carry an EU database
(sui generis) right. Reusing this MIT-licensed snapshot is one step removed from
scraping and is acceptable **pre-revenue for a demo**. Before any commercial NL
launch, get a real legal read and move price lookups to an official / licensed
source (see SupermarktConnector as the documented upgrade path in
`docs/research/checkjebon-price-data/README.md`).

---

## Upstream MIT License

```
MIT License

Copyright (c) 2022 supermarkt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
