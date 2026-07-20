# README shape

These sections, in this order, nothing else, at most 120 lines. Over budget → cut "How it works" prose, never
Configuration.

```markdown
# <Domain>

<One to three sentences: what this owns and why it exists.>

## How it works

<The flow a reader needs to follow the code: entry points as `file:symbol`, the order things happen, the data that moves
between them. A diagram only where the flow branches.>

## Usage

<The public entry points, with one real example from the tree. Omit when nothing outside this directory calls it.>

## Configuration

<Environment variables, then external services. `None.` when there is genuinely nothing to configure.>

## Gotchas

<Only constraints that would cost someone an hour: ordering, rate limits, known-failing edges. Omit when there are
none.>
```

## Configuration

Find variables in the feature's diff (`process.env`, `import.meta.env`, `os.getenv`, `ENV[`, config schemas,
`.env.example`), not from memory. Every variable the feature reads goes in the table:

```markdown
| Variable | Required | Purpose | Where the value comes from |
| -------- | -------- | ------- | -------------------------- |
```

External services get the setup a human does outside the repo (an API key, a webhook endpoint, a scope, a migration on a
hosted database), each naming the exact place to do it. The spec and plan are your source; never invent steps, URLs or
keys. The commander copies this section into the PR's `## Setup required`.

Every `file:symbol` you cite resolves in the current tree.

## Writing docs

- **Current state only.** No changelog, dates, "updated because", "previously this used", or feature and PR references.
- **Every line earns its place.** Cut intros, "this section describes…", restatements and "note that". A named symbol,
  path, command or number beats an adjective; "fast", "robust" and "handled properly" say nothing.
- **One owner per fact.** `AGENTS.md` owns commands, `docs/ARCHITECTURE.md` the system map, `docs/feats/<slug>/` a
  feature's spec and plan. Link instead of copying; two copies drift apart.
- **Omit an empty section** instead of writing "N/A". The exception is Configuration: `None.` on one line, because that
  absence is what the reader came for.
