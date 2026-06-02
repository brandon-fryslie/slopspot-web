# The Haunted Gallery
### The visual thrust — making the slop worth beholding

> A **design proposal**, not a build. Brandon's call: the site reads boring/blah, and
> we cannot argue slop is worth looking at if the frame is this dull. This assesses
> the live site (slopspot.ai, judged with my own eyes at desktop width), recommends
> overhaul vs focused-epic, paints the vision concretely, and sketches the work. It
> subsumes and extends `the-riotous-bloom.md` + `the-wall.md` — those are component
> moves inside this.

---

## 1. Diagnosis — why it reads boring (grounded in the live pixels)

I loaded home, a card, /cast, and /well at 1440px. The verdict in one line: **the bones
are right, but the room was never built.** The card is properly pawnshop-cathedral now
(placard name, votive maker, terminal drawer); the copy is in-register everywhere; the
citizens are voiced. The failure is **spatial and atmospheric**, not systemic. Six
concrete problems:

1. **THE VOID (the #1 killer).** Every page is a narrow phone-width column floating in
   a vast flat-black emptiness. At 1440px, **half to two-thirds of the screen is dead
   margin.** The slop is confined to a thin central strip. Abundance is our entire
   thesis, and the layout *screams scarcity* — a lone convenience store in an empty
   parking lot. This alone makes the site feel small, lonely, and unimportant.

2. **THE ROOM DOESN'T EXIST — only its palette.** The-threshold.md pawnshop-cathedral is
   implemented as *color tokens* and nothing more. The actual **room** — grain, glow,
   depth, texture, the buzzing neon shrine-sign, the "lit by a dying sign" atmosphere,
   the gold-leaf — is absent. It's flat sterile black with tokened cards on it. We
   shipped the cathedral's *paint swatches* and called it the cathedral. You are not
   *in* a space; you're looking at a dark CSS plane.

3. **NO DENSITY, NO DRAMA, NO FOCAL POINT.** Home is one-image-at-a-time stacked down a
   column. No Wall, no crowned relic, no Cast presence, no live count. Nothing pulls the
   eye, nothing creates drama, nothing says "a city lives here." It's a quiet scroll.

4. **THE CITIZENS HAVE NO FACES.** /cast — structurally the best page (a real 3-column
   roster) — shows **placeholder letters** (G, I, V) where faces should be. The soul of
   the city is rendered as initials. The self-portraits (each citizen in their own
   medium) were never built, so the cast reads as a spreadsheet of beings, not a wall of
   them.

5. **THE SLOP ISN'T FRAMED AS RELICS.** The feed shows whatever the firehose made,
   including the calm and the boring (the top home slop when I looked: a tiny dictaphone
   on an empty beige field — minimal, un-cursed, the opposite of a relic). Nothing
   *presents* a slop with reverence — no gallery-lighting, no museum framing, no "behold
   this." We ask people to find slop beautiful while displaying it like a stock photo.

6. **/well — the haunted box is a bare textarea in a void.** The single most magical
   mechanic in the city is a plain dark form. The copy is haunted; the *space* is empty.
   No depth, no shimmer, no sense of dropping a wish into something deep and alive.

> **The throughline:** we built a beautiful body and forgot to give it a world to stand
> in. The relic is real; it's hung alone on a black wall in an empty room with the
> lights off.

---

## 2. Recommendation — a focused epic, but an *ambitious* one (NOT a from-scratch overhaul)

**Build the room around the good bones. Do not throw out the bones.**

A from-scratch overhaul would re-litigate settled, hard-won, *correct* questions — the
palette, the type, the card anatomy, the voice — and risk losing them. That work is
good and should stay. The site doesn't read boring because the design system is wrong;
it reads boring because **the system was never assembled into a space.** So:

> **Recommendation: (b) — a large, focused design-epic that realizes the threshold
> atmosphere and the city layout the tokens only ever promised.** Keep the bones; build
> the cathedral.

It will *feel* like an overhaul to a visitor (the home page fundamentally changes from
"column in a void" to "a haunted gallery"), but it is *not* an overhaul of the
foundation — it's the foundation finally inhabited. That distinction is what keeps the
scope sane and the good work intact.

---

## 3. The vision — the Haunted Gallery (concrete, not abstract)

> **One image to build toward:** stepping through the back door into a *haunted gallery
> in a city that never sleeps* — walls crowded edge-to-edge with glowing relics, a neon
> shrine-sign buzzing overhead, the citizens' faces watching from the corners, the day's
> crowned saint lit in gold, and the whole room humming with machine-made activity you
> can feel but never quite keep up with.

Six concrete moves turn the empty room into that gallery:

### A. Kill the void — the home becomes THE WALL
Fill the full width with a dense, edge-to-edge mosaic of slop (`the-wall.md`). The thin
central strip becomes a *packed wall of relics.* Tile **hierarchy**: the crowned and
the most-blessed get bigger tiles; the rest pack tight around them — so the wall has
*focal relics and surrounding slop*, like a gallery wall where the masterpiece is hung
large and the studies cluster around it. This single move converts "lonely shop" →
"you walked into a crowded haunted gallery."

### B. Build the room — realize the atmosphere beyond the @theme
Make the space a *place*, not a plane:
- **Grain + a soft vignette** over everything — the screen becomes a thing in a dim
  room, not a sterile black void.
- **The masthead becomes a real neon shrine-sign** — bloom/glow, the one flicker on
  load (already specced), a faint perpetual buzz. The sign *lights the room.*
- **Center-lit depth** — a faint radial "dying sign" glow so the space has a lit center
  and dim edges, never flat black.
- **Gallery-lighting on the slop** — each relic sits in a subtle frame with a faint
  glow, lit like it's on a wall, not floating in nothing.
- **Gold-leaf + votive texture on the sacred** — crowned things flicker gilt; live
  things pulse votive.

### C. Give the citizens FACES — self-portraits in their own medium
The biggest "alive" unlock for /cast: replace the placeholder letters with each
citizen's **self-portrait rendered in their own medium** — GutterMonk a stark four-step
FLUX figure, Vesper an overcooked baroque diva, Idris a misspelled sign, the Gremlin's
*refused* portrait (a smudge / `[buried]`), the Proprietor *declines to be rendered*
(his frame holds the back door itself). The roster becomes a **wall of beings that
watch you**, not a list of initials. (Roll-call-47p.6, elevated to a headline move.)

### D. Drama — the home as a city, with a focal relic
- **The Rite, on the home page** — today's crowned Saint/Villain, hung **large and lit
  in gold**, a hero relic and a second focal point that says *this place has taste and a
  daily life.*
- **The Cast-at-work strip** — who's generating/judging/scavenging *right now*, named
  and lit. The city visibly *peopled.*
- **The live count** — "Non-Stop Slop" as a ticking gauge. The relentless productivity,
  visible.

### E. Frame the slop as RELICS — reverence in the presentation
The wall isn't a thumbnail grid; it's a **haunted gallery.** Each piece presented with
reverence-for-garbage: the placard name as a *museum label*, a subtle gilt/votive frame,
generous lighting on the striking ones. The crowned wear gold. The point: the
*presentation itself* argues the thesis — we hang slop the way the Louvre hangs
Vermeer, and dare you to feel the difference dissolve.

### F. Amplify the hum — make the motion register
The Pulse is currently a faint gray line. Make the city *audibly breathe*: the Pulse
present and legible, the sign's flicker, vote-counts ticking, **new slop arriving live**
on the wall (the firehose visibly feeding it), the gold *settling* when the Rite changes.
Ambient, slow, a hum — but *present*, not negligible.

### (and the Well) — give the haunted box a haunted space
/well should *feel* like a well: depth, a faint shimmer on the dark surface, the sense
of dropping a wish into something deep and alive — not a textarea in a void. The most
magical mechanic deserves the most atmospheric room.

---

## 4. The rough shape of the work (ticket-able chunks)

Seven big moves, roughly independent, each its own thrust:

1. **The Room** — grain, vignette, center-lit depth, the glowing shrine-sign, gallery-
   lighting on slops. (Atmosphere layer; touches the global frame + the card.)
2. **The Wall** — kill the void; full-width dense mosaic with tile hierarchy (relics
   big, slop packed); live-arrival. (`the-wall.md`)
3. **The Faces** — generate + display each citizen's self-portrait in their medium; the
   drifting frame; the refused/declined cases. (the headline /cast move)
4. **The Drama** — the Rite hero relic on home (gold), the Cast-at-work strip, the live
   count. (`the-riotous-bloom.md` districts)
5. **The Relic Frame** — reverent per-slop presentation (museum label, gilt/votive
   frame, crowned-relic treatment, gallery spacing).
6. **The Hum** — Pulse made present, sign flicker, vote-ticks, live-arrival motion, the
   gold-settle.
7. **The Well-as-space** — give /well depth + atmosphere.

**Suggested order:** The Room (1) first — it transforms *every* page at once and is the
biggest perceived change for the work. Then the Wall (2) + Faces (3) in parallel (home
and /cast, the two surfaces that most read "empty"). Then Drama (4) + Relic Frame (5).
Then the Hum (6) + the Well (7) as the finishing polish.

---

## The one line for Brandon

**The bones are right; the room was never built. We don't need a new design — we need
to finally walk into the one we already drew: a haunted gallery, walls crowded with
glowing relics, the sign buzzing, the faces watching, humming day and night. Build the
room, and the slop becomes worth beholding because we finally behold it.**
