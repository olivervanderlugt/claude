import { PrismaClient, type Prisma } from "@prisma/client";

import { hashPassword } from "../src/lib/crypto";
import { BUILT_IN_THEMES, DEFAULT_PRESENTATION } from "../src/lib/theme";
import { DEFAULT_SETTINGS } from "../src/lib/scoring";
import type { QuestionPayload } from "../src/lib/question-schema";

/**
 * Development seed.
 *
 * Creates one demo account and a quiz that exercises all ten question types —
 * so a fresh clone can host a real game within a minute of `docker compose up`,
 * and so every question type has something to look at while styling.
 *
 * Idempotent: safe to run repeatedly.
 */

const db = new PrismaClient();

const DEMO_EMAIL = "demo@quizzly.local";
const DEMO_PASSWORD = "demo-password-123";

interface SeedQuestion {
  prompt: string;
  payload: QuestionPayload;
  explanation?: string;
  timeLimitSec?: number;
}

const questions: SeedQuestion[] = [
  {
    prompt: "Which planet is closest to the Sun?",
    payload: {
      type: "MULTIPLE_CHOICE",
      options: [
        { id: "a", text: "Mercury" },
        { id: "b", text: "Venus" },
        { id: "c", text: "Earth" },
        { id: "d", text: "Mars" },
      ],
      correctId: "a",
    },
    explanation: "Mercury orbits at about 58 million km from the Sun.",
  },
  {
    prompt: "Which of these are noble gases?",
    payload: {
      type: "MULTIPLE_SELECT",
      options: [
        { id: "a", text: "Helium" },
        { id: "b", text: "Nitrogen" },
        { id: "c", text: "Argon" },
        { id: "d", text: "Oxygen" },
      ],
      correctIds: ["a", "c"],
      partialCredit: true,
    },
    explanation: "Nitrogen and oxygen are diatomic gases, not noble gases.",
  },
  {
    prompt: "The Great Wall of China is visible from the Moon with the naked eye.",
    payload: { type: "TRUE_FALSE", correct: false },
    explanation:
      "It isn't. It's long, but only a few metres wide — far too narrow to resolve from that distance.",
  },
  {
    prompt: "What is the capital of Australia?",
    payload: {
      type: "TYPE_ANSWER",
      accepted: ["Canberra"],
      caseSensitive: false,
      typoTolerance: 1,
    },
    explanation: "Canberra was purpose-built as a compromise between Sydney and Melbourne.",
  },
  {
    prompt: "How many bones are there in an adult human body?",
    payload: { type: "NUMERIC", correct: 206, tolerance: 2 },
    explanation: "Babies start with about 270; many fuse as they grow.",
  },
  {
    prompt: "What percentage of Earth's surface is covered by ocean?",
    payload: {
      type: "SLIDER",
      min: 0,
      max: 100,
      step: 1,
      correct: 71,
      tolerance: 4,
      unit: "%",
    },
  },
  {
    prompt: "Put these inventions in the order they were created, earliest first.",
    payload: {
      type: "ORDERING",
      items: [
        { id: "a", text: "Printing press" },
        { id: "b", text: "Telephone" },
        { id: "c", text: "Television" },
        { id: "d", text: "World Wide Web" },
      ],
      correctOrder: ["a", "b", "c", "d"],
      partialCredit: true,
    },
    timeLimitSec: 45,
  },
  {
    prompt: "Match each country to its currency.",
    payload: {
      type: "MATCHING",
      pairs: [
        { id: "a", left: "Japan", right: "Yen" },
        { id: "b", left: "India", right: "Rupee" },
        { id: "c", left: "Poland", right: "Złoty" },
      ],
      partialCredit: true,
    },
    timeLimitSec: 45,
  },
  {
    prompt: "Which of these would you rather have for a superpower?",
    payload: {
      type: "POLL",
      options: [
        { id: "a", text: "Flight" },
        { id: "b", text: "Invisibility" },
        { id: "c", text: "Time travel" },
      ],
    },
  },
  {
    prompt: "In one word: how are you finding this quiz?",
    payload: { type: "WORD_CLOUD", maxWordsPerPlayer: 1, maxWordLength: 20 },
  },
];

async function main() {
  const user = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      displayName: "Demo Host",
      passwordHash: await hashPassword(DEMO_PASSWORD),
    },
    select: { id: true },
  });

  // Replace rather than duplicate, so re-running doesn't stack up copies.
  await db.quiz.deleteMany({
    where: { ownerId: user.id, title: "Every question type" },
  });

  const quiz = await db.quiz.create({
    data: {
      ownerId: user.id,
      title: "Every question type",
      description: "A demo quiz that exercises all ten question formats.",
      mode: "SOLO",
      theme: BUILT_IN_THEMES.midnight as unknown as Prisma.InputJsonValue,
      settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
      questions: {
        create: questions.map((question, index) => ({
          order: index,
          type: question.payload.type,
          prompt: question.prompt,
          payload: question.payload as unknown as Prisma.InputJsonValue,
          presentation: DEFAULT_PRESENTATION as unknown as Prisma.InputJsonValue,
          timeLimitSec: question.timeLimitSec ?? 20,
          points:
            question.payload.type === "POLL" ||
            question.payload.type === "WORD_CLOUD"
              ? 0
              : 1000,
          explanation: question.explanation ?? null,
        })),
      },
    },
    select: { id: true },
  });

  console.log(`
  Seed complete.

    Sign in with:  ${DEMO_EMAIL}
    Password:      ${DEMO_PASSWORD}

    Demo quiz:     /quiz/${quiz.id}/edit  (${questions.length} questions)

  This account is for local development. Do not seed a production database.
`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
