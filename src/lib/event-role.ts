import { supabase } from "@/integrations/supabase/client";

export type EventRole = "owner" | "co_owner" | "manager" | null;

export async function getEventRole(eventId: string): Promise<EventRole> {
  const { data, error } = await supabase.rpc("get_event_role", {
    _event_id: eventId,
  });

  if (error) {
    console.error("Get event role error:", error);
    return null;
  }

  if (data === "owner" || data === "co_owner" || data === "manager") {
    return data;
  }

  return null;
}
export function canEditEvent(role: EventRole) {
  return role === "owner" || role === "co_owner";
}

export function canManageMembers(role: EventRole) {
  return role === "owner" || role === "co_owner";
}

export function canDeleteEvent(role: EventRole) {
  return role === "owner";
}

export function canManageOperations(role: EventRole) {
  return role === "owner" || role === "co_owner" || role === "manager";
}
