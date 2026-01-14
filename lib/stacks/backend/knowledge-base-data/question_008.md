## Question

Examine the design of a package delivery notification platform and detect architectural flaws

## Instructions

Show the candidate a package delivery platform architecture blueprint featuring numerous servers, traffic distributors, data repositories, and third-party services (SMS provider, locker infrastructure).

```
                                    Internet
                                       |
                        ┌──────────────┴──────────────┐
                        |         WAF (Single)         |
                        └──────────────┬──────────────┘
                                       |
                   ┌───────────────────┴───────────────────┐
                   |                                       |
           ┌───────▼────────┐                    ┌────────▼───────┐
           |   LB1 (East)   |                    |   LB2 (West)   |
           | (with hacky    |                    | (with hacky    |
           |  failover)     |                    |  failover)     |
           └───────┬────────┘                    └────────┬───────┘
                   |                                      |
       ┌───────────┼──────────────┐          ┌───────────┼──────────────┐
       |           |              |          |           |              |
   ┌───▼──┐    ┌──▼───┐      ┌──▼───┐  ┌───▼──┐    ┌──▼───┐      ┌──▼───┐
   | S1   |    | S2   |      | S3   |  | S4   |    | S5   |      | S6   |
   | API  |    | API  |      | Notif|  | API  |    | API  |      | Logs |
   | 512MB|    | 512MB|      | 512MB|  | 512MB|    | 512MB|      | 512MB|
   | Local|    | Local|      | Local|  | Local|    | Local|      | (All) |
   | Auth |    | Auth |      | Auth |  | Auth |    | Auth |      |      |
   └───┬──┘    └──┬───┘      └──┬───┘  └───┬──┘    └──┬───┘      └──────┘
       |          |             |          |          |
       └──────────┴─────────────┴──────────┴──────────┘
                              |
                    ┌─────────┴──────────┐
                    |                    |
            ┌───────▼────────┐   ┌───────▼────────┐
            |   Database     |   | Message Queue  |
            |   (Single)     |   |   (Single)     |
            | No replication |   | No persistence |
            └────────────────┘   └───────┬────────┘
                                         |
                             ┌───────────┴───────────┐
                             |                       |
                     ┌───────▼────────┐    ┌────────▼────────┐
                     | SMS Gateway    |    | Locker System   |
                     | (External API) |    | (External API)  |
                     | HTTP GET       |    | No VPN          |
                     └────────────────┘    └─────────────────┘
```

The platform exposes two primary routes:

- `/notifications` - dispatches SMS alerts upon parcel arrival
- `/packages` - monitors parcel state and routing checkpoints

Pose the question: "What architectural weaknesses do you observe in this infrastructure?"

Direct the candidate toward problem identification rather than remediation. Reserve 20 minutes for examination. If they concentrate excessively on one domain, validate their observations and redirect toward alternative concerns.

## Evaluation Criteria

Assess the candidate based on:

- Traffic Distribution Concerns: Regional separation fails to deliver genuine fault tolerance
- Individual Failure Vulnerabilities: Data repository, service handler, firewall, async queue
- Identity Verification: Decentralized credential storage produces coherence challenges
- Horizontal Growth: Static server inventory, absent dynamic provisioning
- Resilience Mechanisms: Lacking switchover capabilities, fragile traffic distributor contingencies
- Protection Issues: SMS payload in HTTP GET operations reveals sensitive user data
- Protection Issues: Service interfaces accessible without proper safeguards or tunneling
- Audit Trail: Unified log aggregation on individual server introduces performance constraint
- Data Repository: Absent partitioning, mirroring, or snapshot strategies
- Observability: Absent wellness verification and unified telemetry
- Async Queue: Absent durable persistence or exception processing for unsuccessful third-party interactions
- Capacity Distribution: Co-located services on identical constrained virtual machines obstruct autonomous expansion

## Expected Answer

Comprehensive responses detect problems spanning various categories:

- **Operational continuity**: Numerous individual collapse risks (data repository, async queue, service handler, firewall)
- **Regional distribution**: Geographical separation provides minimal benefit when complete zone outages occur
- **Identity verification**: Scattered credential repositories trigger request routing and data coherence complications
- **Protection mechanisms**: GET operations for SMS transmission leak contact details in audit logs; require encrypted channels and network isolation
- **Horizontal expansion**: Static 512MB/1GHz virtual machines inadequate for demand surges; absent elastic provisioning
- **Audit aggregation**: Individual server (S6) handling complete log processing introduces constraint
- **Async messaging**: Absent durability or exception processing for unsuccessful third-party service interactions
- **Temporary fixes**: Improvised traffic distributor contingency approach unsuitable for operational deployment
- **System telemetry**: Absent wellness validation or service registry capabilities

## Time

20 minutes
