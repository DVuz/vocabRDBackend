-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "vocabnew";

-- CreateEnum
CREATE TYPE "user_provider" AS ENUM ('google', 'local');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin', 'teacher');

-- CreateEnum
CREATE TYPE "user_status_type" AS ENUM ('active', 'banned', 'pending');

-- CreateEnum
CREATE TYPE "user_word_status" AS ENUM ('new', 'learning', 'familiar', 'mastered', 'forgotten');

-- CreateEnum
CREATE TYPE "queue_status" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "session_type" AS ENUM ('flashcard', 'multiple_choice', 'typing', 'mixed');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('daily_queue', 'word_list', 'manual');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('in_progress', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('definition_to_word', 'word_to_definition', 'fill_blank', 'audio_to_word');

-- CreateEnum
CREATE TYPE "tts_provider" AS ENUM ('elevenlabs');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "image" VARCHAR(500),
    "provider" "user_provider" NOT NULL DEFAULT 'local',
    "role" "user_role" NOT NULL DEFAULT 'user',
    "status" "user_status_type" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "words" (
    "id" SERIAL NOT NULL,
    "word" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_meanings" (
    "id" SERIAL NOT NULL,
    "word_id" INTEGER NOT NULL,
    "definition" TEXT NOT NULL,
    "vn_definition" TEXT NOT NULL DEFAULT '',
    "part_of_speech" VARCHAR(50),
    "examples" JSONB,
    "cefr_level" VARCHAR(10),
    "uk_ipa" VARCHAR(100),
    "us_ipa" VARCHAR(100),
    "uk_audio_url" VARCHAR(500),
    "us_audio_url" VARCHAR(500),
    "tts_audio_url" VARCHAR(500),
    "tts_public_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_meanings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tts_configs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "provider" "tts_provider" NOT NULL DEFAULT 'elevenlabs',
    "api_key" VARCHAR(500) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tts_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tts_voice_models" (
    "id" SERIAL NOT NULL,
    "config_id" INTEGER NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "voice_id" VARCHAR(120) NOT NULL,
    "model_id" VARCHAR(120) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tts_voice_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_words" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "word_meaning_id" INTEGER NOT NULL,
    "status" "user_word_status" NOT NULL DEFAULT 'new',
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_reviewed_at" TIMESTAMP(3),
    "next_review_at" TIMESTAMP(3),
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "incorrect_count" INTEGER NOT NULL DEFAULT 0,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "max_streak" INTEGER NOT NULL DEFAULT 0,
    "ease_factor" DECIMAL(4,2) NOT NULL DEFAULT 2.50,
    "interval_days" INTEGER NOT NULL DEFAULT 1,
    "personal_note" TEXT,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_lists" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "word_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_list_items" (
    "id" SERIAL NOT NULL,
    "list_id" INTEGER NOT NULL,
    "word_meaning_id" INTEGER NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_review_queue" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "review_date" DATE NOT NULL,
    "word_meaning_ids" JSONB,
    "total_words" INTEGER NOT NULL DEFAULT 0,
    "new_words" INTEGER NOT NULL DEFAULT 0,
    "review_words" INTEGER NOT NULL DEFAULT 0,
    "status" "queue_status" NOT NULL DEFAULT 'pending',
    "completed_words" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_review_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_sessions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "session_type" "session_type" NOT NULL DEFAULT 'flashcard',
    "source_type" "source_type" NOT NULL DEFAULT 'daily_queue',
    "source_id" BIGINT,
    "total_questions" INTEGER NOT NULL DEFAULT 0,
    "correct_answers" INTEGER NOT NULL DEFAULT 0,
    "incorrect_answers" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "score_percent" DECIMAL(5,2),
    "duration_seconds" INTEGER,
    "avg_time_per_word_ms" INTEGER,
    "status" "session_status" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "review_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_aliases" (
    "id" SERIAL NOT NULL,
    "alias" VARCHAR(100) NOT NULL,
    "canonical_word" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_session_items" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "user_word_id" INTEGER NOT NULL,
    "question_type" "question_type" DEFAULT 'word_to_definition',
    "user_answer" TEXT,
    "is_correct" BOOLEAN,
    "time_taken_ms" INTEGER,
    "streak_before" INTEGER,
    "ease_before" DECIMAL(4,2),
    "interval_before" INTEGER,
    "streak_after" INTEGER,
    "ease_after" DECIMAL(4,2),
    "interval_after" INTEGER,
    "answered_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_session_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_revoked_at_idx" ON "refresh_tokens"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "words_word_key" ON "words"("word");

-- CreateIndex
CREATE INDEX "user_tts_configs_user_id_idx" ON "user_tts_configs"("user_id");

-- CreateIndex
CREATE INDEX "user_tts_voice_models_config_id_idx" ON "user_tts_voice_models"("config_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_words_user_id_word_meaning_id_key" ON "user_words"("user_id", "word_meaning_id");

-- CreateIndex
CREATE UNIQUE INDEX "word_list_items_list_id_word_meaning_id_key" ON "word_list_items"("list_id", "word_meaning_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_review_queue_user_id_review_date_key" ON "daily_review_queue"("user_id", "review_date");

-- CreateIndex
CREATE UNIQUE INDEX "word_aliases_alias_key" ON "word_aliases"("alias");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_meanings" ADD CONSTRAINT "word_meanings_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tts_configs" ADD CONSTRAINT "user_tts_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tts_voice_models" ADD CONSTRAINT "user_tts_voice_models_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "user_tts_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_word_meaning_id_fkey" FOREIGN KEY ("word_meaning_id") REFERENCES "word_meanings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_lists" ADD CONSTRAINT "word_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_list_items" ADD CONSTRAINT "word_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "word_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_list_items" ADD CONSTRAINT "word_list_items_word_meaning_id_fkey" FOREIGN KEY ("word_meaning_id") REFERENCES "word_meanings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_review_queue" ADD CONSTRAINT "daily_review_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_session_items" ADD CONSTRAINT "review_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "review_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_session_items" ADD CONSTRAINT "review_session_items_user_word_id_fkey" FOREIGN KEY ("user_word_id") REFERENCES "user_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
