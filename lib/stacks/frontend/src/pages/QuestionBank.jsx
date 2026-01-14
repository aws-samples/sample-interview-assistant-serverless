import React, { useState, useEffect } from "react";
import {
  Container,
  Header,
  Button,
  SpaceBetween,
  Box,
  Cards,
  TextFilter,
  Select,
  Badge,
  Modal,
  FormField,
  Input,
  Textarea,
} from "@cloudscape-design/components";
import { questionBankAPI } from "../services/api";

function QuestionBank() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filteringText, setFilteringText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState({
    label: "All Categories",
    value: "all",
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newQuestion, setNewQuestion] = useState({
    questionText: "",
    category: "",
    suggestedAnswer: "",
    difficulty: "medium",
  });

  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const response = await questionBankAPI.list();
      setQuestions(response.data.questions || []);
    } catch (error) {
      console.error("Failed to load questions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuestion = async () => {
    try {
      await questionBankAPI.create(newQuestion);
      setShowAddModal(false);
      setNewQuestion({
        questionText: "",
        category: "",
        suggestedAnswer: "",
        difficulty: "medium",
      });
      loadQuestions();
    } catch (error) {
      console.error("Failed to add question:", error);
    }
  };

  const getDifficultyBadge = (difficulty) => {
    const badgeMap = {
      easy: "green",
      medium: "blue",
      hard: "red",
    };
    return (
      <Badge color={badgeMap[difficulty] || "grey"}>
        {difficulty || "Medium"}
      </Badge>
    );
  };

  const getCategoryBadge = (category) => {
    return <Badge>{category || "General"}</Badge>;
  };

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description="Manage your interview question library"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => console.log("Import CSV")}>
              Import CSV
            </Button>
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              Add Question
            </Button>
          </SpaceBetween>
        }
      >
        Question Bank
      </Header>

      <Container
        header={
          <Header
            variant="h2"
            description="Browse and search your question collection"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Select
                  selectedOption={categoryFilter}
                  onChange={({ detail }) =>
                    setCategoryFilter(detail.selectedOption)
                  }
                  options={[
                    { label: "All Categories", value: "all" },
                    { label: "Technical", value: "technical" },
                    { label: "Behavioral", value: "behavioral" },
                    { label: "Leadership", value: "leadership" },
                    { label: "Problem Solving", value: "problem_solving" },
                  ]}
                />
              </SpaceBetween>
            }
          >
            Questions ({questions.length})
          </Header>
        }
      >
        {questions.length === 0 ? (
          <Box textAlign="center" padding="xxl">
            <Box variant="h2" padding={{ bottom: "s" }}>
              No questions yet
            </Box>
            <Box
              variant="p"
              color="text-body-secondary"
              padding={{ bottom: "s" }}
            >
              Start building your question bank by adding questions or importing
              from CSV
            </Box>
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              Add First Question
            </Button>
          </Box>
        ) : (
          <SpaceBetween size="m">
            <TextFilter
              filteringText={filteringText}
              filteringPlaceholder="Search questions..."
              onChange={({ detail }) => setFilteringText(detail.filteringText)}
            />

            <Cards
              cardDefinition={{
                header: (item) => (
                  <Box>
                    <SpaceBetween direction="horizontal" size="xs">
                      {getCategoryBadge(item.category)}
                      {getDifficultyBadge(item.difficulty)}
                    </SpaceBetween>
                  </Box>
                ),
                sections: [
                  {
                    id: "question",
                    content: (item) => (
                      <Box variant="p">{item.questionText}</Box>
                    ),
                  },
                  {
                    id: "answer",
                    header: "Suggested Answer",
                    content: (item) =>
                      item.suggestedAnswer ? (
                        <Box variant="small" color="text-body-secondary">
                          {item.suggestedAnswer.substring(0, 150)}...
                        </Box>
                      ) : (
                        <Box variant="small" color="text-body-secondary">
                          No suggested answer
                        </Box>
                      ),
                  },
                ],
              }}
              cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }]}
              items={questions}
              loading={loading}
              loadingText="Loading questions"
            />
          </SpaceBetween>
        )}
      </Container>

      {/* Copilot Feature (Coming Soon) */}
      <Container
        header={
          <Header
            variant="h2"
            description="Real-time interview assistance (Coming Soon)"
          >
            Interview Copilot
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box variant="p">
            The Interview Copilot feature will listen to interview questions in
            real-time and suggest relevant answers from your question bank.
          </Box>
          <Button disabled iconName="microphone">
            Start Listening Mode
          </Button>
        </SpaceBetween>
      </Container>

      {/* Add Question Modal */}
      <Modal
        visible={showAddModal}
        onDismiss={() => setShowAddModal(false)}
        header="Add New Question"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAddQuestion}
                disabled={!newQuestion.questionText.trim()}
              >
                Add Question
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Question" stretch>
            <Textarea
              value={newQuestion.questionText}
              onChange={({ detail }) =>
                setNewQuestion({ ...newQuestion, questionText: detail.value })
              }
              placeholder="Enter interview question..."
              rows={4}
            />
          </FormField>

          <FormField label="Category">
            <Input
              value={newQuestion.category}
              onChange={({ detail }) =>
                setNewQuestion({ ...newQuestion, category: detail.value })
              }
              placeholder="e.g., Technical, Behavioral"
            />
          </FormField>

          <FormField label="Difficulty">
            <Select
              selectedOption={{
                label: newQuestion.difficulty,
                value: newQuestion.difficulty,
              }}
              onChange={({ detail }) =>
                setNewQuestion({
                  ...newQuestion,
                  difficulty: detail.selectedOption.value,
                })
              }
              options={[
                { label: "Easy", value: "easy" },
                { label: "Medium", value: "medium" },
                { label: "Hard", value: "hard" },
              ]}
            />
          </FormField>

          <FormField label="Suggested Answer (Optional)" stretch>
            <Textarea
              value={newQuestion.suggestedAnswer}
              onChange={({ detail }) =>
                setNewQuestion({
                  ...newQuestion,
                  suggestedAnswer: detail.value,
                })
              }
              placeholder="Enter a suggested answer..."
              rows={6}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}

export default QuestionBank;
