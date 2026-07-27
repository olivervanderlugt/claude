-- CreateEnum
CREATE TYPE "QuizMode" AS ENUM ('SOLO', 'COLLAB');

-- CreateEnum
CREATE TYPE "QuizVisibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "CollabStage" AS ENUM ('COLLECTING', 'LOCKED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE', 'TYPE_ANSWER', 'NUMERIC', 'ORDERING', 'MATCHING', 'SLIDER', 'POLL', 'WORD_CLOUD');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('LOBBY', 'QUESTION', 'REVEAL', 'SCOREBOARD', 'ENDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "encryptedAiKey" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverImage" TEXT,
    "mode" "QuizMode" NOT NULL DEFAULT 'SOLO',
    "visibility" "QuizVisibility" NOT NULL DEFAULT 'PRIVATE',
    "theme" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "collabCode" TEXT,
    "collabStage" "CollabStage" NOT NULL DEFAULT 'COLLECTING',
    "collabQuota" INTEGER NOT NULL DEFAULT 3,
    "collabRevealAuthors" BOOLEAN NOT NULL DEFAULT true,
    "ownerReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "presentation" JSONB NOT NULL,
    "timeLimitSec" INTEGER NOT NULL DEFAULT 20,
    "points" INTEGER NOT NULL DEFAULT 1000,
    "explanation" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabContributor" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
    "currentIndex" INTEGER NOT NULL DEFAULT -1,
    "quizSnapshot" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "kicked" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "responseMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_collabCode_key" ON "Quiz"("collabCode");

-- CreateIndex
CREATE INDEX "Quiz_ownerId_idx" ON "Quiz"("ownerId");

-- CreateIndex
CREATE INDEX "Quiz_collabCode_idx" ON "Quiz"("collabCode");

-- CreateIndex
CREATE INDEX "Question_quizId_order_idx" ON "Question"("quizId", "order");

-- CreateIndex
CREATE INDEX "Question_authorId_idx" ON "Question"("authorId");

-- CreateIndex
CREATE INDEX "CollabContributor_quizId_idx" ON "CollabContributor"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "CollabContributor_quizId_userId_key" ON "CollabContributor"("quizId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_pin_key" ON "Game"("pin");

-- CreateIndex
CREATE INDEX "Game_pin_idx" ON "Game"("pin");

-- CreateIndex
CREATE INDEX "Game_hostId_idx" ON "Game"("hostId");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE INDEX "Player_gameId_score_idx" ON "Player"("gameId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Player_gameId_nickname_key" ON "Player"("gameId", "nickname");

-- CreateIndex
CREATE INDEX "Answer_gameId_questionIndex_idx" ON "Answer"("gameId", "questionIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_gameId_playerId_questionIndex_key" ON "Answer"("gameId", "playerId", "questionIndex");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabContributor" ADD CONSTRAINT "CollabContributor_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabContributor" ADD CONSTRAINT "CollabContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
