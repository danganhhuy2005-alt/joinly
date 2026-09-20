import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/join/$id")({
  component: () => <Outlet />,
});
