export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          company_id: string;
          created_at: string;
          detail: Json;
          entity_id: string;
          entity_type: string;
          id: string;
          is_demo_data: boolean;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          company_id: string;
          created_at?: string;
          detail?: Json;
          entity_id: string;
          entity_type: string;
          id?: string;
          is_demo_data?: boolean;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          company_id?: string;
          created_at?: string;
          detail?: Json;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          is_demo_data?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_movements: {
        Row: {
          amount: number;
          cash_session_id: string | null;
          company_id: string;
          concept: string;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          movement_at: string;
          movement_type: string;
        };
        Insert: {
          amount: number;
          cash_session_id?: string | null;
          company_id: string;
          concept: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          movement_at?: string;
          movement_type: string;
        };
        Update: {
          amount?: number;
          cash_session_id?: string | null;
          company_id?: string;
          concept?: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          movement_at?: string;
          movement_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_movements_cash_session_id_fkey";
            columns: ["cash_session_id"];
            isOneToOne: false;
            referencedRelation: "cash_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_movements_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_movements_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_sessions: {
        Row: {
          classification: string | null;
          closed_at: string | null;
          closed_by: string | null;
          company_id: string;
          count_cutoff_at: string | null;
          created_at: string;
          difference: number | null;
          expected_amount: number;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          opened_at: string;
          opened_by: string | null;
          opening_amount: number;
          real_amount: number | null;
          review_notes: string | null;
          review_status: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          till_id: string | null;
          updated_at: string;
        };
        Insert: {
          classification?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          company_id: string;
          count_cutoff_at?: string | null;
          created_at?: string;
          difference?: number | null;
          expected_amount?: number;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          opened_at?: string;
          opened_by?: string | null;
          opening_amount?: number;
          real_amount?: number | null;
          review_notes?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          till_id?: string | null;
          updated_at?: string;
        };
        Update: {
          classification?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          company_id?: string;
          count_cutoff_at?: string | null;
          created_at?: string;
          difference?: number | null;
          expected_amount?: number;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          opened_at?: string;
          opened_by?: string | null;
          opening_amount?: number;
          real_amount?: number | null;
          review_notes?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          till_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_sessions_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_sessions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_sessions_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey";
            columns: ["opened_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_sessions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_sessions_till_id_fkey";
            columns: ["till_id"];
            isOneToOne: false;
            referencedRelation: "tills";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          active: boolean;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_demo_data: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          address: string | null;
          business_type: string;
          card_commission_rate: number;
          contact_email: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          deleted_at: string | null;
          document_types: Json | null;
          expires_at: string | null;
          fiscal_id: string | null;
          fiscal_id_label: string;
          id: string;
          is_demo_data: boolean;
          locale: string;
          logo_url: string | null;
          low_stock_threshold_default: number;
          loyalty_earn_rate: number;
          loyalty_enabled: boolean;
          loyalty_point_value: number;
          name: string;
          phone: string | null;
          plan_id: string | null;
          subscription_status: string;
          tax_name: string;
          tax_rate: number;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          business_type?: string;
          card_commission_rate?: number;
          contact_email?: string | null;
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          deleted_at?: string | null;
          document_types?: Json | null;
          expires_at?: string | null;
          fiscal_id?: string | null;
          fiscal_id_label?: string;
          id?: string;
          is_demo_data?: boolean;
          locale?: string;
          logo_url?: string | null;
          low_stock_threshold_default?: number;
          loyalty_earn_rate?: number;
          loyalty_enabled?: boolean;
          loyalty_point_value?: number;
          name: string;
          phone?: string | null;
          plan_id?: string | null;
          subscription_status?: string;
          tax_name?: string;
          tax_rate?: number;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          business_type?: string;
          card_commission_rate?: number;
          contact_email?: string | null;
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          deleted_at?: string | null;
          document_types?: Json | null;
          expires_at?: string | null;
          fiscal_id?: string | null;
          fiscal_id_label?: string;
          id?: string;
          is_demo_data?: boolean;
          locale?: string;
          logo_url?: string | null;
          low_stock_threshold_default?: number;
          loyalty_earn_rate?: number;
          loyalty_enabled?: boolean;
          loyalty_point_value?: number;
          name?: string;
          phone?: string | null;
          plan_id?: string | null;
          subscription_status?: string;
          tax_name?: string;
          tax_rate?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "subscription_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      country_payment_methods: {
        Row: {
          country_code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          kind: string;
          label: string;
          method_code: string;
          recommended: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          country_code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          kind: string;
          label: string;
          method_code: string;
          recommended?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          kind?: string;
          label?: string;
          method_code?: string;
          recommended?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      country_settings: {
        Row: {
          country_code: string;
          currency_code: string | null;
          document_types: Json;
          fiscal_id_label: string;
          tax_name: string;
          tax_rate: number;
          updated_at: string;
        };
        Insert: {
          country_code: string;
          currency_code?: string | null;
          document_types?: Json;
          fiscal_id_label?: string;
          tax_name?: string;
          tax_rate?: number;
          updated_at?: string;
        };
        Update: {
          country_code?: string;
          currency_code?: string | null;
          document_types?: Json;
          fiscal_id_label?: string;
          tax_name?: string;
          tax_rate?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          address: string | null;
          company_id: string;
          created_at: string;
          credit_balance: number;
          credit_limit: number;
          deleted_at: string | null;
          document_number: string | null;
          email: string | null;
          id: string;
          is_demo_data: boolean;
          loyalty_points: number;
          name: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          company_id: string;
          created_at?: string;
          credit_balance?: number;
          credit_limit?: number;
          deleted_at?: string | null;
          document_number?: string | null;
          email?: string | null;
          id?: string;
          is_demo_data?: boolean;
          loyalty_points?: number;
          name: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          company_id?: string;
          created_at?: string;
          credit_balance?: number;
          credit_limit?: number;
          deleted_at?: string | null;
          document_number?: string | null;
          email?: string | null;
          id?: string;
          is_demo_data?: boolean;
          loyalty_points?: number;
          name?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_attendance: {
        Row: {
          check_in_at: string;
          check_out_at: string | null;
          company_id: string;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          is_early_leave: boolean;
          is_late: boolean;
          location_id: string | null;
          profile_id: string;
          status: string;
        };
        Insert: {
          check_in_at?: string;
          check_out_at?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          is_early_leave?: boolean;
          is_late?: boolean;
          location_id?: string | null;
          profile_id: string;
          status?: string;
        };
        Update: {
          check_in_at?: string;
          check_out_at?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          is_early_leave?: boolean;
          is_late?: boolean;
          location_id?: string | null;
          profile_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_attendance_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_attendance_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_time_events: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          end_date: string | null;
          event_date: string;
          id: string;
          is_demo_data: boolean;
          note: string | null;
          profile_id: string;
          type: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          end_date?: string | null;
          event_date: string;
          id?: string;
          is_demo_data?: boolean;
          note?: string | null;
          profile_id: string;
          type: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          end_date?: string | null;
          event_date?: string;
          id?: string;
          is_demo_data?: boolean;
          note?: string | null;
          profile_id?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_time_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employee_time_events_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_ledger: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          customer_id: string;
          id: string;
          is_demo_data: boolean;
          points: number;
          sale_id: string | null;
          type: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          id?: string;
          is_demo_data?: boolean;
          points: number;
          sale_id?: string | null;
          type: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          id?: string;
          is_demo_data?: boolean;
          points?: number;
          sale_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_ledger_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loyalty_ledger_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loyalty_ledger_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      locations: {
        Row: {
          address: string | null;
          city: string | null;
          company_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_demo_data: boolean;
          manager_name: string | null;
          name: string;
          opening_hours: string | null;
          phone: string | null;
          short_code: string | null;
          ticket_footer_text: string | null;
          ticket_show_cashier_name: boolean;
          ticket_show_fiscal_info: boolean;
          ticket_show_loyalty_points: boolean;
          ticket_show_logo: boolean;
          ticket_show_payment_method: boolean;
          ticket_show_tax_breakdown: boolean;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          manager_name?: string | null;
          name: string;
          opening_hours?: string | null;
          phone?: string | null;
          short_code?: string | null;
          ticket_footer_text?: string | null;
          ticket_show_cashier_name?: boolean;
          ticket_show_fiscal_info?: boolean;
          ticket_show_loyalty_points?: boolean;
          ticket_show_logo?: boolean;
          ticket_show_payment_method?: boolean;
          ticket_show_tax_breakdown?: boolean;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          manager_name?: string | null;
          name?: string;
          opening_hours?: string | null;
          phone?: string | null;
          short_code?: string | null;
          ticket_footer_text?: string | null;
          ticket_show_cashier_name?: boolean;
          ticket_show_fiscal_info?: boolean;
          ticket_show_loyalty_points?: boolean;
          ticket_show_logo?: boolean;
          ticket_show_payment_method?: boolean;
          ticket_show_tax_breakdown?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "locations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      mermas: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          employee_id: string;
          estimated_loss: number;
          id: string;
          is_demo_data: boolean;
          location_id: string;
          notes: string | null;
          product_id: string | null;
          quantity: number | null;
          reason_category: string;
          registered_by: string;
          unit_cost: number | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          employee_id: string;
          estimated_loss?: number;
          id?: string;
          is_demo_data?: boolean;
          location_id: string;
          notes?: string | null;
          product_id?: string | null;
          quantity?: number | null;
          reason_category?: string;
          registered_by: string;
          unit_cost?: number | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          employee_id?: string;
          estimated_loss?: number;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string;
          notes?: string | null;
          product_id?: string | null;
          quantity?: number | null;
          reason_category?: string;
          registered_by?: string;
          unit_cost?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mermas_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mermas_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mermas_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mermas_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mermas_registered_by_fkey";
            columns: ["registered_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          brand_name: string;
          id: string;
          logo_url: string | null;
          updated_at: string;
        };
        Insert: {
          brand_name?: string;
          id: string;
          logo_url?: string | null;
          updated_at?: string;
        };
        Update: {
          brand_name?: string;
          id?: string;
          logo_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_combo_items: {
        Row: {
          combo_product_id: string;
          company_id: string;
          component_product_id: string;
          created_at: string;
          id: string;
          qty: number;
        };
        Insert: {
          combo_product_id: string;
          company_id: string;
          component_product_id: string;
          created_at?: string;
          id?: string;
          qty: number;
        };
        Update: {
          combo_product_id?: string;
          company_id?: string;
          component_product_id?: string;
          created_at?: string;
          id?: string;
          qty?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_combo_items_combo_product_id_fkey";
            columns: ["combo_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_combo_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_combo_items_component_product_id_fkey";
            columns: ["component_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_locations: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_demo_data: boolean;
          location_id: string;
          product_id: string;
          stock: number;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          location_id: string;
          product_id: string;
          stock?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          location_id?: string;
          product_id?: string;
          stock?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_locations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_locations_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_locations_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variant_locations: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_demo_data: boolean;
          location_id: string;
          product_variant_id: string;
          stock: number;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          location_id: string;
          product_variant_id: string;
          stock?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          location_id?: string;
          product_variant_id?: string;
          stock?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variant_locations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variant_locations_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variant_locations_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          attributes: Json;
          barcode: string | null;
          company_id: string;
          cost_override: number | null;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_active: boolean;
          is_demo_data: boolean;
          price_override: number | null;
          product_id: string;
          sku: string | null;
          updated_at: string;
        };
        Insert: {
          attributes?: Json;
          barcode?: string | null;
          company_id: string;
          cost_override?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          price_override?: number | null;
          product_id: string;
          sku?: string | null;
          updated_at?: string;
        };
        Update: {
          attributes?: Json;
          barcode?: string | null;
          company_id?: string;
          cost_override?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          price_override?: number | null;
          product_id?: string;
          sku?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          barcode: string | null;
          category_id: string | null;
          company_id: string;
          cost: number;
          created_at: string;
          deleted_at: string | null;
          has_variants: boolean;
          id: string;
          image_url: string | null;
          is_demo_data: boolean;
          low_stock_threshold: number | null;
          name: string;
          price: number;
          price_includes_tax: boolean;
          product_type: string;
          sku: string | null;
          stock: number;
          supplier_id: string | null;
          unit: string;
          updated_at: string;
          variant_attributes: string[] | null;
        };
        Insert: {
          active?: boolean;
          barcode?: string | null;
          category_id?: string | null;
          company_id: string;
          cost?: number;
          created_at?: string;
          deleted_at?: string | null;
          has_variants?: boolean;
          id?: string;
          image_url?: string | null;
          is_demo_data?: boolean;
          low_stock_threshold?: number | null;
          name: string;
          price?: number;
          price_includes_tax?: boolean;
          product_type?: string;
          sku?: string | null;
          stock?: number;
          supplier_id?: string | null;
          unit?: string;
          updated_at?: string;
          variant_attributes?: string[] | null;
        };
        Update: {
          active?: boolean;
          barcode?: string | null;
          category_id?: string | null;
          company_id?: string;
          cost?: number;
          created_at?: string;
          deleted_at?: string | null;
          has_variants?: boolean;
          id?: string;
          image_url?: string | null;
          is_demo_data?: boolean;
          low_stock_threshold?: number | null;
          name?: string;
          price?: number;
          price_includes_tax?: boolean;
          product_type?: string;
          sku?: string | null;
          stock?: number;
          supplier_id?: string | null;
          unit?: string;
          updated_at?: string;
          variant_attributes?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_locations: {
        Row: {
          company_id: string;
          created_at: string;
          location_id: string;
          profile_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          location_id: string;
          profile_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          location_id?: string;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_locations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_locations_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_locations_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          allowed_sections: string[] | null;
          commission_rate: number | null;
          company_id: string | null;
          created_at: string;
          demo_mode: Database["public"]["Enums"]["demo_mode"];
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          is_demo: boolean;
          is_platform_admin: boolean;
          location_id: string | null;
          pin_hash: string | null;
          role: Database["public"]["Enums"]["app_role"];
          shift_end: string | null;
          shift_start: string | null;
          updated_at: string;
        };
        Insert: {
          allowed_sections?: string[] | null;
          commission_rate?: number | null;
          company_id?: string | null;
          created_at?: string;
          demo_mode?: Database["public"]["Enums"]["demo_mode"];
          email: string;
          full_name: string;
          id: string;
          is_active?: boolean;
          is_demo?: boolean;
          is_platform_admin?: boolean;
          location_id?: string | null;
          pin_hash?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          shift_end?: string | null;
          shift_start?: string | null;
          updated_at?: string;
        };
        Update: {
          allowed_sections?: string[] | null;
          commission_rate?: number | null;
          company_id?: string | null;
          created_at?: string;
          demo_mode?: Database["public"]["Enums"]["demo_mode"];
          email?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          is_demo?: boolean;
          is_platform_admin?: boolean;
          location_id?: string | null;
          pin_hash?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          shift_end?: string | null;
          shift_start?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      promotions: {
        Row: {
          active: boolean;
          category_id: string | null;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          ends_at: string | null;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          min_qty: number | null;
          name: string;
          product_id: string | null;
          promotion_type: string;
          scope_type: string;
          starts_at: string | null;
          updated_at: string;
          value_amount: number | null;
          value_text: string | null;
        };
        Insert: {
          active?: boolean;
          category_id?: string | null;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          ends_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          min_qty?: number | null;
          name: string;
          product_id?: string | null;
          promotion_type: string;
          scope_type?: string;
          starts_at?: string | null;
          updated_at?: string;
          value_amount?: number | null;
          value_text?: string | null;
        };
        Update: {
          active?: boolean;
          category_id?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          ends_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          min_qty?: number | null;
          name?: string;
          product_id?: string | null;
          promotion_type?: string;
          scope_type?: string;
          starts_at?: string | null;
          updated_at?: string;
          value_amount?: number | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotions_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_items: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          product_id: string | null;
          product_variant_id: string | null;
          purchase_id: string;
          qty: number;
          total: number;
          unit_cost: number;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          product_id?: string | null;
          product_variant_id?: string | null;
          purchase_id: string;
          qty?: number;
          total?: number;
          unit_cost?: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          product_id?: string | null;
          product_variant_id?: string | null;
          purchase_id?: string;
          qty?: number;
          total?: number;
          unit_cost?: number;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_items_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
        ];
      };
      purchases: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          document_number: string | null;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          purchase_date: string;
          purchase_number: string;
          status: string;
          supplier_id: string | null;
          total: number;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          document_number?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          purchase_date?: string;
          purchase_number: string;
          status?: string;
          supplier_id?: string | null;
          total?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          document_number?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          purchase_date?: string;
          purchase_number?: string;
          status?: string;
          supplier_id?: string | null;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchases_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      return_items: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          product_id: string | null;
          product_name: string;
          product_variant_id: string | null;
          qty: number;
          return_id: string;
          sale_item_id: string | null;
          total: number;
          unit_price: number;
          variant_label: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          product_id?: string | null;
          product_name?: string;
          product_variant_id?: string | null;
          qty: number;
          return_id: string;
          sale_item_id?: string | null;
          total?: number;
          unit_price?: number;
          variant_label?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          product_id?: string | null;
          product_name?: string;
          product_variant_id?: string | null;
          qty?: number;
          return_id?: string;
          sale_item_id?: string | null;
          total?: number;
          unit_price?: number;
          variant_label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "return_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "return_items_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "return_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "return_items_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "return_items_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "returns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "return_items_sale_item_id_fkey";
            columns: ["sale_item_id"];
            isOneToOne: false;
            referencedRelation: "sale_items";
            referencedColumns: ["id"];
          },
        ];
      };
      returns: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          reason: string;
          return_number: string;
          sale_id: string | null;
          status: string;
          total: number;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          reason: string;
          return_number: string;
          sale_id?: string | null;
          status?: string;
          total?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          reason?: string;
          return_number?: string;
          sale_id?: string | null;
          status?: string;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "returns_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_items: {
        Row: {
          company_id: string;
          cost: number;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          net_revenue: number | null;
          price_includes_tax: boolean;
          product_id: string | null;
          product_name: string;
          product_variant_id: string | null;
          qty: number;
          sale_id: string;
          tax_amount: number;
          total: number;
          unit_price: number;
          variant_label: string | null;
        };
        Insert: {
          company_id: string;
          cost?: number;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          net_revenue?: number | null;
          price_includes_tax?: boolean;
          product_id?: string | null;
          product_name: string;
          product_variant_id?: string | null;
          qty?: number;
          sale_id: string;
          tax_amount?: number;
          total?: number;
          unit_price?: number;
          variant_label?: string | null;
        };
        Update: {
          company_id?: string;
          cost?: number;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          net_revenue?: number | null;
          price_includes_tax?: boolean;
          product_id?: string | null;
          product_name?: string;
          product_variant_id?: string | null;
          qty?: number;
          sale_id?: string;
          tax_amount?: number;
          total?: number;
          unit_price?: number;
          variant_label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_payments: {
        Row: {
          amount: number;
          company_id: string;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          kind: string;
          method: string;
          sale_id: string;
        };
        Insert: {
          amount: number;
          company_id: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          kind?: string;
          method: string;
          sale_id: string;
        };
        Update: {
          amount?: number;
          company_id?: string;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          kind?: string;
          method?: string;
          sale_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_payments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_payments_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_credit_payments: {
        Row: {
          amount: number;
          company_id: string;
          created_at: string;
          created_by: string | null;
          customer_id: string;
          id: string;
          is_demo_data: boolean;
          method: string;
          notes: string | null;
        };
        Insert: {
          amount: number;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          id?: string;
          is_demo_data?: boolean;
          method: string;
          notes?: string | null;
        };
        Update: {
          amount?: number;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          id?: string;
          is_demo_data?: boolean;
          method?: string;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_credit_payments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_credit_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          commission_amount: number;
          commission_rate: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          customer_name: string;
          deleted_at: string | null;
          discount_total: number;
          document_type: string;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          payment_method: string;
          sale_date: string;
          sale_number: string;
          status: string;
          subtotal: number;
          tax: number;
          till_id: string | null;
          total: number;
          updated_at: string;
        };
        Insert: {
          commission_amount?: number;
          commission_rate?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          customer_name?: string;
          deleted_at?: string | null;
          discount_total?: number;
          document_type?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          payment_method?: string;
          sale_date?: string;
          sale_number: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          till_id?: string | null;
          total?: number;
          updated_at?: string;
        };
        Update: {
          commission_amount?: number;
          commission_rate?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          customer_name?: string;
          deleted_at?: string | null;
          discount_total?: number;
          document_type?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          payment_method?: string;
          sale_date?: string;
          sale_number?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          till_id?: string | null;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_till_id_fkey";
            columns: ["till_id"];
            isOneToOne: false;
            referencedRelation: "tills";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          movement_type: string;
          notes: string | null;
          product_id: string;
          product_variant_id: string | null;
          qty: number;
          reference_id: string | null;
          reference_type: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          movement_type: string;
          notes?: string | null;
          product_id: string;
          product_variant_id?: string | null;
          qty: number;
          reference_id?: string | null;
          reference_type?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          movement_type?: string;
          notes?: string | null;
          product_id?: string;
          product_variant_id?: string | null;
          qty?: number;
          reference_id?: string | null;
          reference_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      subscription_plans: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          is_demo_data: boolean;
          monthly_sales_limit: number;
          name: string;
          price: number;
          product_limit: number;
          updated_at: string;
          user_limit: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          monthly_sales_limit?: number;
          name: string;
          price?: number;
          product_limit?: number;
          updated_at?: string;
          user_limit?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          monthly_sales_limit?: number;
          name?: string;
          price?: number;
          product_limit?: number;
          updated_at?: string;
          user_limit?: number;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          document_number: string | null;
          email: string | null;
          id: string;
          is_demo_data: boolean;
          name: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          document_number?: string | null;
          email?: string | null;
          id?: string;
          is_demo_data?: boolean;
          name: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          document_number?: string | null;
          email?: string | null;
          id?: string;
          is_demo_data?: boolean;
          name?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      till_count_lines: {
        Row: {
          company_id: string;
          created_at: string;
          denomination: number;
          id: string;
          is_demo_data: boolean;
          quantity: number;
          subtotal: number;
          till_count_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          denomination: number;
          id?: string;
          is_demo_data?: boolean;
          quantity?: number;
          subtotal?: number;
          till_count_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          denomination?: number;
          id?: string;
          is_demo_data?: boolean;
          quantity?: number;
          subtotal?: number;
          till_count_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "till_count_lines_till_count_id_fkey";
            columns: ["till_count_id"];
            isOneToOne: false;
            referencedRelation: "till_counts";
            referencedColumns: ["id"];
          },
        ];
      };
      till_counts: {
        Row: {
          card_total: number;
          cash_session_id: string;
          company_id: string;
          count_number: number;
          counted_at: string;
          counted_by: string | null;
          counted_cash_total: number;
          created_at: string;
          id: string;
          is_demo_data: boolean;
          location_id: string | null;
          manual_adjustment: number;
          other_total: number;
          till_id: string | null;
          transfer_total: number;
        };
        Insert: {
          card_total?: number;
          cash_session_id: string;
          company_id: string;
          count_number: number;
          counted_at?: string;
          counted_by?: string | null;
          counted_cash_total?: number;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          manual_adjustment?: number;
          other_total?: number;
          till_id?: string | null;
          transfer_total?: number;
        };
        Update: {
          card_total?: number;
          cash_session_id?: string;
          company_id?: string;
          count_number?: number;
          counted_at?: string;
          counted_by?: string | null;
          counted_cash_total?: number;
          created_at?: string;
          id?: string;
          is_demo_data?: boolean;
          location_id?: string | null;
          manual_adjustment?: number;
          other_total?: number;
          till_id?: string | null;
          transfer_total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "till_counts_cash_session_id_fkey";
            columns: ["cash_session_id"];
            isOneToOne: false;
            referencedRelation: "cash_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "till_counts_counted_by_fkey";
            columns: ["counted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "till_counts_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "till_counts_till_id_fkey";
            columns: ["till_id"];
            isOneToOne: false;
            referencedRelation: "tills";
            referencedColumns: ["id"];
          },
        ];
      };
      tills: {
        Row: {
          code: string | null;
          company_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_demo_data: boolean;
          location_id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          location_id: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_demo_data?: boolean;
          location_id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tills_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tills_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          active: boolean;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_demo_data: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          company_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_demo_data?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      adjust_stock: {
        Args: {
          p_location_id: string;
          p_notes?: string;
          p_product_id: string;
          p_qty: number;
        };
        Returns: Json;
      };
      authorize_cash_session: {
        Args: { p_notes?: string; p_session_id: string };
        Returns: Json;
      };
      bootstrap_demo_profiles: { Args: never; Returns: undefined };
      bootstrap_owner_profile: {
        Args: { p_owner_email?: string };
        Returns: undefined;
      };
      can_admin_company: { Args: { p_company_id: string }; Returns: boolean };
      can_select_company: {
        Args: { p_company_id: string; p_is_demo_data?: boolean };
        Returns: boolean;
      };
      can_write_company: { Args: { p_company_id: string }; Returns: boolean };
      clear_employee_pin: {
        Args: { p_profile_id: string };
        Returns: undefined;
      };
      collect_customer_credit: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_kind?: string;
          p_method?: string;
          p_notes?: string;
        };
        Returns: Json;
      };
      compute_cash_session_expected: {
        Args: { p_session_id: string };
        Returns: number;
      };
      create_purchase: {
        Args: {
          p_date: string;
          p_document_number: string;
          p_items: Json;
          p_location_id: string;
          p_supplier_id: string;
        };
        Returns: string;
      };
      create_return: {
        Args: {
          p_items: Json;
          p_location_id?: string;
          p_reason: string;
          p_refund_cash?: boolean;
          p_sale_id: string;
        };
        Returns: string;
      };
      create_sale: {
        Args: {
          p_client_request_id?: string;
          p_customer_id: string;
          p_document_type: string;
          p_items: Json;
          p_location_id?: string;
          p_payment_kind?: string;
          p_payment_method: string;
          p_payments?: Json;
          p_points_redeemed?: number;
          p_till_id?: string;
        };
        Returns: Json;
      };
      current_user_company_id: { Args: never; Returns: string };
      current_user_is_demo: { Args: never; Returns: boolean };
      current_user_is_platform_admin: { Args: never; Returns: boolean };
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      dashboard_sales_totals: {
        Args: { p_location_id?: string; p_tz?: string };
        Returns: {
          count_month: number;
          count_today: number;
          total_month: number;
          total_today: number;
        }[];
      };
      default_document_types: { Args: { p_country: string }; Returns: Json };
      default_tax_name: { Args: { p_country: string }; Returns: string };
      default_tax_rate: { Args: { p_country: string }; Returns: number };
      expire_overdue_trials: { Args: never; Returns: number };
      finish_till_count: {
        Args: { p_session_id: string };
        Returns: Json;
      };
      low_stock_summary: {
        Args: { p_limit?: number; p_location_id?: string };
        Returns: Json;
      };
      open_cash_session: {
        Args: {
          p_location_id?: string;
          p_opening_amount: number;
          p_till_id?: string;
        };
        Returns: string;
      };
      profit_report: {
        Args: { p_from?: string; p_location_id?: string; p_to?: string };
        Returns: {
          cost: number;
          product_id: string;
          product_name: string;
          profit: number;
          qty: number;
          revenue: number;
        }[];
      };
      punch_employee: {
        Args: { p_location_id?: string; p_pin: string; p_tz?: string };
        Returns: Json;
      };
      purchase_projection: {
        Args: {
          p_coverage_days?: number;
          p_days_window?: number;
          p_limit?: number;
        };
        Returns: Json;
      };
      register_merma: {
        Args: {
          p_employee_id?: string;
          p_estimated_loss?: number;
          p_location_id: string;
          p_notes?: string;
          p_product_id?: string;
          p_quantity?: number;
          p_reason_category: string;
        };
        Returns: string;
      };
      delete_merma: {
        Args: { p_merma_id: string };
        Returns: undefined;
      };
      reset_company_data: {
        Args: { p_confirm_name: string };
        Returns: Json;
      };
      sales_by_category: {
        Args: {
          p_from?: string;
          p_location_id?: string;
          p_to?: string;
          p_tz?: string;
        };
        Returns: {
          category: string;
          total: number;
        }[];
      };
      sales_by_day: {
        Args: { p_days?: number; p_location_id?: string; p_tz?: string };
        Returns: {
          count: number;
          day: string;
          total: number;
        }[];
      };
      sales_by_payment_method: {
        Args: {
          p_from?: string;
          p_location_id?: string;
          p_to?: string;
          p_tz?: string;
        };
        Returns: {
          count: number;
          method: string;
          total: number;
        }[];
      };
      set_employee_commission: {
        Args: { p_commission_rate: number | null; p_profile_id: string };
        Returns: undefined;
      };
      set_employee_pin: {
        Args: { p_pin: string; p_profile_id: string };
        Returns: undefined;
      };
      soft_delete_product: {
        Args: { p_product_id: string };
        Returns: undefined;
      };
      submit_till_count: {
        Args: {
          p_denominations: Json;
          p_manual_adjustment?: number;
          p_session_id: string;
        };
        Returns: Json;
      };
      sync_product_variants: {
        Args: {
          p_attribute_names: string[];
          p_product_id: string;
          p_variants: Json;
        };
        Returns: undefined;
      };
      transfer_stock: {
        Args: {
          p_from_location: string;
          p_notes?: string;
          p_product_id: string;
          p_qty: number;
          p_to_location: string;
        };
        Returns: Json;
      };
      user_can_access_location: {
        Args: { p_location_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "user" | "admin" | "finanzas" | "operador";
      demo_mode: "none" | "read_only";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    Enums: {
      app_role: ["user", "admin", "finanzas", "operador"],
      demo_mode: ["none", "read_only"],
    },
  },
} as const;
