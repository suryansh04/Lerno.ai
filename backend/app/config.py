import os

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
# A comma-separated list: the live site and local development.
FRONTEND_URLS = [url.strip().rstrip("/") for url in os.environ["FRONTEND_URL"].split(",")]
IS_PRODUCTION = os.environ.get("ENVIRONMENT", "production") == "production"
# Optional: without it, lessons are made without a voice.
MURF_API_KEY = os.environ.get("MURF_API_KEY")

SCENES_PER_LESSON = 3
DAILY_LESSON_LIMIT = 3
# Failed lessons are free but still cost us, so all tries have their own limit.
DAILY_ATTEMPT_LIMIT = 6
GLOBAL_DAILY_LESSON_LIMIT = 50
NOTES_PER_LESSON_LIMIT = 100
TUTOR_MESSAGE_LIMIT = 20
STALE_AFTER_MINUTES = 25
VIDEO_BUCKET = "videos"
VIDEO_URL_TTL_SECONDS = 3600
THUMBNAIL_BUCKET = "thumbnails"
# A thumbnail never changes once made, so browsers may keep it for good.
THUMBNAIL_CACHE_SECONDS = 365 * 24 * 3600
