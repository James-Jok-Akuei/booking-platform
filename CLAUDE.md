# Booking platform

A service-booking marketplace: customers book appointments with businesses;
businesses manage their profile, locations, services, availability and bookings.

**Read `DECISIONS.md` before starting any work.** It is the running record of
every product and technical decision, one section per module, and it is the
context that makes the codebase make sense. Append to it when you make a
decision; mark reversed decisions `~~superseded~~` rather than deleting them.

## Commit conventions

Never add "Co-Authored-By" or "Generated with Claude Code" lines to commits, PR
descriptions, or any git metadata.

This is also enforced by `.claude/settings.json` via the `attribution` setting.
Do not add `includeCoAuthoredBy` — it is deprecated in favour of `attribution`,
and setting both invites conflicting behaviour.
