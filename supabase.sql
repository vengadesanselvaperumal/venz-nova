create extension if not exists pgcrypto;

-- ============================================================
-- VENZNOVA / NIFT-CONNECT COMPLETE SUPABASE SCHEMA
-- Students, seniors, alumni and clients can participate.
-- Students can publish projects and assignments.
-- Anyone can accept an open assignment.
-- Assignment flow: POST -> ACCEPT -> ADVANCE -> SUBMIT ->
-- REWORK (up to chosen limit) -> APPROVE -> FINAL PAYMENT -> DONE.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  roll_number text unique,
  admission_year int,
  graduation_year int,
  role text not null default 'JUNIOR' check (role in ('JUNIOR','SENIOR','ALUMNI','CLIENT')),
  campus text,
  programme text default 'BFTech',
  status text default 'Student',
  join_as text default 'Student',
  linkedin text,
  portfolio text,
  bio text,
  skills text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  category text default 'Fashion & Textiles',
  skills text default '',
  visibility text default 'public' check (visibility in ('public','private')),
  file_url text,
  file_name text,
  likes uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.doubts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  category text default 'Academic',
  file_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  doubt_id uuid not null references public.doubts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  type text default 'Internship',
  location text default 'Remote',
  skills text default '',
  deadline timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text default '',
  status text default 'Applied',
  created_at timestamptz not null default now(),
  unique(opportunity_id, user_id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  category text default 'Fashion / Design',
  skills text default '',
  budget numeric(12,2) not null check (budget > 0),
  advance_percent numeric(5,2) not null default 30 check (advance_percent >= 10 and advance_percent <= 100),
  deadline timestamptz,
  assignment_file_url text,
  assignment_file_name text,
  status text not null default 'open' check (status in ('open','accepted','advance_paid','submitted','rework','approved_payment_due','completed','cancelled')),
  worker_id uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  advance_paid boolean not null default false,
  advance_paid_at timestamptz,
  advance_amount numeric(12,2),
  delivery_note text,
  delivery_file_url text,
  delivery_file_name text,
  submitted_at timestamptz,
  final_approved_at timestamptz,
  final_paid boolean not null default false,
  final_paid_at timestamptz,
  final_amount numeric(12,2),
  reworks_allowed int not null default 3 check (reworks_allowed between 1 and 3),
  reworks_used int not null default 0 check (reworks_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_reworks (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  round int not null,
  feedback text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(assignment_id, round)
);

create table if not exists public.assignment_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  payer_id uuid not null references public.profiles(id) on delete cascade,
  payee_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('advance','final')),
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'paid',
  provider text default 'demo',
  provider_payment_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'connected',
  created_at timestamptz not null default now(),
  unique(from_id, to_id),
  check(from_id <> to_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Compatibility columns for databases where tables already exist
-- ============================================================

do $$ begin
  alter table public.profiles add column if not exists roll_number text;
  alter table public.profiles add column if not exists status text default 'Student';
  alter table public.profiles add column if not exists join_as text default 'Student';
  alter table public.profiles add column if not exists skills text;
  alter table public.profiles add column if not exists updated_at timestamptz default now();
exception when others then null; end $$;

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_profiles_programme on public.profiles(programme);
create index if not exists idx_profiles_roll_number on public.profiles(roll_number);
create index if not exists idx_projects_user on public.projects(user_id);
create index if not exists idx_projects_created on public.projects(created_at desc);
create index if not exists idx_doubts_user on public.doubts(user_id);
create index if not exists idx_doubts_created on public.doubts(created_at desc);
create index if not exists idx_answers_doubt on public.answers(doubt_id);
create index if not exists idx_opportunities_user on public.opportunities(user_id);
create index if not exists idx_applications_opportunity on public.applications(opportunity_id);
create index if not exists idx_assignments_status on public.assignments(status);
create index if not exists idx_assignments_worker on public.assignments(worker_id);
create index if not exists idx_assignments_user on public.assignments(user_id);
create index if not exists idx_reworks_assignment on public.assignment_reworks(assignment_id);
create index if not exists idx_history_assignment on public.assignment_history(assignment_id);
create index if not exists idx_payments_assignment on public.payments(assignment_id);
create index if not exists idx_messages_pair on public.messages(from_id,to_id,created_at);
create index if not exists idx_notifications_user on public.notifications(user_id,created_at desc);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists assignments_updated_at on public.assignments;
create trigger assignments_updated_at before update on public.assignments for each row execute function public.set_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE AFTER SUPABASE AUTH SIGNUP
-- This guarantees an auth user can be created even before the
-- frontend sends the complete profile form.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles(id, name, email, programme, status, join_as, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'fullName', split_part(new.email,'@',1), 'User'),
    new.email,
    coalesce(new.raw_user_meta_data->>'programme', 'BFTech'),
    coalesce(new.raw_user_meta_data->>'status', 'Student'),
    coalesce(new.raw_user_meta_data->>'joinAs', 'Student'),
    coalesce(upper(new.raw_user_meta_data->>'role'), 'JUNIOR')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ============================================================
-- RLS
-- The Node server uses the Supabase service role key for server-side
-- operations. These policies also make direct Supabase access safe.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.doubts enable row level security;
alter table public.answers enable row level security;
alter table public.opportunities enable row level security;
alter table public.applications enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_reworks enable row level security;
alter table public.assignment_history enable row level security;
alter table public.payments enable row level security;
alter table public.connections enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;

-- Drop/recreate policies to make this SQL safely re-runnable.
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public' and tablename in ('profiles','projects','doubts','answers','opportunities','applications','assignments','assignment_reworks','assignment_history','payments','connections','messages','notifications','reports') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Profiles
create policy profiles_select on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);
create policy profiles_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Public content
create policy projects_select on public.projects for select using (visibility <> 'private' or auth.uid() = user_id);
create policy projects_insert on public.projects for insert with check (auth.uid() = user_id);
create policy projects_update on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy projects_delete on public.projects for delete using (auth.uid() = user_id);

create policy doubts_select on public.doubts for select using (true);
create policy doubts_insert on public.doubts for insert with check (auth.uid() = user_id);
create policy doubts_update on public.doubts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy doubts_delete on public.doubts for delete using (auth.uid() = user_id);

create policy answers_select on public.answers for select using (true);
create policy answers_insert on public.answers for insert with check (auth.uid() = user_id);
create policy answers_update on public.answers for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy answers_delete on public.answers for delete using (auth.uid() = user_id);

create policy opportunities_select on public.opportunities for select using (true);
create policy opportunities_insert on public.opportunities for insert with check (auth.uid() = user_id);
create policy opportunities_update on public.opportunities for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy opportunities_delete on public.opportunities for delete using (auth.uid() = user_id);

create policy applications_select on public.applications for select using (auth.uid() = user_id or auth.uid() in (select user_id from public.opportunities where id = opportunity_id));
create policy applications_insert on public.applications for insert with check (auth.uid() = user_id);
create policy applications_update on public.applications for update using (auth.uid() = user_id or auth.uid() in (select user_id from public.opportunities where id = opportunity_id));

-- Assignments: all authenticated users can see open/public workflow records;
-- participants can see their own private workflow details.
create policy assignments_select on public.assignments for select using (true);
create policy assignments_insert on public.assignments for insert with check (auth.uid() = user_id);
create policy assignments_update on public.assignments for update using (auth.uid() = user_id or auth.uid() = worker_id) with check (auth.uid() = user_id or auth.uid() = worker_id);

create policy reworks_select on public.assignment_reworks for select using (true);
create policy reworks_insert on public.assignment_reworks for insert with check (auth.uid() = user_id);

create policy history_select on public.assignment_history for select using (true);
create policy history_insert on public.assignment_history for insert with check (auth.uid() = user_id);

create policy payments_select on public.payments for select using (auth.uid() = payer_id or auth.uid() = payee_id);
create policy payments_insert on public.payments for insert with check (auth.uid() = payer_id);

create policy connections_select on public.connections for select using (auth.uid() = from_id or auth.uid() = to_id);
create policy connections_insert on public.connections for insert with check (auth.uid() = from_id);

create policy messages_select on public.messages for select using (auth.uid() = from_id or auth.uid() = to_id);
create policy messages_insert on public.messages for insert with check (auth.uid() = from_id);

create policy notifications_select on public.notifications for select using (auth.uid() = user_id);
create policy notifications_update on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy reports_insert on public.reports for insert with check (auth.uid() = reporter_id);
create policy reports_select on public.reports for select using (auth.uid() = reporter_id);

-- ============================================================
-- STORAGE
-- For this server version uploads are stored in /uploads on the
-- Node server. Keep this bucket available if the frontend later
-- switches to direct Supabase Storage uploads.
-- ============================================================
insert into storage.buckets(id, name, public)
values ('assignments', 'assignments', true)
on conflict (id) do update set public = true;

-- ============================================================
-- Optional seed data: no fake users are inserted.
-- Real accounts created through Supabase Auth become real profiles.
-- ============================================================
