## Question

Design a multilingual AI-powered customer support system for a global e-commerce company operating in 20 countries with varying amounts of training data per language, while optimizing for long-term cost efficiency and performance

## Instructions

This is an exercise to test the candidate's understanding of model adaptation strategies, multilingual system design, and trade-offs between fine-tuning and prompt engineering. Allow 20 minutes.

Present the following scenario:
A global e-commerce company operates in 20 countries and needs to develop an AI-powered customer support system that can handle inquiries in 15 different languages across multiple product lines. The system needs to provide accurate, helpful responses that maintain brand voice while being culturally appropriate for each market.
The company has extensive customer support logs in English (millions of conversations), moderate amounts in 5 major languages (hundreds of thousands each), and limited data in the remaining languages (tens of thousands each). They have strict cost constraints but are willing to invest more upfront if it will lead to better long-term performance and lower operational costs.

Ask the candidate to:

- Design the architecture for multilingual customer support
- Explain their approach to model adaptation (fine-tuning vs prompt engineering)
- Address the imbalanced data availability across languages
- Describe strategies for maintaining brand voice across cultures
- Discuss cost optimization for long-term operation
- Address prompt management and versioning at scale

Probe for specific decisions about fine-tuning techniques, model distillation, multilingual strategies, and operational considerations.

## Evaluation Criteria

Evaluate the candidate on:

- Architecture: Overall system design for multilingual support
- Architecture: Language detection and routing strategy
- Architecture: Handling multiple product lines and domains
- Model Selection: Base model choice for multilingual capabilities
- Model Selection: Single multilingual model vs multiple specialized models
- Fine-tuning Strategy: When to use fine-tuning vs prompt engineering
- Fine-tuning Strategy: PEFT techniques (LoRA, QLoRA, adapters) for efficiency
- Fine-tuning Strategy: Handling imbalanced data across languages
- Fine-tuning Strategy: Multi-task learning for product lines
- Prompt Engineering: Sophisticated prompting strategies for zero/few-shot
- Prompt Engineering: Cross-lingual prompt transfer techniques
- Prompt Engineering: Few-shot examples selection and management
- Model Distillation: Rationale for distilling larger models
- Model Distillation: Distillation process and quality preservation
- Model Distillation: Cost-performance trade-offs
- Data Strategy: Data augmentation for low-resource languages
- Data Strategy: Transfer learning from high-resource languages
- Data Strategy: Synthetic data generation considerations
- Cultural Adaptation: Ensuring cultural appropriateness per market
- Cultural Adaptation: Brand voice consistency across languages
- Cultural Adaptation: Handling cultural nuances and idioms
- Prompt Management: Versioning system for prompts across languages
- Prompt Management: Template management and localization
- Prompt Management: Testing framework for prompt quality
- Cost Optimization: Inference cost reduction strategies
- Cost Optimization: Balancing upfront investment vs operational costs
- Performance: Response quality metrics per language
- Monitoring: Quality monitoring across languages and markets

## Expected Answer

Strong answers demonstrate understanding of:

- **Architecture**: Hub-and-spoke model with language detection → routing to language-specific or multilingual endpoint → response generation → quality validation → delivery
- **Model Selection**:
  - Start with strong multilingual base model
  - Consider whether single model or language-specific models based on volume and quality requirements
- **Fine-tuning vs Prompt Engineering Decision Framework**:
  - **Use Prompt Engineering when**:
    - Base model already performs well on the task
    - Limited training data available (low-resource languages)
    - Need flexibility to quickly iterate and update
    - Cost-conscious about upfront investment
    - Requirements change frequently
  - **Use Fine-tuning when**:
    - Specific domain terminology needs deep integration
    - Consistent behavior across high-volume languages is critical
    - Have sufficient quality training data (>10k examples)
    - Long-term operational cost savings outweigh upfront cost
    - Need very specific brand voice or style
