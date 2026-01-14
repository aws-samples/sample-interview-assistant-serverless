## Question

Architect a REST API for an e-commerce product inventory system
Leverage a free diagramming tool, e.g. https://excalidraw.com/ to create visual representations as required.

## Instructions

Assess the candidate's API architecture capabilities, grasp of RESTful standards, and hands-on background. Focus on:

- Correct HTTP method application (GET, POST, PUT, DELETE, PATCH)
- Resource identifier naming patterns
- Exception management and response codes
- List pagination and filtering techniques
- Identity verification and access control mechanisms

## Evaluation Criteria

Assess the candidate based on:

- Creates well-defined, user-friendly endpoint architecture
- Applies suitable HTTP verbs and response codes
- Establishes logical resource relationships
- Incorporates pagination for collection responses
- Explores data filtering and ordering capabilities
- Outlines API versioning approach
- References security and access control measures

## Expected Answer

Comprehensive responses generally cover:

- RESTful route structure: GET /products, GET /products/:id, POST /products, PUT /products/:id, DELETE /products/:id
- Hierarchical resources: GET /categories/:id/products
- Filter query strings: GET /products?category=electronics&price_max=100
- Pagination approaches: limit/offset or cursor-driven
- Standard response codes: 200, 201, 204, 400, 401, 404, 500
- Identity verification through JWT tokens or API credential systems
- Version management: /v1/products or content negotiation headers

## Time

15 minutes
