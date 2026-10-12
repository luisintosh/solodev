## Writing docs

- **Current state only.** No changelog, dates, "updated because", "previously this used", or feature and PR references.
- **Every line earns its place.** Cut intros, "this section describes…", restatements and "note that". A named symbol,
  path, command or number beats an adjective; "fast", "robust" and "handled properly" say nothing.
- **One owner per fact.** `AGENTS.md` owns commands, `docs/ARCHITECTURE.md` the system map, `docs/feats/<slug>/` a
  feature's spec and plan. Link instead of copying; two copies drift apart.
- **Omit an empty section** instead of writing "N/A". The exception is Configuration: `None.` on one line, because that
  absence is what the reader came for.
