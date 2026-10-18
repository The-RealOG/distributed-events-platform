# ADR-017: Multi-replica fanout with one Kafka consumer group per realtime replica

**Status:** Accepted

## Context

With more than one realtime-service replica, the two users of a board can be connected to
different replicas. Each replica must learn about every event for the rooms it holds.

Options considered:

1. **Redis Pub/Sub between replicas.** One replica consumes Kafka and republishes to a channel
   all replicas subscribe to. Adds a second, lossy fanout layer and makes Redis part of the
   realtime path.
2. **Sticky routing by project.** Route every socket of a project to the same replica. Requires
   a routing layer that knows projects, and rebalancing on scale events.
3. **Every replica reads every event from Kafka** (chosen).

## Decision

Each replica joins its **own consumer group** `realtime-service.<instanceId>` (instanceId =
hostname + pid), starting from the **latest** offset. Kafka delivers every event to every
replica; each replica sends it to its local room members only.

- IAM on MSK allows `AlterGroup/DescribeGroup` on `group/<cluster>/realtime-service.*` only.
- Starting at latest is correct: a new replica has no sockets that could have missed older
  events; reconnecting clients reconcile by refetching (ADR-018).
- **Why not Redis Pub/Sub:** Kafka already provides the fanout. Pub/Sub would add a component
  whose failure silently drops notifications, with nothing gained. Consequently there is no
  "Redis Pub/Sub failure" mode in this system (the failure tests record it as
  not applicable).

## Consequences

- Kafka read load grows linearly with replicas (each reads the whole topic). At this system's
  event rates that is negligible; at very high rates, option 2 would be revisited.
- Consumer groups of replaced tasks remain on the broker until Kafka's offset retention expires
  them (default 7 days); they hold no members and cost nothing but metadata.
- Verified by `apps/realtime-service/test/realtime.int.test.ts` ("clients on different replicas
  all receive the event") and deliberate break `p8-09-replicas-share-a-group` (a shared group
  makes one replica miss events).
