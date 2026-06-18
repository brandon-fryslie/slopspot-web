// [LAW:single-enforcer][LAW:one-source-of-truth] Whether the Wishing Well is reachable
// by users. ONE switch — the masthead nav link, the page loader, and the /api/well action
// all read it — so the Well can never be HALF reachable (a 404 page with a live API, or a
// dead link to a working route). [LAW:dataflow-not-control-flow] one value, every seam.
//
// GATED OFF (CD directive, 2026-06-18). The Well shipped as scaffolding that handed back a
// LITERAL render of the visitor's wish — the un-haunted "vending machine" that argues
// SlopSpot's ANTI-thesis ("AI just does what you tell it"). A literal-echo AI feature is
// worth NEGATIVE, not zero: better NO back door than a back door that makes the city look
// like a vending machine. The three structural inversions are already in the code
// (api.well.ts: Origin = the seated CITIZEN, no human provider/knob, no rewrite disclosed);
// what was absent is the BEHAVIORAL haunting — prod ran the pre-#215 weak muse directive
// ("transmute, not obedient") and Haiku obeyed. Structure perfect + soul absent = still dead.
//
// UNLOCK CRITERION — do NOT flip this on a vibe; flip it when the bar below is MET and VERIFIED.
// All three inversions live AND the haunting verified to objectify-not-echo on a real wish.
//   THE CD'S ONE-LINE TEST: if you can read the wish back off the output, the haunting FAILED.
//   - FAIL: "fox in a library" -> a competent fox in a library (the wish rendered obediently;
//     the citizen was a butler).
//   - PASS: the wish survives only as a SEED / RELIC glimpsed inside a scene the citizen chose
//     to make — a being with taste received the intrusion and answered in its own art (it may
//     answer in a different medium entirely). You CANNOT reconstruct the visitor's prompt from
//     the result.
//   VERIFY by running several deliberately-literal wishes (e.g. a fox in a library, a sunset,
//   a cat) through the DEPLOYED composer (PR #215's OBJECTIFY-THE-INTRUSION directive) and
//   capturing the ACTUAL artifacts (the media + what the citizen authored).
//
//   THE JUDGMENT IS THE CD'S, NEVER SELF-CERTIFIED. objectify-vs-echo is a TASTE call, and a
//   well-meaning "good enough" from an engineer's eye is exactly how an echo sneaks through the
//   gate. Whoever would flip this MUST surface the real outputs to the CD and let the CD make
//   the call. CD confirms the haunting took -> set this true. CD says it still echoes -> the
//   directive escalates back to the CD for a stronger spell; the gate stays shut.
//   Tracked under slopspot-well-foundation-3aj.
export const WELL_REACHABLE = false
