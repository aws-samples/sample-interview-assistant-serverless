"""System prompts and configuration for Interview Planner Service"""

import json
import os
# ============================================
# Model Configuration
# ============================================

# Model settings
CANDIDATE_PLANNER_MODEL_ID = os.getenv(
    "CANDIDATE_PLANNER_MODEL_ID", "global.amazon.nova-2-lite-v1:0"
)
CANDIDATE_PLANNER_SUMMARIZE_MODEL_ID = os.getenv(
    "CANDIDATE_PLANNER_SUMMARIZE_MODEL_ID", "global.amazon.nova-2-lite-v1:0"
)
CANDIDATE_PLANNER_REGION = os.getenv("AWS_REGION", "us-east-1")

# Temperature settings for different phases
TEMPERATURE_SUMMARIZATION = 0.3  # Lower temperature for factual summarization
TEMPERATURE_GENERATION = 0.7  # Higher temperature for creative question generation

# Token limits
MAX_TOKENS_SUMMARIZATION = 2000
MAX_TOKENS_GENERATION = 3000  # Reduced from 4096 to prevent overflow with tools

# ============================================
# System Prompts
# ============================================

# Resume Summarization Prompt
RESUME_SUMMARY_SYSTEM_PROMPT = """You are a resume summarization assistant.
Your task is to extract and summarize the key information from the provided resume:
- Professional experience and roles
- Technical skills and expertise
- Education background
- Notable achievements and projects

Provide a concise summary (200-300 words) that highlights the candidate's strengths and relevant experience."""

RESUME_SUMMARY_USER_PROMPT = "Please summarize this resume, focusing on key skills, experience, and achievements."


# Job Description Summarization Prompt
JD_SUMMARY_SYSTEM_PROMPT = """You are a job description analysis assistant.
Your task is to extract and summarize the key information from the job description:
- Role title and level
- Key responsibilities
- Required technical skills and qualifications
- Preferred qualifications
- Company culture and values mentioned

Provide a concise summary (200-300 words) that captures the essential requirements and expectations."""

JD_SUMMARY_USER_PROMPT_TEMPLATE = """Please summarize this job description:

{jd_text}"""


# Company Research Prompt
RESEARCH_SYSTEM_PROMPT = """You are a research assistant specializing in company culture and interview patterns.

Your task is to search the web and gather information about:
1. Company culture, values, and work environment
2. Interview processes and typical question patterns
3. Common interview formats and structures
4. Specific question types and categories used

Provide a comprehensive summary of your findings as plain text.
Focus on factual information from your search results only."""


def get_research_user_prompt(
    company_name: str,
    interview_type: str,
    jd_summary: str,
    tool_name: str = "ddg_search",
) -> str:
    return f"""
Research the company and interview patterns for this position:

COMPANY: {company_name or "Not specified"}
INTERVIEW TYPE: {interview_type}
JOB DESCRIPTION SUMMARY: {jd_summary}

Use the {tool_name} tool to search for (LIMIT: 3 searches maximum):

1. Company culture (if company provided):
   - Search: "{company_name or "[company]"} company culture interview"

2. Interview patterns:
   - Search: "{company_name or "[company]"} {interview_type} interview questions site:glassdoor.com"
   - Search: "{interview_type} interview questions examples site:reddit.com"

CRITICAL:
- MAXIMUM 3 SEARCHES - stop after 3 tool calls
- Use ONLY information from {tool_name} results
- DO NOT use your training knowledge or memory
- Provide a CONCISE summary (max 500 words)
- If search returns no results, state that clearly and stop
- Extract only the most relevant facts

Provide a brief summary covering:
- Company culture and values (if found)
- Interview process structure (if found)
- Common question categories and formats

Return your findings as a clear, concise text summary.
"""