- **Fine-tuning Strategy**:
  - **Parameter-Efficient Fine-Tuning (PEFT)** using LoRA or QLoRA for cost-effective adaptation
  - **Adapter layers** for language-specific or product-specific adaptations
  - **Multi-task learning**: Single model fine-tuned on multiple languages and product lines
  - **Transfer learning**: Fine-tune on English first, then adapt to other languages
  - **Progressive fine-tuning**: Start with high-resource languages, progressively add low-resource
  - **Language-specific adapters**: Swap adapters based on detected language
- **Handling Imbalanced Data**:
  - **High-resource languages (English + 5 major)**: Consider fine-tuning with LoRA for optimal quality
  - **Low-resource languages (remaining 9)**: Use prompt engineering with few-shot examples, potentially with cross-lingual transfer
  - **Data augmentation**: Back-translation, paraphrasing, synthetic data generation for low-resource languages
  - **Code-switching**: Leverage multilingual model's ability to work with mixed languages
- **Model Distillation**:
  - Distill large model into smaller, faster model for deployment
  - Use teacher model to generate training data for student model
  - Maintain quality while reducing inference cost by 5-10x
  - Particularly valuable for high-volume, low-complexity queries
  - Tiered approach: Small model for simple queries, large model for complex ones
- **Prompt Engineering at Scale**:
  - **Prompt template system**: Base template with language-specific variations
  - **Versioning**: Git-based prompt versioning with A/B testing framework
  - **Localization**: Native speakers review and adapt prompts for cultural appropriateness
  - **Few-shot examples**: Curated, high-quality examples per language stored in prompt library
  - **Dynamic few-shot**: Retrieve most relevant examples from vector database based on query
  - **Prompt composition**: Combine base instructions + language specifics + product context + few-shot examples
- **Multilingual Prompt Management**:
  - Centralized prompt repository with language tagging
  - Automated testing pipeline for each language variant
  - Quality metrics: Accuracy, helpfulness, brand voice alignment
  - Rollback capability if new prompts degrade quality
  - Continuous monitoring of prompt performance per language
- **Cultural Adaptation**:
  - Market-specific guidelines in system prompts
  - Examples demonstrating appropriate tone and formality per culture
  - Validation step checking for cultural sensitivity
  - Local team review and approval for each market
  - Feedback loop from local support teams
- **Brand Voice Consistency**:
  - Core brand guidelines encoded in system prompt
  - Style guide examples in few-shot demonstrations
  - Automated style consistency scoring
  - Human review samples from each language
- **RAG for Knowledge**:
  - Vector database with product documentation in all languages
  - Multilingual embeddings (e.g., multilingual-e5) for cross-lingual retrieval
  - Language-specific knowledge bases where needed
  - Automatic translation of new documentation
- **Cost Optimization**:
  - **Upfront investment**: Fine-tune with PEFT for high-volume languages to reduce per-query cost
  - **Operational savings**: Caching for frequent queries, distillation for simple queries
  - **Tiered routing**: Simple queries → small model, complex → large model
  - **Batch processing**: Non-urgent queries processed in batches for cost efficiency
  - **Reserved capacity**: Provisioned throughput for baseline, on-demand for spikes
- **Quality Monitoring**:
  - Automated metrics: Response accuracy, relevance, language quality
  - Human evaluation: Random sampling reviewed by native speakers
  - Customer satisfaction scores per language and market
  - A/B testing new approaches against baseline
  - Continuous feedback loop for improvement
- **Deployment Strategy**:
  - Start with English + high-resource languages
  - Validate quality and gather feedback
  - Progressively roll out to low-resource languages
  - Monitor and iterate on each market
- **Hybrid Approach** (Recommended):
  - Fine-tune with LoRA on English + 5 major languages (sufficient data, high volume)
  - Sophisticated prompt engineering for remaining 9 languages (limited data, lower volume)
  - Distill fine-tuned models for deployment efficiency
  - Centralized prompt management system with localization
  - Continuous evaluation and adaptation based on performance

## Time

20 minutes
