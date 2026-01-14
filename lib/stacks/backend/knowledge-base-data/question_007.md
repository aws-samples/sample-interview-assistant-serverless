## Question

Describe the end-to-end full-stack process when a user uploads a profile image to a social media platform.

## Instructions

This assessment evaluates the candidate's comprehension of comprehensive full-stack application workflows. Your objective is to traverse the complete technology stack within a 20 minute dialogue.
Request the candidate to sequentially explain each phase from the moment the user initiates "Upload" through the final image rendering on their profile. The image must be persisted in various dimensions and storage expenses should be optimized.
Elicit precise details at each phase covering:

- Client-side input verification and preliminary processing
- Communication infrastructure (DNS, TCP/TLS establishment)
- Server-side operations and persistence
- Exception management and protection measures

Don't hesitate to redirect if a candidate elaborates sufficiently on one segment to guarantee coverage of remaining exercise components.

## Evaluation Criteria

Assess the candidate based on:

- Client layer: Input verification, FormData construction, AJAX/fetch configuration
- Client layer: Browser-based image preprocessing or size reduction
- Transport layer: DNS name resolution and TCP/TLS establishment comprehension
- Transport layer: HTTP message delivery with appropriate metadata and credentials
- Server layer: HTTP message processing and path resolution
- Server layer: Server-side input verification and identity confirmation
- Server layer: Image manipulation (various dimensions, size reduction, format enhancement)
- Server layer: Persistence approach (S3, CDN, expenditure reduction through tier strategies)
- Server layer: Data repository modification with image references
- Client layer: Response processing and interface element manipulation
- Supplementary: Exception management across the entire workflow
- Supplementary: Progress feedback for user engagement
- Supplementary: Cache strategies and CDN integration

## Expected Answer

Comprehensive responses demonstrate sequential workflow through:

- **Client layer**: File capture → verification → preprocessing → FormData → fetch/AJAX with credential headers
- **Transport layer**: DNS resolution → TCP establishment → TLS handshake → HTTP POST delivery
- **Server layer**: Message receipt → credential/input verification → image manipulation (various dimensions via Sharp/ImageMagick) → S3 persistence → data repository modification → message response
- **Persistence enhancement**: Generate dimensions dynamically, adopt WebP encoding, utilize S3 tier strategies
- **Response phase**: Success message with references → interface modification → user alert
- **Exception management**: Connection interruptions, input format complications, server malfunctions at every tier
- **Optimization**: Progress indicators, CDN propagation, image enhancement, cache directives

## Time

20 minutes
