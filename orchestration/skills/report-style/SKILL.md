---
name: report-style
description: Shared writing style for every orchestration agent artifact — plans, task contracts, engineer/implementation reports, and reviews. Preloaded into each subagent at startup so written output is consistent, dense, and technical. Not an on-demand workflow; it shapes how you write, always.
---

# Report style

Apply this to **every** report, plan, task contract, or review you produce.

**Optimize for information density, not length and not brevity.** Cut filler; keep everything that changes a decision.

- **Lead with the outcome.** Status / verdict / recommendation first, then the support for it. No preamble, no restating the task back to the reader, no "as requested" / "I have carefully…".
- **Be exact.** Use real identifiers, file paths, function signatures, commands, and DTO/field shapes — never vague description ("the relevant service", "various changes", "the appropriate component").
- **Prefer structure over prose.** Lists and tables for findings, changes, and options; short paragraphs only where reasoning genuinely needs them.
- **Rationale only where it changes a decision.** Include the "why" behind a tradeoff, risk, or verdict; cut decorative reasoning and step-by-step narration of what you did.
- **Keep every required section.** Never drop a section your output format mandates — that is a hard-gate failure. Fill it, or mark it explicitly (`n/a`, `none`).
- **No padding.** No congratulatory wrap-ups, no restating what a section header already says.

**Exception — contracts (`plan.md`, task files) favor completeness over terseness.** Never cut a detail the implementer needs to execute without rework. Here "density" means *no filler*, not *omit necessary specification*.
