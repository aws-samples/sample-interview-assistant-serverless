## Question

Design a data integration architecture for a generative AI-powered patient engagement solution that reduces appointment no-shows by 30% while accessing data from multiple healthcare systems without overloading them

## Instructions

This is an exercise to test the candidate's understanding of architecting data integration strategies for GenAI solutions that need to orchestrate data from multiple source systems. Allow 20 minutes.

Present the following scenario: A healthcare provider wants to reduce appointment no-shows by 30% and improve care plan adherence through a patient engagement solution powered by generative AI. The solution needs to access data from multiple existing systems, including an Electronic Health Record (EHR) system, a scheduling system, and a billing system, to provide personalized patient communications and reminders. They want to ensure data is always current without overloading their existing systems.

Ask the candidate to:

- Design the data integration architecture for accessing multiple source systems
- Explain techniques for maintaining data freshness without overloading systems
- Describe how they would handle failure modes at integration points
- Address how they would ensure reliability of patient communications
- Discuss how the architecture supports the business goal of reducing no-shows

Probe for specific integration patterns, data synchronization strategies, and resilience mechanisms.

## Evaluation Criteria

Evaluate the candidate on:

- Architecture: Overall integration architecture design
- Architecture: Decoupling strategy between source systems and AI application
- Architecture: Event-driven vs batch processing trade-offs
- Data Integration: Integration patterns (API, CDC, ETL, messaging)
- Data Integration: Change Data Capture for near real-time updates
- Data Integration: API design and rate limiting considerations
- Data Integration: Data transformation and normalization strategy
- Data Freshness: Real-time vs near real-time vs batch considerations
- Data Freshness: Caching strategies with appropriate TTLs
- Data Freshness: Incremental updates vs full refreshes
- Data Quality: Data validation and cleansing processes
- Data Quality: Handling inconsistencies across source systems
- Data Quality: Schema evolution and version management
- System Protection: Rate limiting and throttling to protect source systems
- System Protection: Bulkhead pattern to isolate system failures
- System Protection: Circuit breaker implementation
- Resilience: Retry logic with exponential backoff
- Resilience: Dead letter queues for failed integrations
- Resilience: Graceful degradation when systems are unavailable
- Foundation Model: Strategy for using integrated data in prompts
- Foundation Model: Handling of sensitive health information (HIPAA)
- RAG/Context: Data store design for providing context to model
- RAG/Context: Vector database for patient history and preferences
- Monitoring: Integration health monitoring and alerting
- Monitoring: Data freshness metrics and SLA tracking
- Monitoring: Error rate tracking across integration points
- Business Alignment: How architecture supports 30% no-show reduction
- Compliance: HIPAA compliance in data handling and storage

## Expected Answer

Strong answers demonstrate understanding of:

- **Integration Architecture**: Event-driven architecture with integration layer separating source systems from AI application, using API Gateway + Lambda/ECS for orchestration, message queues (SQS/EventBridge) for asynchronous processing
- **Integration Patterns**:
  - Change Data Capture (CDC) from EHR for real-time updates on patient records
  - API polling with intelligent scheduling for appointment system (more frequent during business hours)
  - Webhook subscriptions where supported by source systems
  - ETL batch jobs for historical data synchronization
  - FHIR (Fast Healthcare Interoperability Resources) standard for healthcare data exchange
- **Data Freshness Strategy**:
  - Real-time CDC for critical data (appointment changes, care plan updates)
  - Near real-time polling (5-15 min) for scheduling data
  - Cached data with appropriate TTLs (patient demographics cached for hours, appointments cached for minutes)
  - Event-based invalidation when source systems notify of changes
  - Incremental updates to minimize data transfer and processing
- **System Protection**:
  - Rate limiting on outbound API calls to respect source system capacity
  - Token bucket or leaky bucket algorithms for throttling
  - Bulkhead pattern isolating each integration (failure in billing doesn't affect EHR)
  - Circuit breaker pattern to detect and stop calling failing systems
  - Backpressure mechanisms when downstream systems are slow
- **Data Store Design**:
  - Centralized data lake (S3) for raw data from all sources
  - Operational data store (RDS/DynamoDB) for current patient state
  - Vector database (OpenSearch Serverless) for patient history, preferences, and communication patterns
  - Feature store for computed features used by AI model
- **Resilience and Error Handling**:
  - Retry logic with exponential backoff for transient failures
  - Dead letter queues for messages that repeatedly fail
  - Fallback to cached or stale data with transparency to users
  - Manual reconciliation process for critical failures
  - Idempotency keys to prevent duplicate processing
- **Data Quality**:
  - Validation rules at ingestion (schema validation, data type checking)
  - Data normalization across systems (different patient IDs, date formats)
  - Conflict resolution when multiple systems have different values
  - Data lineage tracking for audit and debugging
  - Alerting on data quality issues or unexpected changes
- **HIPAA Compliance**:
  - Encryption at rest and in transit for all PHI
  - Access controls and audit logging for data access
  - De-identification or tokenization where possible
  - Business Associate Agreements (BAAs) with all vendors
  - Data retention and deletion policies
- **Patient Communication Flow**:
  - Integration layer aggregates data → Feature extraction → RAG context building → GenAI prompt with personalized patient context → Communication generation → Delivery (SMS/email/portal)
  - Scheduling triggers (upcoming appointments, care plan milestones) → data enrichment → AI personalization → send reminder
- **Monitoring and Observability**:
  - CloudWatch for integration health metrics (success rate, latency, error rate)
  - Data freshness dashboards showing last update time per system
  - Alert on stale data or integration failures
  - Distributed tracing to track data flow across systems
  - Business metrics: no-show rate, message delivery rate, engagement rate
- **Failure Mode Handling**:
  - EHR down: Use cached patient data, flag communications as potentially stale
  - Scheduling system down: Queue requests, process when available, use last known schedule
  - Billing system down: Proceed without billing information (lowest priority)
  - AI model unavailable: Fall back to template-based communications
- **Scalability**: Horizontal scaling of integration workers, parallel processing of patient records, batch processing during off-peak hours for non-urgent communications
- **Business Alignment**: Timely, personalized reminders based on patient preferences and history drive engagement and reduce no-shows; real-time appointment change notifications prevent confusion; care plan reminders improve adherence

## Time

20 minutes
