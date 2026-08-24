let meta = #{
    name: "port-dice-physics",
    description: "Port 3d-dice rest-read, keep-pose, UV-baked numerals, and silent-sim replay into Rollerator",
    when_to_use: "When porting 3d-dice physics-result behavior into dnd-sim without a post-roll face snap",
    phases: [
        #{ title: "Explore", detail: "map the current roll pipeline" },
        #{ title: "Implement", detail: "world-up after sleep, keep pose, UV net, silent sim replay" },
        #{ title: "Verify", detail: "tests and a consistency check" },
    ],
};

let repo = "/Users/camhome/dnd-sim";

fn text_of(slot) {
    if slot == () { return ""; }
    if !slot.success { return ""; }
    if type_of(slot.output) == "string" { return slot.output; }
    if slot.output.notes != () { return slot.output.notes; }
    return json_encode(slot.output);
}

phase("Explore");
log("Mapping the current Rollerator roll and face pipeline");

let explore_prompt = "You are exploring /Users/camhome/dnd-sim. Use read_file and grep only. Do not edit files.";
explore_prompt += " Read dice3d.js (prepareFaces, faceTangentBasis, projectFaceUVs, captureLanded, finishLanding, beginHold, beginPresent, stepRoll, roll, simulateUntilRest).";
explore_prompt += " Read physics-roll.js and physics-roll.test.js and app.js submit handler.";
explore_prompt += " Report: (1) when the rolled value is decided today, (2) whether finishLanding/present still slerps or swaps a face after physics sleep,";
explore_prompt += " (3) how d20 face values and UVs are assigned (sequential f+1 vs net), (4) what is half-finished or broken (e.g. captureLanded sets flatP/holdQ/presentQ but rollState or beginAlign may be missing).";
explore_prompt += " Be concrete with function names and line-level behavior. This is for the next implementer.";

