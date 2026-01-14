## Question

Describe your methodology for diagnosing a memory leak in a prod Node.js environment

## Instructions

Evaluate the candidate's diagnostic capabilities, memory management comprehension, and prod environment troubleshooting background. Focus on:

- Methodical investigation process
- Familiarity with analysis and profiling utilities
- Awareness of typical memory leak sources
- Background with prod system debugging limitations
- Capacity to reconcile investigation efforts with service uptime

## Evaluation Criteria

Assess the candidate based on:

- Outlines a structured methodology for leak detection
- References particular diagnostic tools (memory snapshots, profiling utilities, monitoring platforms)
- Clarifies heap dump interpretation techniques
- Recognizes frequent memory leak scenarios (listener accumulation, closure chains, unbounded caches)
- Addresses prod environment precautions
- Recommends proactive prevention strategies

## Expected Answer

Comprehensive responses generally cover:

- Leverage memory snapshot and profiling capabilities (Chrome DevTools, clinic.js, heapdump)
- Track memory consumption trends across time intervals
- Examine retained object graphs and dependency references
- Typical culprits: lingering event handlers, uncapped cache structures, closure memory retention
- Prod system concerns: activate diagnostics while preserving application responsiveness
- Mitigation: peer code review processes, integrated leak detection in deployment pipelines

## Time

10 minutes
