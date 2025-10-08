export interface Admin {
  admin_id: number;
  username: string;
  password_hash: string;
  real_name?: string;
  email?: string;
  phone?: string;
  role_id: number;
  status: number;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Role {
  role_id: number;
  role_name: string;
  description?: string;
  created_at: Date;
}

export interface Permission {
  permission_id: number;
  permission_name: string;
  permission_code: string;
  resource?: string;
  action?: string;
  description?: string;
  created_at: Date;
}

export interface AdminLog {
  log_id: number;
  admin_id: number;
  action: string;
  resource_type?: string;
  resource_id?: string;
  description?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface TrafficStatistics {
  id: number;
  date: Date;
  hour?: number;
  page_views: number;
  unique_visitors: number;
  new_users: number;
  bounce_rate?: number;
  avg_session_duration?: number;
  created_at: Date;
}

export interface PageVisit {
  visit_id: number;
  user_id?: number;
  session_id: string;
  page_url: string;
  referrer?: string;
  ip_address?: string;
  user_agent?: string;
  device_type?: string;
  created_at: Date;
}

