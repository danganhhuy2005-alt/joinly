import { createFileRoute } from "@tanstack/react-router";
import { QuizManagePage } from "./dashboard_.$id.quiz-editor.$quizId";

export const Route = createFileRoute("/_authenticated/dashboard_/$id/quiz-sessions/$quizId")({
  head: () => ({ meta: [{ title: "Phiên chơi Quiz — Joinly" }] }),
  component: QuizSessionsRoutePage,
});

function QuizSessionsRoutePage() {
  const { id, quizId } = Route.useParams();
  return <QuizManagePage id={id} quizId={quizId} view="sessions" />;
}
