@AGENTS.md

## QA after every change

After implementing any feature/content change the client asks for on this
site, before calling the task done: start the dev server and actually
exercise the affected flow (Playwright, mocking API routes with realistic
data where live credentials aren't available) — don't just eyeball the
code. While in there, it's worth a quick look for anything else obviously
broken nearby, the way a real visitor would hit it.

- Auto-fix bugs that are clear-cut and low-risk, verify the fix the same
  way, then commit and push.
- Flag anything ambiguous or that involves a design/judgment call instead
  of guessing — describe the tradeoff and let the client decide.
- Port any shipped fix to the static Artifact preview too, and keep the
  two in sync the way the rest of this workflow already does.
