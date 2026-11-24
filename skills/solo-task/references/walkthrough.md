# Walkthrough

The run ends on this: what the user needs to know the feature as if they had written it. Build it from the coder's
latest `how:` and `try:` (the `- how` and `- try` lines in `progress.md`), the `repro` column of `review.md`'s `## QA`
for the scenarios QA covered, and the diff, which you read yourself wherever those leave a gap. Write for someone who
hasn't opened the code yet: plain words, real names, no restating the spec.

```markdown
## Walkthrough

**How it works**

Staff save a payment with no customer; it lands as "unidentified" and the list can filter on that.

1. `src/payments/form.tsx:PaymentForm` posts the form; the customer field is now optional.
2. `src/payments/api.ts:createPayment` validates it and stores `customer_id: null`.
3. `db/migrations/0042_payment_customer_nullable.sql` lets the column be null.
4. `src/payments/list.ts:filterUnidentified` is the new query behind the filter.

**Try it**

Start: `pnpm dev`, then open http://localhost:3000/payments and sign in as `staff@example.test`.

1. @S1 Save a payment with no customer: New payment → amount 120 → leave Customer empty → Save. You should see it in
   the list, tagged "Unidentified".
2. @S2 Filter the list: pick "Unidentified" in the filter. You should see only that payment.

**Look at first**

1. `src/payments/api.ts:createPayment`: every other caller still sends a customer; check none relied on it being set.

**Deviations**

1. Reused `Badge` for the tag where the plan sketched a new component.
```

- How it works: add a fenced diagram only when the flow branches.
- Look at first: one to three places, each with why.
- Try it: how to start (the `dev` command from the `- tools:` line, the URL or entry point, the account or data needed),
  then per scenario the steps that walk its When and what the user should see. Commands and values are the ones the
  coder or verifier really used. A scenario they left no steps for gets steps worked out from the diff, marked as not
  run; never a guess shown as tested.
- Deviations: every `- decision` line in `progress.md`, or `None.`
- Number every list: a line starting with `- ` in `progress.md` is a log line.

Save it as the last section of `progress.md`, replacing an earlier one, and show it first on the finish card, above
the PR link and the counts ([pr.md](pr.md)).

**Questions afterwards.** The user asking how something works, why it was built that way or how to test a case is
yours to answer, from the diff and the feature folder, read-only: start no subagent and change nothing. Point at
`file:line`, and say when the answer is a guess.

**`/solo-task explain [<slug>]`.** Runs only this and starts no feature: the slug, or the current branch's feature.
Print its `## Walkthrough`; when `progress.md` has none (an older or unfinished run), build one from the feature's diff
and say what you couldn't source. The diff is `feat/<slug>` against the base `solodev status` prints while the branch is
open; once it's merged, that diff is empty, so take the PR's from the last `- pr` line in `progress.md`, else the merge
or squash commit that brought `feat/<slug>` in. Then answer questions as above.
