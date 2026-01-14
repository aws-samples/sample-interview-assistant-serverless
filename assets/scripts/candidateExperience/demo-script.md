# Demo Script: Agentic Speech-to-Speech Interview Assistant

### **Opening**

Imagine this, your company just spent $35,000 hiring a software developer. Within six months, they're gone. You've lost not just the hiring cost, but 50-200% of their annual salary in productivity losses. This isn't rare, it's a $36 billion annual crisis across the tech industry.

But there's an even deeper problem, **70% of hiring decisions are made in the first five minutes**, often based on gut feelings rather than qualifications. Black candidates receive 50% fewer callbacks. 38% of technical positions interview only male candidates.

**We built something that aims to change to this.**"

### **The Solution**

Meet the **Agentic Speech-to-Speech Interview Assistant**—powered by Amazon Nova Sonic, the AWS Strands SDK, and Bedrock AgentCore Memory and Observability.

Here we have Sarah _[Navigate to dashboard]_

Sarah is preparing for a senior cloud architect interview at a Fortune 500 company. She uploads her CV and the job description. _[Upload files]_

In seconds, our agentic AI analyzes her background, researches the company using **Amazon Nova Grounding** with live web search, and generates a personalized interview plan tailored specifically to her experience and this role.

_[Show generated plan on screen]_

Notice the questions aren't generic—they're contextualized to her 8 years in cloud migration and this company's recent AWS expansion.

_[Create practice session]_

Now Sarah can jump into a practice session. Here we get the option to choose between different modes. If we select "smart", then we will use a Strands Agent to dynamically evaluate candidate answers, and determine follow up questions. And we also provide guidance in form of tips to the candidate throughout the session. So let's go ahead with that option.

Now let's watch the magic happens. _[Start practice session]_

Sarah speaks naturally to an AI interviewer using **Nova Sonic's speech-to-speech capability** no typing, no text interface, just conversation. The AI responds in real-time with sub-500 millisecond latency. As she answers, the **AWS Strands agent** analyzes her response quality, technical accuracy, and communication style, providing real-time copilot suggestions. _[Show copilot tips appearing]_"

_[Navigate to practice session details]_

This is what the future of hiring looks like. Sarah just completed her practice session and received detailed coaching on her technical depth, communication style, and areas for improvement, all stored in DynamoDB for tracking progress over time.

She's more confident. She's better prepared. And most importantly, she'll be evaluated fairly.

### **The Dual-Persona Power**

But there is more, this solution serves **both sides** of the hiring equation.

_[Switch to interviewer view]_

Meet Marcus, a hiring manager conducting an actual interview. Our live interview copilot monitors the conversation in real-time, providing:

- **Standardized question suggestions** to ensure consistency
- **Real-time consistency checks** against the structured assessment framework
- **Automated transcription and scoring**

After the interview, Marcus gets a comprehensive analysis with standardized metrics, removing the guesswork and unconscious bias that plague 70% of hiring decisions made in those critical first five minutes.

As a result? **Every candidate is evaluated on the same criteria. Every interviewer follows the same framework. Every decision is data-driven.**

### **Technical Excellence & Business Impact**

The architecture behind this is production-grade enterprise software:

- **32+ RESTful APIs** supporting 1,000+ concurrent users
- **Scalable microservices on Amazon EKS** with auto-scaling policies
- **AWS Bedrock AgentCore** for memory management driving personalization and enabling observability so that we can understand all actions and reasoning that the agent is undertaking.
- **Sub-second AI responses** with Nova Sonic and Amazon Bedrock models
- **Enterprise security**: Cognito IAM, encryption at rest and in transit, VPC isolation and so forth.

To net it out, this cloud-native architecture means we can scale instantly.

And the business impact is staggering, you can get easily a 300% first-year ROI for organizations that hire 50+ people annually, and you can break-even with just 3 to 5 hires per month, at an operational cost that is less than $200 per month.

And we're just getting started. Our roadmap includes automated candidate sourcing from GitHub and research publications, intelligent job matching engines, and advanced bias detection agents that monitor language patterns and scoring consistency across demographics.

**We're not just building software, we're eliminating the $36 billion waste in technical hiring while making the process measurably fairer for everyone.**

This is the **Agentic Speech-to-Speech Interview Assistant**. Revolutionizing interview preparation and hiring with the power of Amazon Bedrock, Nova Sonic, and agentic AI.

Thank you.

**[End with dashboard showing key metrics and live demo link]**