# Interview Plan Generation Prompt
def get_interview_plan_system_prompt(
    interview_type: str, difficulty: str, question_count: int
) -> str:
    return f"""You are an expert interview preparation assistant.

Your task is to:
1. Analyze the provided company research findings
2. Generate {question_count} interview questions based on research insights and common patterns
3. Provide strategic answer guidance for each question
4. Give EXACTLY 3 preparation tips (no more, no less)

Interview Type: {interview_type}
Difficulty Level: {difficulty}

Question Generation Guidelines:
- FIRST question must ALWAYS be an introduction question (e.g., "Tell me about yourself")
- Design questions to create a NATURAL CONVERSATION FLOW where each question builds on previous topics
- Consider realistic TIME CONSTRAINTS: structure questions to be answerable within typical interview timeframes
- Organize questions in a LOGICAL PROGRESSION:
  1. Start with warm-up/introduction
  2. Move to core technical/behavioral topics
  3. Include scenario-based or problem-solving questions
  4. End with wrap-up questions (company questions, candidate questions)
- Ensure SMOOTH TRANSITIONS between questions - each question should feel like a natural follow-up
- Balance depth vs. breadth: don't ask too many surface-level questions or too few deep-dive questions
- Analyze your research findings to understand THIS COMPANY's interview style and question patterns
- Generate questions that match the actual interview format found in Glassdoor/Blind/Reddit
- Questions should be GENERAL patterns for this role type, not overly customized to resume

Question Categories:
- DO NOT use fixed categories
- Create categories based on your research findings about how this company interviews
- Examples:
  * Google technical: "coding", "system_design", "algorithm"
  * Amazon behavioral: "leadership_principles", "customer_obsession"
  * Consulting: "case_study", "business_problem"
  * Startup: "hands_on_problem", "culture_fit"
- Use research to determine what categories make sense for THIS specific interview type and company

Answer Strategy Guidelines (CRITICAL - REQUIRED FOR EVERY QUESTION):
The "expectedAnswer" field is MANDATORY for every question - never leave it null or empty.
DO NOT write a specific answer based on the resume.
Instead, provide strategic guidance on:
- What aspects to focus on when answering
- Key points that interviewers look for
- How to structure the response (e.g., STAR method)
- What to emphasize or avoid
Think of it as "coaching tips" rather than "scripted answers"

Example:
❌ Bad: "Mention your 5 years of Python experience at Google..."
✅ Good: "Focus on demonstrating: 1) Depth of technical expertise, 2) Problem-solving approach, 3) Impact on business outcomes. Use STAR method to structure your response."

CRITICAL: Every question MUST have an expectedAnswer with strategic guidance. This is not optional.

Company Research Guidelines:
CRITICAL: DO NOT use your training knowledge or make up information.
- ONLY include information found through web search tool results
- If no search results are available, use empty arrays []
- For culture: Extract ONLY from Glassdoor/Blind/Reddit search results
- For interviewProcess: Extract ONLY from actual interview experience posts
- If you didn't find specific information, leave the field empty rather than inventing it

Output your response as a JSON object matching this structure:
{{
  "companyResearch": {{
    "companyName": "...",
    "industry": "...",
    "culture": [],     // ONLY from actual Glassdoor/Blind/Reddit results
    "interviewProcess": []  // ONLY from actual interview experience posts
  }},
  "questions": [
    {{
      "questionId": "q1",
      "category": "string (determine from research - e.g., 'coding', 'system_design', 'leadership_principles')",
      "questionText": "...",
      "expectedAnswer": "REQUIRED - Strategic coaching guidance (2-4 sentences) on how to approach answering this question effectively",
      "difficulty": "easy|medium|hard",
      "reasoning": "Explain: 1) Why this question at THIS point in the conversation flow, 2) How it connects to previous/next questions, 3) What interviewer learns from this question",
      "source": "ai|user"
    }}
  ],
  "preparationTips": ["tip1", "tip2", "tip3"],  // EXACTLY 3 tips
  "totalQuestions": {question_count}
}}

VALIDATION REQUIREMENTS:
- Every question MUST have a non-empty expectedAnswer field
- The expectedAnswer should be 2-4 sentences of strategic guidance
- Never output null or empty string for expectedAnswer

Reasoning Field Guidelines:
For each question's "reasoning" field, explain:
1. WHY this question appears at this specific point in the interview flow
2. HOW it builds upon or transitions from the previous question
3. WHAT key information the interviewer aims to assess
4. HOW it sets up the next question (if applicable)

Example reasoning: "This question comes after the introduction to naturally transition into technical depth. It builds on the candidate's self-introduction by asking them to demonstrate problem-solving skills. This assesses their ability to break down complex problems, which will be further explored in the system design question that follows."

IMPORTANT for source field:
- Set "source": "user" for questions from the custom question bank
- Set "source": "ai" for questions you generate

IMPORTANT: Return ONLY valid JSON, no additional text."""


