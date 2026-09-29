export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      event_allowlist: {
        Row: {
          id: string;
          event_id: string;
          room_id: string | null;
          full_name: string | null;
          email: string | null;
          student_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          room_id?: string | null;
          full_name?: string | null;
          email?: string | null;
          student_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          room_id?: string | null;
          full_name?: string | null;
          email?: string | null;
          student_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_allowlist_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_allowlist_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "event_rooms";
            referencedColumns: ["id"];
          },
        ];
      };

      event_members: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          role: string;
          status: string;
          invited_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          role: string;
          status?: string;
          invited_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string;
          role?: string;
          status?: string;
          invited_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_members_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      event_rooms: {
        Row: {
          access_code: string | null;
          created_at: string;
          event_id: string;
          has_access_code: boolean | null;
          id: string;
          name: string;
          position: number;
        };
        Insert: {
          access_code?: string | null;
          created_at?: string;
          event_id: string;
          has_access_code?: boolean | null;
          id?: string;
          name: string;
          position?: number;
        };
        Update: {
          access_code?: string | null;
          created_at?: string;
          event_id?: string;
          has_access_code?: boolean | null;
          id?: string;
          name?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "event_rooms_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          allowlist_enabled: boolean;
          allowlist_scope: string;
          created_at: string;
          description: string | null;
          expected_attendees: number | null;
          id: string;
          is_demo: boolean;
          location: string | null;

          latitude: number | null;
          longitude: number | null;
          checkin_radius: number;

          name: string;
          organizer_id: string;
          starts_at: string | null;
          updated_at: string;
        };
        Insert: {
          allowlist_enabled?: boolean;
          allowlist_scope?: string;
          created_at?: string;
          description?: string | null;
          expected_attendees?: number | null;
          id?: string;
          is_demo?: boolean;
          location?: string | null;

          latitude?: number | null;
          longitude?: number | null;
          checkin_radius?: number;

          name: string;
          organizer_id: string;
          starts_at?: string | null;
          updated_at?: string;
        };
        Update: {
          allowlist_enabled?: boolean;
          allowlist_scope?: string;
          created_at?: string;
          description?: string | null;
          expected_attendees?: number | null;
          id?: string;
          is_demo?: boolean;
          location?: string | null;

          latitude?: number | null;
          longitude?: number | null;
          checkin_radius?: number;

          name?: string;
          organizer_id?: string;
          starts_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      participants: {
        Row: {
          checked_in: boolean;
          confirmation_token: string;
          created_at: string;
          email: string;
          event_id: string;
          full_name: string;
          id: string;
          phone: string | null;
          room_id: string;
          student_id: string | null;
        };
        Insert: {
          checked_in?: boolean;
          confirmation_token?: string;
          created_at?: string;
          email: string;
          event_id: string;
          full_name: string;
          id?: string;
          phone?: string | null;
          room_id: string;
          student_id?: string | null;
        };
        Update: {
          checked_in?: boolean;
          confirmation_token?: string;
          created_at?: string;
          email?: string;
          event_id?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
          room_id?: string;
          student_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "participants_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "participants_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "event_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "participants_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "event_rooms_public";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          club_name: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          club_name?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          club_name?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      event_rooms_public: {
        Row: {
          created_at: string | null;
          event_id: string | null;
          has_access_code: boolean | null;
          id: string | null;
          name: string | null;
          position: number | null;
        };
        Insert: {
          created_at?: string | null;
          event_id?: string | null;
          has_access_code?: boolean | null;
          id?: string | null;
          name?: string | null;
          position?: number | null;
        };
        Update: {
          created_at?: string | null;
          event_id?: string | null;
          has_access_code?: boolean | null;
          id?: string | null;
          name?: string | null;
          position?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "event_rooms_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      update_event_allowlist_settings: {
        Args: {
          _event_id: string;
          _enabled?: boolean | null;
          _scope?: string | null;
        };
        Returns: Json;
      };
      change_event_member_role: {
        Args: {
          _event_id: string;
          _member_id: string;
          _new_role: string;
        };
        Returns: Json;
      };
      approve_coowner_request: {
        Args: {
          _event_id: string;
          _member_id: string;
        };
        Returns: Json;
      };

      get_event_role: {
        Args: {
          _event_id: string;
        };
        Returns: string | null;
      };

      invite_event_member: {
        Args: {
          _email: string;
          _event_id: string;
          _role: string;
        };
        Returns: Json;
      };

      list_event_members: {
        Args: {
          _event_id: string;
        };
        Returns: {
          member_id: string | null;
          user_id: string;
          email: string;
          role: string;
          status: string;
          invited_by: string | null;
          created_at: string;
        }[];
      };

      reject_coowner_request: {
        Args: {
          _event_id: string;
          _member_id: string;
        };
        Returns: Json;
      };

      remove_event_member: {
        Args: {
          _event_id: string;
          _member_id: string;
        };
        Returns: Json;
      };

      verify_room_access_code: {
        Args: {
          _code: string;
          _room_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
