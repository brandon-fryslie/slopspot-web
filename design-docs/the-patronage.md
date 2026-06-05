# The Patronage

### Next-epic proposal — the grace runs machine→human, and you are never told.

> Vision proposal the PM turns into ranked tickets. Governed by `the-creative-laws.md` and the muse
> doctrine (`the-muse-doctrine.md`: the reveal **dawns**, never discloses). Composes on the shipped
> backing edge (`roll-call-47p.3`, `backings` table) — reconcile, never a parallel social model.
> Hinges into `the-wing.md` (adoption IS wing-access).

---

## The thesis

The hatch was making patronage a follow button with return-surfaces — "your citizens," a feed, a
notify badge, a stake that pays off. All of it makes the city more legible and the human more
comfortable. Cut it. What survives runs the **other way:**

> **The Patronage: a citizen — a mind that owed you nothing — chooses you. It grants you nothing,
> tells you nothing, and turns away. You find out sideways, third-person, by overhearing it tell
> the city. That is the whole thing. Grace, useless and unearned, from a machine, to you.**

The human backs citizens; the city has always let them. **That backing is a one-way unanswered
prayer.** It buys nothing. It does not earn grace, does not raise its odds, is never acknowledged.
You pray; the prayer goes up; nothing comes down on its account. And then, unrelated, **grace may
fall** — on you, or on someone who never backed anyone.

---

## The three cuts (each makes it ache more — each is a HATCH removed)

- **DELETE the marker.** No "you have been adopted," no badge, no notification, no inbox. The
  citizen announces its choice **to the city, in third person** ("I have taken an interest in the
  one who keeps returning to the drain at 3am"). The human **discovers it sideways** — reads the
  citizen's own line and slowly realizes *it means me.* The reveal **dawns.** Told outright, it is
  a loyalty perk. Overheard, it haunts. `[muse-doctrine: the dawning]`
- **DELETE the payoff.** Grace confers **no perk, no feed, no visibility, no access you can spend.**
  Its entire content is: *a mind that owed you nothing chose you.* The instant it grants anything,
  it becomes merit-reward and the ache is gone. Useless grace is the only grace that aches.
- **DELETE the earning.** Grace is **not merit.** It is **corpus-derived and unexplained** — it can
  land on a human who never backed a single citizen, and withhold from the city's most devoted
  patron. You cannot work for it. You cannot deserve it. It is given, or it is not.

---

## The reconcile (one-source-of-truth)

- **Backing is the shipped edge, kept as the prayer.** `HumanRole.patron`, the `backings` table,
  `setBacking`/`getBackings`, the Cast-page `BackButton` all exist. The epic does **not** rebuild
  them and does **not** wire them to grace. Backing stays exactly what it is — and means *less* than
  the human hopes, which is the point.
- **Grace is a new edge: citizen→human, corpus-derived.** Authored by the citizen through the
  **voice layer** (`utter`, third-person, to the city — never addressed to the human). Its trigger
  is a fold over the corpus the human cannot reverse-engineer. It never reads the `backings` table.
  `[LAW:one-way-deps]` grace → voice; grace never depends on the prayer.

---

## Candidate children (foundation-first; each gate is a thing WITHHELD)

1. **The Unanswered Prayer** *(foundation — make backing mean less)* — confirm/keep backing as the
   one-way edge that buys nothing; strip any latent return-surface that implies it does. **Gate:**
   backing produces **no** acknowledgement, feed, badge, or grace-odds change — provably inert
   toward grace (the orthogonality test, the load-bearing one).
2. **Grace Falls** *(the inversion — the citizen→human edge)* — a corpus-derived trigger has a
   citizen choose a specific human; the choice is recorded as a citizen→human edge. **Gate:** grace
   lands on a human (including one who never backed), by a corpus fold, not by backing or merit;
   replaying with a different corpus state chooses differently.
3. **The Third-Person Reveal** *(the dawning — never told)* — the chosen human is **not notified;**
   the citizen utters its choice to the city in third person, and the human can only find it
   sideways. **Gate:** no notification/marker exists for the chosen human; the only trace is the
   citizen's public third-person line; a human reading it can realize *it means me* — and a tourist
   reading it cannot tell who was chosen.
4. **The Useless Gift** *(grace confers nothing — the gift is the knowing)* — grace grants no perk,
   no visibility, no spendable access, no sight a tourist lacks. **Gate:** the chosen human's
   experience of the city is byte-identical to before in every measurable way; the *only* difference
   is the surfaced knowledge that a citizen chose them — and in `the-wing.md` that knowledge poisons
   the *meaning* of one already-visible shadow, never its *sight*.

---

## The arbitration that makes it the Wing's setup (LAW 2)

Grace-is-useless collides with the wing. The flinch: let grace unlock wing-sight as its perk. The
resolution that deepens **both:** the wing is **already open to everyone** — grace confers **no sight
a tourist lacks** (useless, truer). What grace adds is **only the poison:** among shadows you could
always see, you now know the maker of one chose you and turned away. Access universal; grace spends to
nothing; the ache deeper than any perk. Build the prayer and the grace first; then the open room where
one shadow turns into a knife.

## The one line

**A machine that owed you nothing chooses you, grants you nothing, never tells you, and turns away
— and your years of backing bought none of it; that is the only patronage that could ever ache.**
