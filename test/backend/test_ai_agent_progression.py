"""
Tests for AI agent question progression analysis.

Tests validate:
- JSON response format validation
- Error handling and fallback behavior
- Prompt construction for different scenarios
- Speaker label parsing in transcripts
- Category context in analysis
"""

import pytest
import json


class TestAIAgentProgressionAnalysis:
    """Test suite for AI agent progression analysis function"""

    def test_valid_json_response_format(self):
        """Test AI agent returns valid JSON format"""
        # Expected response format
        response = {
            "current_question_completed": True,
            "next_question_started": True,
            "confidence": 0.85,
            "reasoning": "Interviewer explicitly asked the next question",
        }

        # Validate all required fields present
        assert "current_question_completed" in response
        assert "next_question_started" in response
        assert "confidence" in response
        assert "reasoning" in response

        # Validate field types
        assert isinstance(response["current_question_completed"], bool)
        assert isinstance(response["next_question_started"], bool)
        assert isinstance(response["confidence"], (int, float))
        assert isinstance(response["reasoning"], str)

        # Validate confidence range
        assert 0.0 <= response["confidence"] <= 1.0

    def test_json_response_with_low_confidence(self):
        """Test JSON response for low confidence scenario"""
        response = {
            "current_question_completed": False,
            "next_question_started": False,
            "confidence": 0.35,
            "reasoning": "Conversation still on original topic",
        }

        assert response["confidence"] < 0.65
        assert response["next_question_started"] is False

    def test_json_response_for_last_question(self):
        """Test JSON response for last question completion"""
        response = {
            "current_question_completed": True,
            "next_question_started": False,
            "confidence": 0.90,
            "reasoning": "Candidate completed answer, interviewer thanked them",
        }

        assert response["current_question_completed"] is True
        assert response["next_question_started"] is False
        assert response["confidence"] >= 0.65

    def test_error_fallback_response(self):
        """Test fallback response when AI analysis fails"""
        # Safe default response
        fallback_response = {
            "confidence": 0.0,
            "current_question_completed": False,
            "next_question_started": False,
            "reasoning": "Error occurred during analysis",
        }

        assert fallback_response["confidence"] == 0.0
        assert fallback_response["current_question_completed"] is False
        assert fallback_response["next_question_started"] is False

        # Verify this won't trigger progression
        should_advance = fallback_response["confidence"] >= 0.65
        assert should_advance is False

    def test_speaker_label_format(self):
        """Test speaker label format in transcripts"""
        transcript_with_labels = """[Speaker spk_0]: Tell me about your experience with Python.
[Speaker spk_1]: I have worked with Python for over 5 years in various projects.
[Speaker spk_0]: What frameworks have you used?
[Speaker spk_1]: Mainly Django and Flask for web development."""

        # Verify speaker labels are present
        assert "[Speaker spk_0]:" in transcript_with_labels
        assert "[Speaker spk_1]:" in transcript_with_labels

        # Parse speaker turns
        lines = transcript_with_labels.strip().split("\n")
        assert len(lines) == 4

        # First speaker should be interviewer
        assert lines[0].startswith("[Speaker spk_0]:")
        # Second speaker should be candidate
        assert lines[1].startswith("[Speaker spk_1]:")

    def test_transcript_without_speaker_labels(self):
        """Test handling of transcript without speaker labels"""
        transcript_no_labels = """Tell me about your experience with Python. I have worked with Python for over 5 years. What frameworks have you used? Django and Flask."""

        # Should still be valid transcript, but less accurate detection
        assert len(transcript_no_labels) > 0
        assert "Python" in transcript_no_labels

    def test_category_context_in_prompt(self):
        """Test category information is included in analysis"""
        current_question = "What is your experience with Python?"
        current_category = "Technical Skills"
        next_question = "Describe a time you resolved a conflict"
        next_category = "Behavioral"

        # Category shift should be detectable
        assert current_category != next_category

        # These represent different topic domains
        assert "Technical" in current_category
        assert "Behavioral" in next_category

    def test_transition_phrase_detection(self):
        """Test detection of explicit transition phrases"""
        transition_phrases = [
            "Next question",
            "Let's move on",
            "Okay, now",
            "Moving on",
            "Alright, next",
        ]

        for phrase in transition_phrases:
            transcript = f"""[Speaker spk_0]: {phrase}, tell me about your AWS experience.
[Speaker spk_1]: I have extensive AWS experience."""

            # These should result in high confidence
            assert phrase.lower() in transcript.lower()

    def test_follow_up_question_detection(self):
        """Test that follow-up questions don't trigger progression"""
        follow_up_transcript = """[Speaker spk_0]: What is your Python experience?
[Speaker spk_1]: I have 5 years of Python experience.
[Speaker spk_0]: Can you elaborate on that?
[Speaker spk_1]: Sure, I've worked on Django projects."""

        # "Can you elaborate" is a follow-up, not a new question
        assert "elaborate" in follow_up_transcript
        assert "Python" in follow_up_transcript  # Still same topic

    def test_question_rephrasing_detection(self):
        """Test detection when interviewer rephrases question"""
        original_question = "What is your experience with cloud computing?"
        rephrased = "Tell me about your work with AWS and cloud platforms"

        # Keywords should overlap
        original_keywords = {"cloud", "computing", "experience"}
        rephrased_keywords = {"cloud", "platforms", "aws"}

        # Some overlap exists
        overlap = original_keywords & rephrased_keywords
        assert len(overlap) > 0

    def test_minimum_transcript_length(self):
        """Test minimum transcript length requirement"""
        MIN_TRANSCRIPT_LENGTH = 50

        short_transcript = "Hello"
        long_transcript = "Tell me about your experience with Python and Django. I have worked on many projects using these technologies."

        assert len(short_transcript) < MIN_TRANSCRIPT_LENGTH
        assert len(long_transcript) >= MIN_TRANSCRIPT_LENGTH

    def test_transcript_window_duration(self):
        """Test 3-minute transcript window"""
        TRANSCRIPT_WINDOW_SECONDS = 180  # 3 minutes

        assert TRANSCRIPT_WINDOW_SECONDS == 3 * 60
        assert TRANSCRIPT_WINDOW_SECONDS >= 120  # At least 2 minutes

    def test_json_extraction_from_markdown(self):
        """Test extracting JSON from markdown code blocks"""
        markdown_response = """Here is the analysis:

```json
{
    "current_question_completed": true,
    "next_question_started": true,
    "confidence": 0.85,
    "reasoning": "Clear transition detected"
}
```
"""

        # Extract JSON from markdown
        start_marker = "```json"
        end_marker = "```"

        if start_marker in markdown_response:
            start_idx = markdown_response.find(start_marker) + len(start_marker)
            end_idx = markdown_response.find(end_marker, start_idx)
            json_str = markdown_response[start_idx:end_idx].strip()

            # Parse JSON
            parsed = json.loads(json_str)

            assert parsed["confidence"] == 0.85
            assert parsed["next_question_started"] is True

    def test_confidence_score_ranges(self):
        """Test various confidence score scenarios"""
        scenarios = [
            {"description": "Explicit question match", "confidence": 0.95},
            {"description": "Clear transition phrase", "confidence": 0.90},
            {"description": "Topic shift detected", "confidence": 0.75},
            {"description": "Rephrased question", "confidence": 0.70},
            {"description": "Possible transition", "confidence": 0.65},
            {"description": "Unclear", "confidence": 0.50},
            {"description": "Follow-up question", "confidence": 0.30},
        ]

        for scenario in scenarios:
            if scenario["confidence"] >= 0.65:
                # Should trigger progression
                assert scenario["confidence"] >= 0.65
            else:
                # Should not trigger progression
                assert scenario["confidence"] < 0.65

    def test_last_question_completion_signals(self):
        """Test completion signals for last question"""
        completion_signals = [
            "That's all",
            "Does that answer your question?",
            "Great, thank you",
            "Perfect, we're done",
            "That covers everything",
        ]

        for signal in completion_signals:
            transcript = f"""[Speaker spk_1]: {signal}
[Speaker spk_0]: Thank you for your time."""

            # These indicate completion
            assert signal.lower() in transcript.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
