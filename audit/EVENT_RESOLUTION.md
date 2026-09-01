# Event resolution

Every market moves from OPEN to CLOSED by time. At or after `resolvesAt`, only the immutable Resolver Safe may call `resolve(YES|NO|INVALID)`. Resolution can occur once.

The Safe cannot edit metadata or timestamps, trade, move shares, withdraw collateral, claim fees, or modify orders. INVALID pays 0.5 USDG per YES and NO share.
