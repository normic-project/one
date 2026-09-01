# State machine

```text
OPEN -> CLOSED -> RESOLVED_YES | RESOLVED_NO | RESOLVED_INVALID
```

OPEN becomes CLOSED by time for reads. The final transition requires the Resolver Safe at or after `resolvesAt`. There are no reverse transitions. Redemptions burn the caller's selected shares.
