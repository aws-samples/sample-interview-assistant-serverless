from dotenv import load_dotenv
import logging
import uuid
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from botocore.config import Config
import boto3
from boto3.dynamodb.conditions import Key, Attr


# Load environment variables FIRST before any other imports that depend on them
load_dotenv()


# ============================================================================
# Utility Functions
# ============================================================================


def convert_decimals(obj):
    """
    Convert Decimal objects to int/float for JSON serialization.
    Recursively processes lists and dictionaries.

    Args:
        obj: Object to convert (can be Decimal, dict, list, or any other type)

    Returns:
        Converted object with Decimals replaced by int or float
    """
    if isinstance(obj, list):
        return [convert_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


class LocalDBService:
    def __init__(self, stack_prefix, stack_suffix, profile_name):
        self.logger = logging.getLogger("LocalDatabaseService")

        # Configure boto3 with retries
        config = Config(retries={"max_attempts": 10, "mode": "standard"})

        # Use default credential provider chain - will automatically use pod's IAM role
        self.dynamodb = boto3.resource("dynamodb", config=config)

        # if stack_prefix and stack_suffix are not provided, use default values
        if stack_prefix is None:
            self.stack_prefix = "SPEECH-TO-SPEECH"
        else:
            self.stack_prefix = stack_prefix
        if stack_suffix is None:
            self.stack_suffix = "DEV"
        else:
            self.stack_suffix = stack_suffix

        self.feedback_table = self.dynamodb.Table(
            f"{self.stack_prefix}-FEEDBACK-{self.stack_suffix}"
        )
        self.user_table = self.dynamodb.Table(
            f"{self.stack_prefix}-USERROLE-{self.stack_suffix}"
        )
        self.files_table = self.dynamodb.Table(
            f"{self.stack_prefix}-DOCUMENTUPLOAD-{self.stack_suffix}"
        )
        self.session_history_table = self.dynamodb.Table(
            f"{self.stack_prefix}-SESSION-HISTORY-{self.stack_suffix}"
        )
        self.session_prep_table = self.dynamodb.Table(
            f"{self.stack_prefix}-SESSION-PREP-{self.stack_suffix}"
        )

    #   self.interview_questions_table = self.dynamodb.Table(f'{self.stack_prefix}-INTERVIEW-QUESTIONS-{self.stack_suffix}')
    #   self.interview_answers_table = self.dynamodb.Table(f'{self.stack_prefix}-INTERVIEW-ANSWERS-{self.stack_suffix}')
    #   self.interview_feedback_table = self.dynamodb.Table(f'{self.stack_prefix}-INTERVIEW-FEEDBACK-{self.stack_suffix}')

    def validate_user_id(self, user_id):
        """
        Validates if the user_id is not None, empty, or 'anonymous'
        Returns a tuple (is_valid, error_message)
        """
        if (
            not user_id
            or user_id.lower() == "anonymous"
            or user_id.lower() == "unknown"
        ):
            self.logger.warning(f"Invalid user_id: {user_id}")
            return False, "For unknown users this information cannot be retrieved"
        return True, None

    def add_feedback(self, messageId, message, feedback, userId, sessionId, timestamp):
        # Validate userId
        is_valid, error_message = self.validate_user_id(userId)
        if not is_valid:
            return {"error": error_message, "status": "unauthorized"}

        item = {
            "messageId": messageId,
            "message": message,
            "feedback": feedback,
            "userId": userId,
            "sessionId": sessionId,
            "timestamp": timestamp,
        }
        self.feedback_table.put_item(Item=item)
        return item

    def get_feedback(self, messageId):
        response = self.feedback_table.get_item(Key={"messageId": messageId})
        self.logger.info(f"Database Response: {response}")
        return response.get("Item", {})

    def get_feedbacks(self):
        response = self.feedback_table.scan()
        self.logger.info(f"Database Response: {response}")
        return response.get("Items", [])

    # def save_interview_answer(self, userId, sessionId, interviewQuestion, interviewAnswer):
    #     # save the interview answer to the database
    #     try:
    #         # First check if an item with the same userId, sessionId, and interviewQuestion already exists
    #         response = self.interview_answers_table.scan(
    #             FilterExpression=Attr('userId').eq(userId) &
    #                             Attr('sessionId').eq(sessionId) &
    #                             Attr('interviewQuestion').eq(interviewQuestion)
    #         )

    #         items = response.get('Items', [])

    #         # Current timestamp
    #         timestamp = int(time.time() * 1000)

    #         if items:
    #             # Item exists, update it by appending the new answer
    #             existing_item = items[0]
    #             question_id = existing_item['questionId']
    #             existing_answer = existing_item.get('interviewAnswer', '')

    #             # Append the new answer to the existing answer with a separator
    #             combined_answer = f"{existing_answer}\n\nAdditional response:\n{interviewAnswer}"

    #             # Update the item
    #             # Use ExpressionAttributeNames to handle the reserved keyword 'ttl'
    #             self.interview_answers_table.update_item(
    #                 Key={
    #                     'questionId': question_id
    #                 },
    #                 UpdateExpression="set interviewAnswer = :a, createdAt = :t, #ttl_attr = :ttl",
    #                 ExpressionAttributeValues={
    #                     ':a': combined_answer,
    #                     ':t': timestamp,
    #                     ':ttl': int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
    #                 },
    #                 ExpressionAttributeNames={
    #                     '#ttl_attr': 'ttl'
    #                 }
    #             )

    #             # Return the updated item
    #             return {
    #                 'questionId': question_id,
    #                 'userId': userId,
    #                 'sessionId': sessionId,
    #                 'interviewQuestion': interviewQuestion,
    #                 'interviewAnswer': combined_answer,
    #                 'createdAt': timestamp,
    #                 'ttl': int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
    #             }
    #         else:
    #             # No existing item, create a new one
    #             question_id = str(uuid.uuid4())

    #             item = {
    #                 'questionId': question_id,
    #                 'userId': userId,
    #                 'sessionId': sessionId,
    #                 'interviewQuestion': interviewQuestion,
    #                 'interviewAnswer': interviewAnswer,
    #                 'createdAt': timestamp,
    #                 'ttl': int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
    #             }
    #             self.interview_answers_table.put_item(Item=item)
    #             return item

    #     except Exception as e:
    #         self.logger.error(f"Error saving interview answer: {e}")
    #         return None

    # def save_interview_feedback(self, userId, sessionId, interviewFeedback):
    #     # save the interview answer to the database
    #     try:
    #         # Generate a unique ID for the file reference
    #         interviewfeedback_id = str(uuid.uuid4())

    #         # Current timestamp
    #         timestamp = int(time.time() * 1000)

    #         item = {
    #             'interviewfeedbackId': interviewfeedback_id,
    #             'userId': userId,
    #             'sessionId': sessionId,
    #             'interviewFeedback': interviewFeedback,
    #             'createdAt': timestamp,
    #             'ttl': int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
    #         }
    #         self.interview_feedback_table.put_item(Item=item)
    #         return item

    #     except Exception as e:
    #         self.logger.error(f"Error saving interview feedback: {e}")
    #         return None

    # def get_interview_feedback(self, userId, sessionId):
    #     """
    #     Retrieve interview feedback for a specific user and session.

    #     Args:
    #         userId: User ID
    #         sessionId: Session ID

    #     Returns:
    #         List of interview feedback items ordered by creation time
    #     """
    #     try:
    #         # Query the interview feedback table
    #         response = self.interview_feedback_table.scan(
    #             FilterExpression=Attr('userId').eq(userId) & Attr('sessionId').eq(sessionId)
    #         )

    #         # Get items and sort by createdAt in ascending order
    #         items = response.get('Items', [])
    #         if not items:
    #             return None

    #         # Sort by creation time
    #         sorted_items = sorted(items, key=lambda x: x.get('createdAt', 0))

    #         return [item['interviewFeedback'] for item in sorted_items]

    #     except Exception as e:
    #         self.logger.error(f"Error retrieving interview feedback: {e}")
    #         return None

    # Interview Plan Methods

    def save_interview_plan(
        self,
        user_id: str,
        plan_id: str,
        company_name: Optional[str],
        job_title: Optional[str],
        interview_type: str,
        resume_summary: str,
        jd_summary: str,
        company_research: dict,
        questions: list,
        preparation_tips: list,
        interview_stage: str = "practice",
        scheduled_date: Optional[str] = None,
        scheduled_time: Optional[str] = None,
        interview_name: Optional[str] = None,
        status: str = "completed",
        job_params: Optional[dict] = None,
    ) -> dict:
        """
        Save interview plan to DynamoDB

        Now supports both immediate saves (status='completed') and async job creation (status='pending')

        Args:
            interview_stage: "practice" for candidate practice plans, "scheduled" for interviewer scheduled interviews
            scheduled_date: (Optional) Scheduled date for interviewer interviews (e.g., "2025-01-15")
            scheduled_time: (Optional) Scheduled time for interviewer interviews (e.g., "14:00")
            interview_name: (Optional) Interview name/title (e.g., "Amazon - Senior Engineer Interview")
            status: Job/plan status - 'pending', 'processing', 'completed', 'failed'
            job_params: (Optional) Job parameters stored when status='pending' for async processing
        """
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return {"error": error_message, "status": "unauthorized"}

        try:
            timestamp = int(time.time() * 1000)

            item = {
                "userId": user_id,
                "itemId": f"PLAN#{plan_id}",
                "companyName": company_name,
                "jobTitle": job_title,
                "interviewType": interview_type,
                "interviewStage": interview_stage,  # New field to distinguish practice vs scheduled
                "resumeSummary": resume_summary,
                "jdSummary": jd_summary,
                "companyResearch": company_research,
                "questions": questions,
                "preparationTips": preparation_tips,
                "status": status,  # Add status field for async job tracking
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "ttl": int(
                    (datetime.now(timezone.utc) + timedelta(days=30)).timestamp()
                ),
            }

            # Add optional scheduling fields (only for interviewer scheduled interviews)
            if scheduled_date:
                item["scheduledDate"] = scheduled_date
            if scheduled_time:
                item["scheduledTime"] = scheduled_time
            if interview_name:
                item["interviewName"] = interview_name

            # Add job parameters for async processing (stored when status='pending')
            if job_params:
                item["jobParams"] = job_params

            self.session_prep_table.put_item(Item=item)
            return {
                "planId": plan_id,
                "userId": user_id,
                "companyName": company_name,
                "jobTitle": job_title,
                "interviewType": interview_type,
                "interviewStage": interview_stage,
                "scheduledDate": scheduled_date,
                "scheduledTime": scheduled_time,
                "interviewName": interview_name,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        except Exception as e:
            self.logger.error(f"Error saving interview plan: {e}")
            raise

    def get_interview_plans(
        self, user_id: str, interview_stage_filter: Optional[str] = None
    ) -> list:
        """
        Get all interview plans for a user, optionally filtered by interview stage

        Args:
            user_id: The user ID to query
            interview_stage_filter: Optional filter:
                - "practice": Only candidate practice plans
                - "scheduled": Only interviewer scheduled interviews
                - None: All plans (no filtering)

        Returns:
            List of interview plans matching the criteria
        """
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return []

        try:
            response = self.session_prep_table.query(
                KeyConditionExpression=Key("userId").eq(user_id)
                & Key("itemId").begins_with("PLAN#")
            )

            items = response.get("Items", [])
            # Convert Decimals to int/float
            items = [convert_decimals(item) for item in items]

            # Filter by interview stage if specified
            if interview_stage_filter:
                items = [
                    item
                    for item in items
                    if item.get("interviewStage") == interview_stage_filter
                ]
                self.logger.info(
                    f"Filtered to {len(items)} items with interviewStage={interview_stage_filter}"
                )

            # Filter by status - only return completed plans (ready for use)
            items = [item for item in items if item.get("status") == "completed"]
            self.logger.info(f"Filtered to {len(items)} completed plans")

            # Sort by createdAt descending (most recent first)
            sorted_items = sorted(
                items, key=lambda x: x.get("createdAt", 0), reverse=True
            )

            return [
                {
                    "id": item["itemId"].replace("PLAN#", ""),
                    "timestamp": datetime.fromtimestamp(
                        item["createdAt"] / 1000, tz=timezone.utc
                    ).isoformat(),
                    "companyName": item.get("companyName"),
                    "jobTitle": item.get("jobTitle"),
                    "interviewType": item.get("interviewType"),
                    "interviewStage": item.get("interviewStage"),
                    "status": item.get(
                        "status"
                    ),  # Include status field in returned data
                    "questionCount": len(item.get("questions", [])),
                    # Optional scheduling fields (only present for interviewer scheduled interviews)
                    "scheduledDate": item.get("scheduledDate"),
                    "scheduledTime": item.get("scheduledTime"),
                    "interviewName": item.get("interviewName"),
                    # Include full interview plan with questions for frontend display
                    "interviewPlan": {"questions": item.get("questions", [])},
                }
                for item in sorted_items
            ]
        except Exception as e:
            self.logger.error(f"Error getting interview plans: {e}")
            return []

    def get_interview_plan_by_id(self, user_id: str, plan_id: str) -> dict:
        """Get specific interview plan by ID"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return None

        try:
            response = self.session_prep_table.get_item(
                Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"}
            )

            item = response.get("Item")
            if not item:
                return None

            # Convert Decimals to int/float
            item = convert_decimals(item)

            return {
                "id": plan_id,
                "userId": user_id,
                "timestamp": datetime.fromtimestamp(
                    item["createdAt"] / 1000, tz=timezone.utc
                ).isoformat(),
                "companyName": item.get("companyName"),
                "jobTitle": item.get("jobTitle"),
                "interviewType": item.get("interviewType"),
                "resumeSummary": item.get("resumeSummary"),
                "jdSummary": item.get("jdSummary"),
                "companyResearch": item.get("companyResearch"),
                "questions": item.get("questions"),
                "preparationTips": item.get("preparationTips"),
                # Scheduling fields (for interviewer scheduled interviews)
                "interviewName": item.get("interviewName"),
                "scheduledDate": item.get("scheduledDate"),
                "scheduledTime": item.get("scheduledTime"),
                "interviewStage": item.get("interviewStage"),
                "status": item.get(
                    "status", "scheduled"
                ),  # Default to 'scheduled' if not set
            }
        except Exception as e:
            self.logger.error(f"Error getting interview plan by ID: {e}")
            return None

    def update_interview_plan_status(
        self,
        user_id: str,
        plan_id: str,
        status: str,
        error_message: Optional[str] = None,
    ) -> None:
        """
        Update the status of an interview plan (for async job tracking)

        Args:
            user_id: User ID
            plan_id: Plan ID
            status: New status ('pending', 'processing', 'completed', 'failed')
            error_message: Optional error message if status is 'failed'
        """
        try:
            timestamp = int(time.time() * 1000)

            update_expr = "set #status = :status, updatedAt = :updated"
            expr_values = {":status": status, ":updated": timestamp}
            expr_names = {"#status": "status"}

            if error_message:
                update_expr += ", errorMessage = :error"
                expr_values[":error"] = error_message

            self.session_prep_table.update_item(
                Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
                ExpressionAttributeNames=expr_names,
            )
        except Exception as e:
            self.logger.error(f"Error updating interview plan status: {e}")
            raise

    def update_interview_plan_question_statuses(
        self,
        user_id: str,
        plan_id: str,
        question_statuses: dict,
    ) -> None:
        """
        Update question progression statuses in the interview plan.

        This updates the status, startTime, and endTime fields for each question
        in the questions array based on the live interview tracking data.

        Args:
            user_id: User ID
            plan_id: Plan ID (interviewId)
            question_statuses: Dictionary mapping question IDs to status objects
                Example: {
                    "q0": {"status": "completed", "startTime": 123456, "endTime": 123789},
                    "q1": {"status": "in_progress", "startTime": 123790}
                }
        """
        try:
            # First, get the current interview plan
            response = self.session_prep_table.get_item(
                Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"}
            )

            item = response.get("Item")
            if not item:
                self.logger.warning(
                    f"Interview plan {plan_id} not found for question status update"
                )
                return

            # Get existing questions array
            questions = item.get("questions", [])
            if not questions:
                self.logger.warning(f"No questions found in interview plan {plan_id}")
                return

            # Update each question's status fields based on question_statuses
            updated = False
            for question in questions:
                question_id = question.get("questionId")
                if question_id and question_id in question_statuses:
                    status_data = question_statuses[question_id]

                    # Update status if provided
                    if "status" in status_data:
                        question["status"] = status_data["status"]
                        updated = True

                    # Update startTime if provided
                    if "startTime" in status_data:
                        question["startTime"] = status_data["startTime"]
                        updated = True

                    # Update endTime if provided
                    if "endTime" in status_data:
                        question["endTime"] = status_data["endTime"]
                        updated = True

                    self.logger.info(
                        f"Updated question {question_id}: status={status_data.get('status')}"
                    )

            if updated:
                # Save the updated questions array back to DynamoDB
                timestamp = int(time.time() * 1000)
                self.session_prep_table.update_item(
                    Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"},
                    UpdateExpression="set questions = :questions, updatedAt = :updated",
                    ExpressionAttributeValues={
                        ":questions": questions,
                        ":updated": timestamp,
                    },
                )
                self.logger.info(
                    f"Successfully updated question statuses for interview plan {plan_id}"
                )
            else:
                self.logger.info(
                    f"No question status updates needed for interview plan {plan_id}"
                )

        except Exception as e:
            self.logger.error(f"Error updating interview plan question statuses: {e}")
            raise

    def complete_interview_plan(
        self,
        user_id: str,
        plan_id: str,
        resume_summary: str,
        jd_summary: str,
        company_research: dict,
        questions: list,
        preparation_tips: list,
    ) -> None:
        """
        Complete generation of interview plan by adding the generated content.
        Sets status to 'generated' (not 'completed' - that happens when user explicitly saves)

        Args:
            user_id: User ID
            plan_id: Plan ID
            resume_summary: Generated resume summary
            jd_summary: Generated JD summary
            company_research: Generated company research
            questions: Generated questions list
            preparation_tips: Generated preparation tips
        """
        try:
            timestamp = int(time.time() * 1000)

            self.session_prep_table.update_item(
                Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"},
                UpdateExpression="""set #status = :status, resumeSummary = :resume,
                                    jdSummary = :jd, companyResearch = :research,
                                    questions = :questions, preparationTips = :tips,
                                    updatedAt = :updated, generatedAt = :generated""",
                ExpressionAttributeValues={
                    ":status": "generated",  # Changed from 'completed' - user must explicitly save
                    ":resume": resume_summary,
                    ":jd": jd_summary,
                    ":research": company_research,
                    ":questions": questions,
                    ":tips": preparation_tips,
                    ":updated": timestamp,
                    ":generated": timestamp,
                },
                ExpressionAttributeNames={"#status": "status"},
            )
        except Exception as e:
            self.logger.error(f"Error completing interview plan generation: {e}")
            raise

    def mark_interview_plan_as_saved(self, user_id: str, plan_id: str) -> None:
        """
        Mark an interview plan as saved/completed when user explicitly clicks save.
        Updates status from 'generated' to 'completed'

        Args:
            user_id: User ID
            plan_id: Plan ID
        """
        try:
            timestamp = int(time.time() * 1000)

            self.session_prep_table.update_item(
                Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"},
                UpdateExpression="set #status = :status, updatedAt = :updated, savedAt = :saved",
                ExpressionAttributeValues={
                    ":status": "completed",
                    ":updated": timestamp,
                    ":saved": timestamp,
                },
                ExpressionAttributeNames={"#status": "status"},
            )
            self.logger.info(f"Marked plan {plan_id} as saved/completed")
        except Exception as e:
            self.logger.error(f"Error marking interview plan as saved: {e}")
            raise

    def delete_interview_plan(self, user_id: str, plan_id: str) -> bool:
        """Delete an interview plan"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return False

        try:
            self.session_prep_table.delete_item(
                Key={"userId": user_id, "itemId": f"PLAN#{plan_id}"}
            )
            return True
        except Exception as e:
            self.logger.error(f"Error deleting interview plan: {e}")
            return False

    # Practice Session Methods

    def save_practice_session(
        self,
        user_id: str,
        session_id: str,
        prep_id: str,
        duration: float,
        audio_size: int = 0,  # Deprecated, kept for backward compatibility
        metadata: Optional[dict] = None,
        audio_location: Optional[str] = None,
        audio_url: Optional[str] = None,
    ) -> dict:
        """
        Save practice session to DynamoDB with optional S3 audio reference.

        Note: Removed obsolete fields:
        - audioSize, messageCount (PATH A video capture)
        - transcription (replaced by transcriptArray in metadata)

        Transcript data should be stored in metadata as 'transcriptArray' for structured speaker data.
        Audio is now embedded in video recordings (PATH B).
        """
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return {"error": error_message, "status": "unauthorized"}

        try:
            timestamp = int(time.time() * 1000)

            item = {
                "userId": user_id,
                "itemId": f"SESSION#{session_id}",
                "sessionId": session_id,
                "prepId": prep_id,
                "duration": duration,
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "ttl": int(
                    (datetime.now(timezone.utc) + timedelta(days=30)).timestamp()
                ),
            }

            # Add S3 audio reference if provided (for legacy practice sessions)
            if audio_location:
                item["audioLocation"] = audio_location
            if audio_url:
                item["audioUrl"] = audio_url

            # Add any additional metadata
            if metadata:
                item.update(metadata)

            self.session_history_table.put_item(Item=item)
            return {
                "sessionId": session_id,
                "userId": user_id,
                "prepId": prep_id,
                "duration": duration,
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "status": "success",
            }
        except Exception as e:
            self.logger.error(f"Error saving practice session: {e}")
            raise

    def get_practice_sessions(self, user_id: str) -> list:
        """Get all practice sessions for a user"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return []

        try:
            response = self.session_history_table.query(
                KeyConditionExpression=Key("userId").eq(user_id)
                & Key("itemId").begins_with("SESSION#session")
            )

            items = response.get("Items", [])
            # Convert Decimals to int/float
            items = [convert_decimals(item) for item in items]

            # Sort by createdAt descending (most recent first)
            sorted_items = sorted(
                items, key=lambda x: x.get("createdAt", 0), reverse=True
            )

            return [
                {
                    "id": item["itemId"].replace("SESSION#", ""),
                    "sessionId": item.get("sessionId"),
                    "prepId": item.get("prepId"),
                    "timestamp": datetime.fromtimestamp(
                        item["createdAt"] / 1000, tz=timezone.utc
                    ).isoformat(),
                    "createdAt": datetime.fromtimestamp(
                        item["createdAt"] / 1000, tz=timezone.utc
                    ).isoformat(),
                    "duration": item.get("duration"),
                    "status": "completed",
                    "analysis": item.get("analysis"),
                    "analysisStatus": item.get("analysisStatus"),
                }
                for item in sorted_items
            ]
        except Exception as e:
            self.logger.error(f"Error getting practice sessions: {e}")
            return []

    def get_practice_session_by_id(self, user_id: str, session_id: str) -> dict:
        """Get specific practice session by ID with audio information"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return None

        try:
            import json

            response = self.session_history_table.get_item(
                Key={"userId": user_id, "itemId": f"SESSION#{session_id}"}
            )

            item = response.get("Item")
            if not item:
                return None

            # Convert Decimals to int/float
            item = convert_decimals(item)

            # Parse analysis JSON if present
            analysis_data = None
            analysis_status = "pending"
            if "analysis" in item:
                try:
                    analysis_data = json.loads(item["analysis"])
                    analysis_status = item.get("analysisStatus", "completed")
                except Exception as parse_error:
                    self.logger.warning(f"Failed to parse analysis JSON: {parse_error}")

            result = {
                "sessionId": item.get("sessionId"),
                "userId": user_id,
                "prepId": item.get("prepId"),
                "timestamp": datetime.fromtimestamp(
                    item["createdAt"] / 1000, tz=timezone.utc
                ).isoformat(),
                "createdAt": datetime.fromtimestamp(
                    item["createdAt"] / 1000, tz=timezone.utc
                ).isoformat(),
                "duration": item.get("duration"),
                "transcription": item.get("transcription"),
                "analysisStatus": analysis_status,
            }

            # Add transcriptArray from metadata if available (structured transcript with roles)
            if item.get("transcriptArray"):
                result["transcriptArray"] = item.get("transcriptArray")

            # Add audio information if available
            if item.get("audioLocation"):
                result["audioLocation"] = item.get("audioLocation")
            if item.get("audioUrl"):
                result["audioUrl"] = item.get("audioUrl")

            # Add analysis if available
            if analysis_data:
                result["analysis"] = analysis_data

            return result
        except Exception as e:
            self.logger.error(f"Error getting practice session by ID: {e}")
            return None

    def delete_practice_session(self, user_id: str, session_id: str) -> bool:
        """Delete a practice session"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return False

        try:
            self.session_history_table.delete_item(
                Key={"userId": user_id, "itemId": f"SESSION#{session_id}"}
            )
            return True
        except Exception as e:
            self.logger.error(f"Error deleting practice session: {e}")
            return False

    def save_interview_analysis(
        self, user_id: str, session_id: str, analysis_data: dict
    ) -> dict:
        """Update existing session with analysis results"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return {"error": error_message, "status": "unauthorized"}

        try:
            import json

            timestamp = int(time.time() * 1000)

            # Convert analysis_data to JSON string to ensure proper serialization
            analysis_json_str = json.dumps(analysis_data, default=str)

            # Update the existing SESSION record with analysis data
            self.session_history_table.update_item(
                Key={"userId": user_id, "itemId": f"SESSION#{session_id}"},
                UpdateExpression="set analysis = :analysis, analysisStatus = :status, analysisCompletedAt = :completedAt",
                ExpressionAttributeValues={
                    ":analysis": analysis_json_str,
                    ":status": "completed",
                    ":completedAt": timestamp,
                },
            )

            return {
                "sessionId": session_id,
                "userId": user_id,
                "overallScore": analysis_data.get("overall_score"),
                "analysisStatus": "completed",
                "completedAt": timestamp,
                "status": "success",
            }
        except Exception as e:
            self.logger.error(f"Error saving interview analysis: {e}")
            raise

    def get_interview_sessions(
        self, user_id: str, session_prefix: str = "interviewer"
    ) -> list:
        """
        Get all interview sessions for a user filtered by session type.

        Args:
            user_id: User email or identifier
            session_prefix: Session type prefix ('interviewer' for interviewer sessions, 'candidate' for candidate sessions)

        Returns:
            List of interview session dictionaries
        """
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return []

        try:
            query_prefix = f"SESSION#{session_prefix}"
            self.logger.info(
                f"Querying interview sessions for user: {user_id} with prefix: {query_prefix}"
            )

            response = self.session_history_table.query(
                KeyConditionExpression=Key("userId").eq(user_id)
                & Key("itemId").begins_with(query_prefix)
            )

            items = response.get("Items", [])
            self.logger.info(
                f"Found {len(items)} sessions with prefix {session_prefix}"
            )

            # Convert Decimals to int/float
            items = [convert_decimals(item) for item in items]

            # Sort by createdAt descending (most recent first)
            sorted_items = sorted(
                items, key=lambda x: x.get("createdAt", 0), reverse=True
            )

            return [
                {
                    "id": item["itemId"]
                    .replace(f"SESSION#{session_prefix}", "")
                    .lstrip("_"),
                    "sessionId": item.get("sessionId"),
                    "interviewId": item.get("interviewId"),
                    "interviewName": item.get("interviewName"),
                    "isInterviewerSession": item.get("isInterviewerSession"),
                    "isCandidateInterviewSession": item.get(
                        "isCandidateInterviewSession"
                    ),
                    "summary": item.get("summary"),
                    "timestamp": datetime.fromtimestamp(
                        item["createdAt"] / 1000, tz=timezone.utc
                    ).isoformat(),
                    "createdAt": datetime.fromtimestamp(
                        item["createdAt"] / 1000, tz=timezone.utc
                    ).isoformat(),
                    "duration": item.get("duration"),
                }
                for item in sorted_items
            ]
        except Exception as e:
            self.logger.error(f"Error getting interview sessions: {e}")
            return []

    def get_interview_session_by_id(self, user_id: str, session_id: str) -> dict:
        """Get specific interview session by ID with audio information"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return None

        try:
            import json

            response = self.session_history_table.get_item(
                Key={"userId": user_id, "itemId": f"SESSION#{session_id}"}
            )

            item = response.get("Item")
            if not item:
                return None

            # Convert Decimals to int/float
            item = convert_decimals(item)

            # Extract session prefix for proper ID formatting
            item_id = item["itemId"]
            # Remove SESSION# prefix and any session type prefix (interviewer_, candidate_, etc.)
            session_id_clean = item_id.replace("SESSION#", "")

            return {
                "id": session_id_clean,
                "sessionId": item.get("sessionId"),
                "interviewId": item.get("interviewId"),
                "interviewName": item.get("interviewName"),
                "isInterviewerSession": item.get("isInterviewerSession"),
                "isCandidateInterviewSession": item.get("isCandidateInterviewSession"),
                "summary": item.get("summary"),
                "timestamp": datetime.fromtimestamp(
                    item["createdAt"] / 1000, tz=timezone.utc
                ).isoformat(),
                "createdAt": datetime.fromtimestamp(
                    item["createdAt"] / 1000, tz=timezone.utc
                ).isoformat(),
                "duration": item.get("duration"),
                "durationFormatted": item.get("durationFormatted"),
                "status": item.get("status", "completed"),
                # Removed: 'transcript': item.get('transcription'),  # Deprecated - no longer stored in DynamoDB
                "transcriptArray": item.get(
                    "transcriptArray"
                ),  # Structured transcript with speakers
                "videoLocation": item.get(
                    "videoLocation"
                ),  # PATH B: Full video recording from MediaRecorder
                "videoFormat": item.get(
                    "videoFormat", "webm"
                ),  # Video format (webm or mp4)
            }

        except Exception as e:
            self.logger.error(f"Error getting interview session by ID: {e}")
            return None

    def delete_interview_session(self, user_id: str, session_id: str) -> bool:
        """Delete a interview session"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return False

        try:
            self.session_history_table.delete_item(
                Key={"userId": user_id, "itemId": f"SESSION#{session_id}"}
            )
            return True
        except Exception as e:
            self.logger.error(f"Error deleting interview session: {e}")
            return False

    # Async Job Tracking Methods

    def create_job(
        self,
        user_id: str,
        job_id: str,
        job_type: str,
        job_params: Optional[dict] = None,
    ) -> dict:
        """Create a new async job record"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return {"error": error_message, "status": "unauthorized"}

        try:
            timestamp = int(time.time() * 1000)

            item = {
                "userId": user_id,
                "itemId": f"JOB#{job_id}",
                "jobId": job_id,
                "jobType": job_type,
                "status": "pending",
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "ttl": int(
                    (datetime.now(timezone.utc) + timedelta(hours=24)).timestamp()
                ),
            }

            if job_params:
                item["jobParams"] = job_params

            self.session_prep_table.put_item(Item=item)
            return {
                "jobId": job_id,
                "userId": user_id,
                "jobType": job_type,
                "status": "pending",
                "createdAt": timestamp,
            }
        except Exception as e:
            self.logger.error(f"Error creating job: {e}")
            raise

    def update_job_status(
        self,
        user_id: str,
        job_id: str,
        status: str,
        error_message: Optional[str] = None,
    ) -> dict:
        """Update job status (pending, processing, completed, failed)"""
        is_valid, error_msg = self.validate_user_id(user_id)
        if not is_valid:
            return {"error": error_msg, "status": "unauthorized"}

        try:
            timestamp = int(time.time() * 1000)

            update_expr = "set #status = :status, updatedAt = :updated"
            expr_values = {":status": status, ":updated": timestamp}
            expr_names = {"#status": "status"}

            if error_message:
                update_expr += ", errorMessage = :error"
                expr_values[":error"] = error_message

            self.session_prep_table.update_item(
                Key={"userId": user_id, "itemId": f"JOB#{job_id}"},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
                ExpressionAttributeNames=expr_names,
            )

            return {"jobId": job_id, "status": status, "updatedAt": timestamp}
        except Exception as e:
            self.logger.error(f"Error updating job status: {e}")
            raise

    def update_job_result(self, user_id: str, job_id: str, result: dict) -> dict:
        """Update job with result data and mark as completed"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return {"error": error_message, "status": "unauthorized"}

        try:
            import json

            timestamp = int(time.time() * 1000)

            # Store result as JSON string to handle nested structures
            result_json = json.dumps(result, default=str)

            self.session_prep_table.update_item(
                Key={"userId": user_id, "itemId": f"JOB#{job_id}"},
                UpdateExpression="set #status = :status, #result = :result, updatedAt = :updated, completedAt = :completed",
                ExpressionAttributeValues={
                    ":status": "completed",
                    ":result": result_json,
                    ":updated": timestamp,
                    ":completed": timestamp,
                },
                ExpressionAttributeNames={"#status": "status", "#result": "result"},
            )

            return {"jobId": job_id, "status": "completed", "completedAt": timestamp}
        except Exception as e:
            self.logger.error(f"Error updating job result: {e}")
            raise

    def get_job_by_id(self, user_id: str, job_id: str) -> Optional[dict]:
        """Get job status and results by ID"""
        is_valid, error_message = self.validate_user_id(user_id)
        if not is_valid:
            return None

        try:
            import json

            response = self.session_prep_table.get_item(
                Key={"userId": user_id, "itemId": f"JOB#{job_id}"}
            )

            item = response.get("Item")
            if not item:
                return None

            # Convert Decimals to int/float
            item = convert_decimals(item)

            result = {
                "jobId": job_id,
                "userId": user_id,
                "jobType": item.get("jobType"),
                "status": item.get("status"),
                "createdAt": item.get("createdAt"),
                "updatedAt": item.get("updatedAt"),
            }

            # Add result if present
            if "result" in item:
                try:
                    result["result"] = json.loads(item["result"])
                except Exception as parse_error:
                    self.logger.warning(
                        f"Failed to parse job result JSON: {parse_error}"
                    )
                    result["result"] = item["result"]

            # Add error message if present
            if "errorMessage" in item:
                result["errorMessage"] = item.get("errorMessage")

            # Add completed timestamp if present
            if "completedAt" in item:
                result["completedAt"] = item.get("completedAt")

            return result
        except Exception as e:
            self.logger.error(f"Error getting job by ID: {e}")
            return None
