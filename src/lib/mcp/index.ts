import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listMyEventsTool from "./tools/list-my-events";
import getEventTool from "./tools/get-event";
import listParticipantsTool from "./tools/list-participants";

// The OAuth issuer must be the direct Supabase host, not the .lovable.cloud proxy.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "joinly-mcp",
  title: "Joinly",
  version: "0.1.0",
  instructions:
    "Tools for Joinly, an event management platform. Use `list_my_events` to browse the signed-in organizer's events, `get_event` for rooms and participant counts, and `list_participants` for the attendee roster of a specific event or room.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listMyEventsTool, getEventTool, listParticipantsTool],
});
