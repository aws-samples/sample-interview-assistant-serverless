## Question

Diagnose and resolve performance issues in a generative AI customer support application experiencing high latency during peak hours that is threatening customer retention goals.

## Instructions

This is an exercise to test the candidate's understanding of troubleshooting and optimizing GenAI applications under production load. Allow 20 minutes.

Present the following scenario: A telecommunications company has deployed a generative AI application for customer support with the goal of reducing churn by 20% through improved issue resolution. However, the application is experiencing increasing latency during peak hours, with users reporting wait times of over 10 seconds for initial responses. Customer satisfaction scores are dropping, and they're seeing increased abandonment rates that threaten their retention targets.

Ask the candidate to:

- Identify potential causes of latency across the entire stack
- Describe their diagnostic approach and methodology
- Recommend specific architectural changes to improve performance
- Explain how they would validate the improvements

Probe for both immediate tactical fixes and longer-term strategic improvements.

## Evaluation Criteria

Evaluate the candidate on:

- Diagnosis: Systematic approach to identifying root causes
- Diagnosis: Understanding of observability and monitoring tools
- Diagnosis: Ability to isolate issues at different layers of the stack
- Foundation Model: Recognition of model inference latency as potential bottleneck
- Foundation Model: Understanding of token limits and context window impacts
- Foundation Model: Awareness of model size vs performance trade-offs
- API/Network: Recognition of API rate limits and throttling
- API/Network: Understanding of network latency and connection pooling
- API/Network: Geographic distribution and edge computing considerations
- RAG/Data: Recognition of vector search latency in retrieval systems
- RAG/Data: Understanding of index optimization and caching strategies
- RAG/Data: Database query performance and connection management
- Application Layer: Identification of synchronous vs asynchronous processing issues
- Application Layer: Recognition of resource contention and scaling bottlenecks
- Application Layer: Understanding of timeout configurations and retry logic
- Infrastructure: Auto-scaling configuration and cold start issues
- Infrastructure: Resource allocation (CPU, memory, GPU) adequacy
- Infrastructure: Load balancing and traffic distribution
- Solutions: Caching strategies (response caching, embedding caching)
- Solutions: Pre-computation of common queries or responses
- Solutions: Streaming responses to reduce perceived latency
- Solutions: Queue-based architecture for load leveling
- Solutions: Horizontal scaling and resource optimization
- Monitoring: Metrics to track (p50, p95, p99 latency, error rates)
- Monitoring: Distributed tracing to identify slow components
- Business Alignment: Understanding impact on customer retention goals
- Trade-offs: Discussion of cost vs performance considerations

## Expected Answer

Strong answers demonstrate understanding of:

- **Diagnostic Approach**: Systematic investigation using distributed tracing (X-Ray, Jaeger), CloudWatch metrics, application logs to identify bottlenecks at each layer
- **Foundation Model Issues**: Model inference time (large models, long context windows), cold starts on inference endpoints, insufficient provisioned throughput, token generation speed
- **API/Network Bottlenecks**: Rate limiting from model providers, API gateway throttling, connection pool exhaustion, lack of keep-alive connections, geographic latency to model endpoints
- **RAG Performance**: Slow vector database queries, unoptimized embeddings search, missing indexes, inefficient retrieval queries, large document chunks requiring more processing
- **Application Layer**: Synchronous request handling blocking threads, missing connection pooling, inefficient data serialization, excessive logging, timeout values too high or causing cascading failures
- **Infrastructure**: Inadequate auto-scaling (scaling too slowly or wrong metrics), insufficient compute resources, memory constraints, cold start penalties from serverless functions
- **Immediate Fixes**:
  - Enable response streaming to reduce perceived latency
  - Implement multi-layer caching (common queries, embeddings, retrieved documents)
  - Increase provisioned throughput for model endpoints
  - Optimize vector search with proper indexes and filters
  - Add connection pooling and keep-alive for API calls
- **Architectural Improvements**:
  - Async processing with queue-based architecture for non-urgent queries
  - Pre-compute responses for FAQ and common scenarios
  - Use smaller, faster models for initial triage, escalate to larger models only when needed
  - Implement request coalescing for similar concurrent queries
  - Geographic distribution with edge computing for lower latency
  - Separate read and write paths with CQRS pattern
- **Monitoring**: Track latency percentiles (p95, p99), set up distributed tracing, monitor model invocation times, track cache hit rates, measure time-to-first-token vs total generation time
- **Validation**: A/B testing improvements against baseline, synthetic load testing, monitoring customer satisfaction scores and abandonment rates
- **Load Management**: Implement circuit breakers, graceful degradation (simplified responses during peak load), priority queuing for critical customers
- **Cost Optimization**: Balance performance improvements with cost (caching reduces model calls, right-size compute resources, use provisioned capacity strategically)

## Time

20 minutes