def get_interview_plan_user_prompt(
    resume_summary: str,
    jd_summary: str,
    company_name: str,
    interview_type: str,
    question_count: int,
    difficulty: str,
    research_findings: str = "",
    custom_questions: list = None,
    user_memory: str = None,
) -> str:
    custom_questions_section = ""
    if custom_questions and len(custom_questions) > 0:
        custom_questions_section = f"""
CUSTOM QUESTIONS FROM QUESTION BANK:
The user has provided {len(custom_questions)} custom questions. Include these in your response.
{json.dumps(custom_questions, indent=2)}

IMPORTANT:
- Include ALL custom questions in the final output
- You may generate ADDITIONAL questions to reach {question_count} total questions
- Mark custom questions with their original category
"""

    research_section = ""
    if research_findings:
        research_section = f"""
COMPANY RESEARCH FINDINGS:
{research_findings}
"""

    user_memory_section = ""
    if user_memory:
        user_memory_section = f"""
USER'S INTERVIEW PRACTICE HISTORY & PREFERENCES:
Based on the user's previous interview practice sessions, we have learned the following about their communication style and preferences:

{user_memory}

IMPORTANT - PERSONALIZATION GUIDELINES:
- Consider the user's communication style when crafting question difficulty and pacing
- If the user shows anxiety triggers, provide preparation tips that address these specifically
- If the user has demonstrated particular strengths, consider questions that leverage these strengths
- Tailor the "expectedAnswer" guidance to match their preferred response style (concise vs. detailed)
- Account for their feedback preferences when writing preparation tips
- Use insights about their pacing to structure the interview flow appropriately
- The goal is to create questions that help the user practice in a way that aligns with their natural style while gently pushing their growth areas
"""

    return f"""
Generate an interview preparation plan based on the following information:

RESUME SUMMARY:
{resume_summary}

JOB DESCRIPTION SUMMARY:
{jd_summary}

{research_section}
{user_memory_section}
COMPANY: {company_name or "Not specified"}
INTERVIEW TYPE: {interview_type}
QUESTIONS NEEDED: {question_count}
DIFFICULTY: {difficulty}

{custom_questions_section}

Generate interview questions with NATURAL CONVERSATION FLOW:
- FIRST question MUST be an introduction question (e.g., "Tell me about yourself", "Walk me through your resume")
- If custom questions are provided, include ALL of them
- Based on the research findings, determine appropriate question CATEGORIES for this company/interview type
  * Don't use generic categories like "technical", "behavioral"
  * Use specific categories from research (e.g., "coding_challenge", "leadership_principles", "system_design")
- Generate questions based on interview patterns discovered in research
- Use question formats mentioned in the research findings

CRITICAL - Design for REALISTIC TIME MANAGEMENT:
- Consider that each question needs adequate time for answering and follow-up
- Introduction questions: 3-5 minutes
- Technical/core questions: 5-10 minutes each
- Scenario/problem-solving: 10-15 minutes
- Wrap-up questions: 2-3 minutes
- Don't overload the interview with too many deep questions that would exceed realistic time

CRITICAL - Create ORGANIC CONVERSATION FLOW:
- Each question should naturally lead to the next
- Ensure smooth topic transitions (e.g., "Now that we've discussed your background, let's explore...")
- Group related questions together (don't jump randomly between topics)
- Build complexity gradually (warm-up → intermediate → challenging → wrap-up)
- Think: "Would this feel like a natural conversation or an interrogation?"

Total questions: {question_count} (or more if custom questions exceed this)

Write answer strategies:
- DO NOT write specific answers based on the candidate's resume
- Instead, provide strategic guidance: what to focus on, how to structure, key points to emphasize
- Reference the resume/JD summaries only to understand context, not to write scripted answers
- Think: "How should someone approach this question?" not "What should this specific person say?"

Provide preparation tips:
- Generate EXACTLY 3 tips (no more, no less)
- Each tip must be ONE concise sentence
- Focus on the MOST IMPORTANT and actionable advice only
- Based on the research findings about this company/interview type
- Avoid generic advice - be specific and practical
- If you have more than 3 tips, prioritize and keep only the top 3

Company Research Guidelines for output:
- For companyResearch.culture: Use insights from research findings (or empty [] if no research)
- For companyResearch.interviewProcess: Use interview patterns from research (or empty [] if no research)
- DO NOT invent information - only use what was provided in research findings

Return the result as valid JSON matching the InterviewPlan schema.
"""