let explored = agent(explore_prompt, #{
    label: "explore-roll-pipeline",
    capability_mode: "read-only",
});
if explored == () || !explored.success {
    complete(#{ ok: false, reason: "explore failed" });
}

phase("Implement");
log("Porting the four 3d-dice behaviors into physics-roll.js and dice3d.js");

let brief = text_of(explored);

let impl_prompt = "Implement four 3d-dice behaviors in /Users/camhome/dnd-sim. Workspace is the live repo. Use read_file, grep, search_replace, and run_terminal_command. Do not deploy. Do not commit unless tests pass.";
impl_prompt += " Prior exploration notes (may be incomplete; verify against the files):\n";
impl_prompt += brief;
impl_prompt += "\n\nFEATURE 1 — Read result only after Cannon sleep, from world-up.";
impl_prompt += " The result face is upwardFaceIndex(normals, quat, [0,1,0]) AFTER isSleepy (or FLIGHT_MAX). Never pick the number before the throw. app.js must await dice.roll() and log Hort AFTER that promise resolves with the landed value.";
impl_prompt += " Keep landedValue() in physics-roll.js covered by tests.";

impl_prompt += "\n\nFEATURE 2 — Keep the physics pose; do not swap faces after settle.";
impl_prompt += " After sleep, freeze the mesh to the Cannon body quaternion. Do not slerp to a camera-facing restQuaternionForFace. Do not swap material groups on the live mesh as the default path.";
impl_prompt += " Present/hold may dolly the camera and slide the die to center, but quaternion stays the physics rest pose. Heat/highlight the world-up face only.";
impl_prompt += " finishLanding must not copy holdQ if holdQ is a camera-aim pose. Remove any beginAlign that retargets a different face. If captureLanded currently writes presentQ as camera-facing, stop using it to overwrite the quat.";

impl_prompt += "\n\nFEATURE 3 — Bake numeral rotation into UVs (Bruno Van de Casteele d20 net), not a post-roll tween.";
impl_prompt += " Today prepareFaces assigns d20 values as f+1 and texUp from world-Y projected on the face.";
impl_prompt += " Change d20 (and similarly other polyhedra where cheap) so:";
impl_prompt += " (a) opposite faces sum to sides+1 (d20: 21; 1 opposite 20, 2 opposite 19, ...).";
impl_prompt += " (b) UV tex-up is rotated so the glyph sits like a physical die, not a random world-Y project.";
impl_prompt += " For d20, use a constant face UV yaw in the spirit of 3d-dice DiceFactory (d20 about -7.5 deg) AND prefer a per-face up derived from a triangle median/vertex so numbers are not sideways on the pentagon view.";
impl_prompt += " Bruno net neighbors of 20 include 11, 14, 7; 1 is opposite 20. Map Three.IcosahedronGeometry faces by pairing opposite normals (dot ~ -1) to (n, 21-n). Put 20 on a +Y-ish pole if one exists, else the face most aligned with +Y. Then assign remaining values so opposites hold. Do not tween orientation after the roll to 'fix' numbers.";
impl_prompt += " Keep d6 mapping [2,5,3,4,1,6] which already does opposites=7 unless you have a better BoxGeometry mapping.";

impl_prompt += "\n\nFEATURE 4 — Silent sim + replay for an optional forced result that still looks physical (Teall / 3d-dice swapDiceFace).";
impl_prompt += " Default roll() has no forced value: physics decides.";
impl_prompt += " Add optional roll({ force: n }) or rollForced(n) used by reduced-motion and tests:";
impl_prompt += " (1) applyThrow, (2) world.step in a loop with no render until sleepy (reuse simulateUntilRest), (3) read world-up value,";
impl_prompt += " (4) if force is set and differs from landed, swap the material/groups (or values+materials) of the landed face and the forced face so the physical rest pose now displays the forced number,";
impl_prompt += " (5) reset body to the original throw pose/velocities (store them), (6) play the flight visually. Result reported is the forced number; the die still physically lands on the same pose.";
impl_prompt += " Swap must happen BEFORE the visible replay, never as a post-settle snap. Clone geometry groups like 3d-dice if needed; swapping userData.values plus remaking those two face materials is acceptable if groups stay 1:1 with faces.";
impl_prompt += " Reduced motion: silent sim only (no replay), then sitOnTable with physics quat; if force omitted, report the world-up value.";

impl_prompt += "\n\nAlso finish any half-wired captureLanded/flatP/rollState fields so the file runs (no ReferenceError). Cache-bust index.html and local import query strings together (one new ?v=).";
impl_prompt += " TDD: add/update tests in physics-roll.test.js for landedValue world-up and any new helpers (opposite pairing, swap mapping). Run: node --test physics-roll.test.js roll-engine.test.js";
impl_prompt += " Do not deploy to rollerator.com. Keep vanilla ES modules, Three r170, cannon-es.";

let implemented = agent(impl_prompt, #{
    label: "implement-four-behaviors",
    capability_mode: "all",
});
if implemented == () || !implemented.success {
    complete(#{ ok: false, reason: "implement failed", explore: brief });
}

phase("Verify");
log("Running tests and checking the four invariants");

let verify_prompt = "Verify the 3d-dice port in /Users/camhome/dnd-sim. Use read_file, grep, and run_terminal_command. You may make small fixes if tests fail.";
verify_prompt += " Confirm all four: (1) value is only read after sleep via world-up, (2) default path never slerps/swaps the live quat to a different face after settle,";
verify_prompt += " (3) d20 UVs/values are baked (opposites sum 21; not f+1 sequential), (4) silent sim + optional force swap exists and runs BEFORE visible replay.";
verify_prompt += " Run node --test physics-roll.test.js roll-engine.test.js. Cache-bust strings on index.html, app.js, dice3d.js must match.";
verify_prompt += " If something is missing, fix it. Return a short report of files changed and what still is not done (net neighbor layout can be approximate if opposites and UV yaw are real).";

let verified = agent(verify_prompt, #{
    label: "verify-port",
    capability_mode: "all",
});

let ok = verified != () && verified.success;
let report = "explore:\n" + brief + "\n\nimplement:\n" + text_of(implemented) + "\n\nverify:\n" + text_of(verified);
let path = write_scratch_file("port-report.md", report);
complete(#{
    ok: ok,
    path: path,
    summary: "Ported 3d-dice rest-read, keep-pose, UV-baked numerals, silent-sim replay",
});
