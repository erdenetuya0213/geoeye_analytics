# Analytics engine boundary (Phase 0)

Desktop ⇄ Python engine wiring. Prerequisite for variography, KNA, simulation.

```
React page ─ callEngine(method, params) ─► preload engineCall ─► ipc geoeye:engine:call
   ─► electron/analytics-engine.cjs (one warm `python -m geoeye_analytics serve`)
   ─► JSON line {id,method,params} ─► geoeye_analytics/server.py ─► {id,result|error}
```

- **Transport**: JSON lines over stdio. Replace with Arrow IPC when payloads exceed ~50 MB (variogram pair tables, block models).
- **Allow-list**: `ALLOWED_METHODS` in `analytics-engine.cjs`; `build_handlers()` in `server.py`. Add both when adding a method.
- **Python resolution** (`resolveLaunch`): `GEOEYE_PYTHON` env → `resources/engine/{Scripts|bin}/python` (packaged) → repo `analytics-engine/src` with `PYTHONPATH` (dev) → `python` on PATH.
- **Licensing**: `engine:call` goes through `licensedHandle`; `engine:status` does not.
- **Renderer**: `src/analysis/engineClient.ts` (typed `EngineMethods`), Settings → Engine shows status + provider table.

## Dev setup
```
cd analytics-engine && pip install -e .[all]     # or python -m venv .venv first
set GEOEYE_PYTHON=C:\path\to\.venv\Scripts\python.exe   # optional; dev fallback uses PATH python
```

## Tests
- `analytics-engine`: `pytest` (tests/test_server.py)
- desktop: `GEOEYE_TEST_PYTHON=<python> node --test tests/analytics-engine.node.cjs` (live round-trip skipped if unset)

## Packaging TODO
- `electron/after-pack.cjs`: copy an embedded Python runtime with the engine wheel into `resources/engine/` (python-build-standalone + `pip install geoeye-analytics-engine[all]`).
