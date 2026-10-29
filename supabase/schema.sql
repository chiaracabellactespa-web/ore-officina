-- ============================================================
-- ORE OFFICINA - schema database per Supabase
-- Incolla tutto nello SQL Editor di Supabase e premi Run.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabelle ----------

create table public.workers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  pin_hash    text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'veh' check (kind in ('veh', 'gen')),
  code         text,
  plate        text,
  barcode      text,
  description  text not null default '',
  is_open      boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index jobs_code_uq on public.jobs (lower(code)) where code is not null and code <> '';

-- Mezzi usati per il soccorso stradale
create table public.vehicles (
  name text primary key
);

-- Ogni riga e' un periodo di lavoro o di pausa di un operaio
create table public.segments (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers (id),
  job_id      uuid references public.jobs (id) on delete set null,
  kind        text not null check (kind in ('work', 'break')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  parts       text not null default '',
  note        text not null default '',
  check (ended_at is null or ended_at >= started_at)
);
create unique index one_running_per_worker on public.segments (worker_id) where ended_at is null;
create index segments_started_idx on public.segments (started_at);

-- Soccorso stradale: legato al periodo di lavoro, quindi al lavoro avviato
create table public.rescues (
  segment_id  uuid not null references public.segments (id) on delete cascade,
  vehicle     text not null,
  primary key (segment_id, vehicle)
);

create table public.settings (
  key    text primary key,
  value  text not null
);

create table public.sessions (
  token       uuid primary key default gen_random_uuid(),
  role        text not null check (role in ('worker', 'owner')),
  worker_id   uuid references public.workers (id) on delete cascade,
  expires_at  timestamptz not null
);

create table public.login_attempts (
  subject  text not null,
  at       timestamptz not null default now()
);
create index login_attempts_idx on public.login_attempts (subject, at);

-- Nessuno puo' leggere o scrivere le tabelle direttamente: si passa solo dalle funzioni sotto.
alter table public.workers        enable row level security;
alter table public.jobs           enable row level security;
alter table public.vehicles       enable row level security;
alter table public.segments       enable row level security;
alter table public.rescues        enable row level security;
alter table public.settings       enable row level security;
alter table public.sessions       enable row level security;
alter table public.login_attempts enable row level security;
revoke all on all tables in schema public from anon, authenticated;

-- ---------- Funzioni interne ----------

create or replace function public._sess(p_token uuid, p_need text default null)
returns public.sessions
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions;
begin
  select * into s from public.sessions where token = p_token and expires_at > now();
  if not found then
    raise exception 'Sessione scaduta: rientra con il PIN';
  end if;
  if p_need is not null and s.role <> p_need then
    raise exception 'Operazione non consentita';
  end if;
  return s;
end $$;

create or replace function public._check_pin(p_pin text)
returns void
language plpgsql as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'Il PIN deve avere da 4 a 6 cifre';
  end if;
end $$;

-- ---------- Accesso ----------

create or replace function public.list_workers()
returns table (id uuid, name text)
language sql security definer set search_path = public, extensions as $$
  select w.id, w.name from public.workers w where w.active order by w.name;
$$;

create or replace function public.login_worker(p_worker uuid, p_pin text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare w public.workers; t uuid; subj text := 'w:' || p_worker::text;
begin
  if (select count(*) from public.login_attempts where subject = subj and at > now() - interval '15 minutes') >= 5 then
    return json_build_object('error', 'Troppi tentativi sbagliati. Riprova tra 15 minuti.');
  end if;
  select * into w from public.workers where id = p_worker and active;
  if not found or w.pin_hash <> extensions.crypt(coalesce(p_pin, ''), w.pin_hash) then
    insert into public.login_attempts (subject) values (subj);
    return json_build_object('error', 'PIN errato');
  end if;
  delete from public.login_attempts where subject = subj;
  delete from public.sessions where expires_at < now();
  insert into public.sessions (role, worker_id, expires_at)
    values ('worker', w.id, now() + interval '12 hours') returning token into t;
  return json_build_object('token', t, 'role', 'worker', 'worker_id', w.id, 'name', w.name);
end $$;

create or replace function public.login_owner(p_pin text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare h text; t uuid; subj text := 'owner';
begin
  select value into h from public.settings where key = 'owner_pin';
  if h is null then
    return json_build_object('error', 'PIN del titolare non ancora impostato (vedi la guida, passo 3)');
  end if;
  if (select count(*) from public.login_attempts where subject = subj and at > now() - interval '15 minutes') >= 5 then
    return json_build_object('error', 'Troppi tentativi sbagliati. Riprova tra 15 minuti.');
  end if;
  if h <> extensions.crypt(coalesce(p_pin, ''), h) then
    insert into public.login_attempts (subject) values (subj);
    return json_build_object('error', 'PIN errato');
  end if;
  delete from public.login_attempts where subject = subj;
  delete from public.sessions where expires_at < now();
  insert into public.sessions (role, expires_at) values ('owner', now() + interval '12 hours') returning token into t;
  return json_build_object('token', t, 'role', 'owner', 'name', 'Titolare');
end $$;

create or replace function public.logout(p_token uuid)
returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.sessions where token = p_token;
$$;

-- Da eseguire UNA volta nello SQL Editor per creare il PIN del titolare
create or replace function public.setup_owner_pin(p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._check_pin(p_pin);
  insert into public.settings (key, value) values ('owner_pin', extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
end $$;

-- ---------- Operaio ----------

create or replace function public.w_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker');
begin
  return json_build_object(
    'now', now(),
    'jobs', (select coalesce(json_agg(j order by j.created_at desc), '[]'::json)
             from (select id, kind, code, plate, barcode, description, is_open, created_at
                   from public.jobs where is_open) j),
    'vehicles', (select coalesce(json_agg(v.name order by v.name), '[]'::json) from public.vehicles v),
    -- chi sta lavorando adesso (colleghi compresi): serve a mostrare "gia in lavorazione: ..." sul lavoro
    'busy', (select coalesce(json_agg(b), '[]'::json)
             from (select sg.job_id, w.name, sg.worker_id
                   from public.segments sg join public.workers w on w.id = sg.worker_id
                   where sg.ended_at is null and sg.kind = 'work' and sg.job_id is not null) b),
    'segments', (select coalesce(json_agg(x order by x.started_at), '[]'::json)
                 from (select sg.id, sg.job_id, sg.kind, sg.started_at, sg.ended_at, sg.parts, sg.note,
                              (select coalesce(json_agg(r.vehicle order by r.vehicle), '[]'::json)
                                 from public.rescues r where r.segment_id = sg.id) as rescues
                       from public.segments sg
                       where sg.worker_id = s.worker_id
                         and (sg.started_at >= now() - interval '3 days' or sg.ended_at is null)) x)
  );
end $$;

create or replace function public.w_start(p_token uuid, p_kind text, p_job uuid default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker');
begin
  if p_kind not in ('work', 'break') then
    raise exception 'Tipo non valido';
  end if;
  if p_kind = 'work' and not exists (select 1 from public.jobs where id = p_job and is_open) then
    raise exception 'Lavoro non disponibile';
  end if;
  if exists (select 1 from public.segments where worker_id = s.worker_id and ended_at is null) then
    raise exception 'Hai già un timer attivo';
  end if;
  insert into public.segments (worker_id, job_id, kind)
    values (s.worker_id, case when p_kind = 'work' then p_job else null end, p_kind);
end $$;

create or replace function public.w_pause(p_token uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker'); v_job uuid;
begin
  update public.segments set ended_at = now()
    where worker_id = s.worker_id and ended_at is null and kind = 'work' returning job_id into v_job;
  if not found then
    raise exception 'Nessun lavoro in corso';
  end if;
  insert into public.segments (worker_id, job_id, kind) values (s.worker_id, v_job, 'break');
end $$;

create or replace function public.w_resume(p_token uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker'); v_job uuid;
begin
  update public.segments set ended_at = now()
    where worker_id = s.worker_id and ended_at is null and kind = 'break' returning job_id into v_job;
  if not found then
    raise exception 'Nessuna pausa in corso';
  end if;
  if v_job is null then
    raise exception 'Questa pausa non è legata a un lavoro';
  end if;
  insert into public.segments (worker_id, job_id, kind) values (s.worker_id, v_job, 'work');
end $$;

create or replace function public.w_stop(p_token uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker');
begin
  update public.segments set ended_at = now() where worker_id = s.worker_id and ended_at is null;
  if not found then
    raise exception 'Nessun timer in corso';
  end if;
end $$;

-- Chiude un timer dimenticato a un'ora indicata dall'operaio
create or replace function public.w_close_at(p_token uuid, p_end timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker');
begin
  update public.segments set ended_at = least(greatest(p_end, started_at), now())
    where worker_id = s.worker_id and ended_at is null;
  if not found then
    raise exception 'Nessun timer in corso';
  end if;
end $$;

create or replace function public.w_set_text(p_token uuid, p_seg uuid, p_parts text, p_note text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker');
begin
  update public.segments set parts = left(coalesce(p_parts, ''), 2000), note = left(coalesce(p_note, ''), 2000)
    where id = p_seg and worker_id = s.worker_id and kind = 'work';
end $$;

create or replace function public.w_set_rescue(p_token uuid, p_seg uuid, p_vehicle text, p_on boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'worker');
begin
  if not exists (select 1 from public.segments where id = p_seg and worker_id = s.worker_id and kind = 'work') then
    raise exception 'Il soccorso si registra su un lavoro';
  end if;
  if p_on then
    if not exists (select 1 from public.vehicles where name = p_vehicle) then
      raise exception 'Mezzo non in elenco';
    end if;
    insert into public.rescues (segment_id, vehicle) values (p_seg, p_vehicle) on conflict do nothing;
  else
    delete from public.rescues where segment_id = p_seg and vehicle = p_vehicle;
  end if;
end $$;

-- ---------- Titolare ----------

create or replace function public.o_state(p_token uuid, p_from date, p_to date)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  return json_build_object(
    'now', now(),
    'jobs', (select coalesce(json_agg(j order by j.created_at desc), '[]'::json)
             from (select id, kind, code, plate, barcode, description, is_open, created_at from public.jobs) j),
    'vehicles', (select coalesce(json_agg(v.name order by v.name), '[]'::json) from public.vehicles v),
    'workers', (select coalesce(json_agg(w order by w.name), '[]'::json)
                from (select id, name, active from public.workers) w),
    'segments', (select coalesce(json_agg(x order by x.started_at), '[]'::json)
                 from (select sg.id, sg.worker_id, sg.job_id, sg.kind, sg.started_at, sg.ended_at, sg.parts, sg.note,
                              (select coalesce(json_agg(r.vehicle order by r.vehicle), '[]'::json)
                                 from public.rescues r where r.segment_id = sg.id) as rescues
                       from public.segments sg
                       where (sg.started_at at time zone 'Europe/Rome')::date between p_from and p_to
                          or sg.ended_at is null) x)
  );
end $$;

create or replace function public.o_add_job(p_token uuid, p_kind text, p_code text, p_plate text, p_barcode text, p_desc text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  if coalesce(p_code, '') = '' and coalesce(p_plate, '') = '' and coalesce(p_barcode, '') = '' then
    raise exception 'Inserisci almeno codice, targa o codice a barre';
  end if;
  insert into public.jobs (kind, code, plate, barcode, description)
    values (case when p_kind = 'gen' then 'gen' else 'veh' end, nullif(trim(p_code), ''), upper(nullif(trim(p_plate), '')),
            nullif(trim(p_barcode), ''), left(coalesce(p_desc, ''), 300));
exception when unique_violation then
  raise exception 'Codice lavoro già esistente';
end $$;

create or replace function public.o_set_job_open(p_token uuid, p_job uuid, p_open boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  update public.jobs set is_open = p_open where id = p_job;
end $$;

create or replace function public.o_delete_job(p_token uuid, p_job uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  delete from public.jobs where id = p_job;
end $$;

create or replace function public.o_add_worker(p_token uuid, p_name text, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Inserisci il nome';
  end if;
  perform public._check_pin(p_pin);
  insert into public.workers (name, pin_hash) values (trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')));
end $$;

create or replace function public.o_set_worker_pin(p_token uuid, p_worker uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  perform public._check_pin(p_pin);
  update public.workers set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_worker;
  delete from public.sessions where worker_id = p_worker;
  delete from public.login_attempts where subject = 'w:' || p_worker::text;
end $$;

create or replace function public.o_set_worker_active(p_token uuid, p_worker uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  update public.workers set active = p_active where id = p_worker;
  if not p_active then
    delete from public.sessions where worker_id = p_worker;
  end if;
end $$;

create or replace function public.o_add_vehicle(p_token uuid, p_name text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Inserisci il nome del mezzo';
  end if;
  insert into public.vehicles (name) values (trim(p_name)) on conflict do nothing;
end $$;

create or replace function public.o_del_vehicle(p_token uuid, p_name text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  delete from public.vehicles where name = p_name;
end $$;

create or replace function public.o_set_owner_pin(p_token uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  perform public._check_pin(p_pin);
  update public.settings set value = extensions.crypt(p_pin, extensions.gen_salt('bf')) where key = 'owner_pin';
end $$;

create or replace function public.o_fix_segment(p_token uuid, p_seg uuid, p_start timestamptz, p_end timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  update public.segments set started_at = p_start, ended_at = p_end where id = p_seg;
exception
  when check_violation then raise exception 'La fine non può precedere l''inizio';
  when unique_violation then raise exception 'L''operaio ha già un altro timer attivo';
end $$;

create or replace function public.o_delete_segment(p_token uuid, p_seg uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  delete from public.segments where id = p_seg;
end $$;

create or replace function public.o_add_segment(p_token uuid, p_worker uuid, p_job uuid, p_kind text, p_start timestamptz, p_end timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions := public._sess(p_token, 'owner');
begin
  if p_kind not in ('work', 'break') then
    raise exception 'Tipo non valido';
  end if;
  insert into public.segments (worker_id, job_id, kind, started_at, ended_at)
    values (p_worker, case when p_kind = 'work' then p_job else null end, p_kind, p_start, p_end);
exception
  when check_violation then raise exception 'La fine non può precedere l''inizio';
  when unique_violation then raise exception 'L''operaio ha già un altro timer attivo';
end $$;

-- ---------- Permessi: l'app puo' chiamare solo queste funzioni ----------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.list_workers()                                   to anon;
grant execute on function public.login_worker(uuid, text)                         to anon;
grant execute on function public.login_owner(text)                                to anon;
grant execute on function public.logout(uuid)                                     to anon;
grant execute on function public.w_state(uuid)                                    to anon;
grant execute on function public.w_start(uuid, text, uuid)                        to anon;
grant execute on function public.w_pause(uuid)                                    to anon;
grant execute on function public.w_resume(uuid)                                   to anon;
grant execute on function public.w_stop(uuid)                                     to anon;
grant execute on function public.w_close_at(uuid, timestamptz)                    to anon;
grant execute on function public.w_set_text(uuid, uuid, text, text)              to anon;
grant execute on function public.w_set_rescue(uuid, uuid, text, boolean)         to anon;
grant execute on function public.o_state(uuid, date, date)                        to anon;
grant execute on function public.o_add_job(uuid, text, text, text, text, text)   to anon;
grant execute on function public.o_set_job_open(uuid, uuid, boolean)             to anon;
grant execute on function public.o_delete_job(uuid, uuid)                         to anon;
grant execute on function public.o_add_worker(uuid, text, text)                  to anon;
grant execute on function public.o_set_worker_pin(uuid, uuid, text)              to anon;
grant execute on function public.o_set_worker_active(uuid, uuid, boolean)        to anon;
grant execute on function public.o_add_vehicle(uuid, text)                        to anon;
grant execute on function public.o_del_vehicle(uuid, text)                        to anon;
grant execute on function public.o_set_owner_pin(uuid, text)                      to anon;
grant execute on function public.o_fix_segment(uuid, uuid, timestamptz, timestamptz) to anon;
grant execute on function public.o_delete_segment(uuid, uuid)                     to anon;
grant execute on function public.o_add_segment(uuid, uuid, uuid, text, timestamptz, timestamptz) to anon;

-- ---------- Dati iniziali ----------

insert into public.jobs (kind, code, description) values
  ('gen', 'GEN-PULIZIA', 'Pulizia officina'),
  ('gen', 'GEN-ALTRO',   'Altre attività / varie');

insert into public.vehicles (name) values ('Carro attrezzi 1');
