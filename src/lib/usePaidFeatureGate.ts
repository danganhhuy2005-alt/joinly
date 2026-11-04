import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Determine UI visibility from the event's actual plan, never from local storage. */
export function usePaidFeatureGate(eventId: string) {
  const [state, setState] = useState<{ isFree: boolean; loaded: boolean }>({ isFree: false, loaded: false });
  useEffect(() => {
    let cancelled = false;
    setState({ isFree: false, loaded: false });
    void (async () => {
      const { data, error } = await supabase.from("events").select("plan_code").eq("id", eventId).maybeSingle();
      if (cancelled) return;
      // Fail closed when plan cannot be verified; avoid accidentally exposing paid UI.
      setState({ isFree: error != null || !data || data.plan_code === "free", loaded: true });
    })();
    return () => { cancelled = true; };
  }, [eventId]);
  return state;
}
