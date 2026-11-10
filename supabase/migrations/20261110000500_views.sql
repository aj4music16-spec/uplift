-- Read models.
--
-- Server-derived summaries are authoritative: standings, day statuses and
-- counts are computed here from the underlying records at the server's clock,
-- never cached in client-writable columns. Each builder takes the viewer so it
-- can return peer-safe data (other players never see evidence rejections or
-- each other's values).

-- ---------------------------------------------------------------------------
-- Board: one row per participant and scheduled date
-- ---------------------------------------------------------------------------

create or replace function app.board(p_challenge uuid, p_viewer uuid)
returns table (
  participant_id uuid,
  user_id uuid,
  removed boolean,
  joined_at timestamptz,
  local_date date,
  true_status text,
  shown_status text,
  adjusted boolean,
  value numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select c.id, c.start_date, c.end_date, c.timezone, app.now() as now_ts, app.is_challenge_admin(c.id, p_viewer) as viewer_admin
    from public.challenges c
    where c.id = p_challenge
  ),
  cells as (
    select
      p.id as participant_id,
      p.user_id,
      p.removed_at is not null as removed,
      p.joined_at,
      ctx.start_date + g.n as local_date,
      ctx.timezone,
      ctx.now_ts,
      ctx.viewer_admin,
      r.outcome,
      r.provenance,
      r.effective_value,
      r.decided_at,
      r.acknowledged_at
    from ctx
    join public.participants p on p.challenge_id = ctx.id
    cross join lateral generate_series(0, ctx.end_date - ctx.start_date) as g(n)
    left join public.daily_records r on r.participant_id = p.id and r.local_date = ctx.start_date + g.n
  )
  select
    cells.participant_id,
    cells.user_id,
    cells.removed,
    cells.joined_at,
    cells.local_date,
    app.day_status(cells.outcome, cells.local_date, cells.timezone, cells.now_ts) as true_status,
    case
      when cells.user_id = p_viewer or cells.viewer_admin
        then app.day_status(cells.outcome, cells.local_date, cells.timezone, cells.now_ts)
      else app.peer_status(
        app.day_status(cells.outcome, cells.local_date, cells.timezone, cells.now_ts),
        app.can_resubmit_on_time(cells.outcome, cells.local_date, cells.timezone, cells.decided_at, cells.acknowledged_at, cells.now_ts)
      )
    end as shown_status,
    coalesce(cells.provenance = 'admin_adjusted', false) as adjusted,
    case when cells.user_id = p_viewer then cells.effective_value else null end as value
  from cells
$$;

-- Standings: successful days descending, competition ranking (1, 1, 3). The
-- order by participant id is only for stable display; it is not a tie-break.
-- Pending days are counted separately and never affect rank.
create or replace function app.standings_json(p_challenge uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select * from app.board(p_challenge, p_viewer)
  ),
  req as (
    select v.required_days
    from public.challenges c
    join public.rule_versions v on v.id = c.current_rule_version_id
    where c.id = p_challenge
  ),
  agg as (
    select
      b.participant_id,
      b.user_id,
      b.removed,
      count(*) filter (where b.true_status = 'success') as successful_days,
      count(*) filter (where b.true_status in ('pending', 'late_pending')) as pending_days,
      jsonb_agg(
        jsonb_build_object('date', b.local_date, 'status', b.shown_status, 'adjusted', b.adjusted, 'value', b.value)
        order by b.local_date
      ) as days
    from b
    group by b.participant_id, b.user_id, b.removed
  ),
  ranked as (
    select
      agg.*,
      case when agg.removed then null else rank() over (partition by agg.removed order by agg.successful_days desc) end as rnk,
      case when agg.removed then false else count(*) over (partition by agg.removed, agg.successful_days) > 1 end as tied
    from agg
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'participant_id', r.participant_id,
        'person', app.person_json(r.user_id),
        'successful_days', r.successful_days,
        'pending_days', r.pending_days,
        'rank', r.rnk,
        'tied', r.tied,
        'qualified', (not r.removed) and r.successful_days >= (select required_days from req),
        'removed', r.removed,
        'days', r.days
      )
      order by r.removed, r.rnk nulls last, r.participant_id
    ),
    '[]'::jsonb
  )
  from ranked r
$$;

-- ---------------------------------------------------------------------------
-- Challenge card and detail
-- ---------------------------------------------------------------------------

create or replace function app.challenge_card_json(p_challenge uuid, p_viewer uuid, p_standings jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  v_now timestamptz := app.now();
  v_status text;
  v_pid uuid;
  v_removed boolean := false;
  v_is_admin boolean;
  v_standings jsonb;
  v_me jsonb;
  v_pending integer := 0;
  v_disputes integer := 0;
  v_proposal boolean := false;
  v_ready boolean := false;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then
    return null;
  end if;
  v_status := app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now);
  v_is_admin := app.is_challenge_admin(c.id, p_viewer);

  select p.id, p.removed_at is not null into v_pid, v_removed
  from public.participants p
  where p.challenge_id = c.id and p.user_id = p_viewer;

  v_standings := coalesce(p_standings, app.standings_json(c.id, p_viewer));
  if v_pid is not null then
    select s into v_me from jsonb_array_elements(v_standings) s where (s ->> 'participant_id')::uuid = v_pid;
  end if;

  if v_is_admin and v_status in ('active', 'review') then
    select count(*) into v_pending
    from public.submissions s
    join public.daily_records r on r.id = s.daily_record_id
    join public.participants p on p.id = r.participant_id
    where p.challenge_id = c.id and p.removed_at is null and s.status in ('pending', 'late');

    select count(*) into v_disputes
    from public.disputes d
    join public.daily_records r on r.id = d.daily_record_id
    join public.participants p on p.id = r.participant_id
    where p.challenge_id = c.id and p.removed_at is null and d.status = 'open';
  end if;

  if v_pid is not null and not coalesce(v_removed, false) then
    v_proposal := exists (
      select 1
      from public.rule_versions pv
      where pv.challenge_id = c.id
        and pv.status = 'proposed'
        and not exists (
          select 1 from public.rule_acceptances ra where ra.version_id = pv.id and ra.participant_id = v_pid
        )
    );
  end if;

  if v_status = 'review' then
    v_ready := jsonb_array_length(app.finalization_blockers(c.id)) = 0;
  end if;

  return jsonb_build_object(
    'id', c.id,
    'circle_id', c.circle_id,
    'circle_name', (select ci.name from public.circles ci where ci.id = c.circle_id),
    'name', c.name,
    'description', c.description,
    'habit_type', c.habit_type,
    'metric_unit', c.metric_unit,
    'timezone', c.timezone,
    'status', v_status,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'revision', c.revision,
    'rules', app.rules_json(c.current_rule_version_id),
    'reward_mode', c.reward_mode,
    'participant_count', (select count(*) from public.participants p where p.challenge_id = c.id and p.removed_at is null),
    'participants', coalesce((
      select jsonb_agg(app.person_json(x.user_id) order by x.joined_at, x.id)
      from (
        select p.user_id, p.joined_at, p.id
        from public.participants p
        where p.challenge_id = c.id and p.removed_at is null
        order by p.joined_at, p.id
        limit 6
      ) x
    ), '[]'::jsonb),
    'viewer', jsonb_build_object(
      'is_admin', v_is_admin,
      'is_circle_admin', app.is_circle_admin(c.circle_id, p_viewer),
      'participant_id', v_pid,
      'removed', coalesce(v_removed, false),
      'successful_days', coalesce((v_me ->> 'successful_days')::integer, 0),
      'pending_days', coalesce((v_me ->> 'pending_days')::integer, 0),
      'rank', v_me -> 'rank',
      'tied', coalesce((v_me ->> 'tied')::boolean, false),
      'qualified', coalesce((v_me ->> 'qualified')::boolean, false)
    ),
    'my_days', coalesce(v_me -> 'days', '[]'::jsonb),
    'pending_review_count', v_pending,
    'open_dispute_count', v_disputes,
    'proposal_awaiting_me', v_proposal,
    'ready_to_finalize', v_ready,
    'draft_step', c.draft_step,
    'updated_at', c.updated_at
  );
end
$$;

create or replace function app.challenge_detail_json(p_challenge uuid, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  v_now timestamptz := app.now();
  v_status text;
  v_pid uuid;
  v_removed boolean;
  v_standings jsonb;
  v_proposal jsonb := null;
  v_finalization jsonb := null;
  v_reward jsonb := null;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then
    return null;
  end if;
  v_status := app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now);
  v_standings := app.standings_json(c.id, p_viewer);

  select p.id, p.removed_at is not null into v_pid, v_removed
  from public.participants p
  where p.challenge_id = c.id and p.user_id = p_viewer;

  select jsonb_build_object(
    'version', app.rules_json(pv.id),
    'reason', coalesce(pv.reason, ''),
    'proposed_by', app.person_json(pv.proposed_by),
    'proposed_at', pv.created_at,
    'responses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'participant_id', p.id,
          'person', app.person_json(p.user_id),
          'decision', coalesce(ra.decision, 'pending')
        )
        order by p.joined_at, p.id
      )
      from public.participants p
      left join public.rule_acceptances ra on ra.version_id = pv.id and ra.participant_id = p.id
      where p.challenge_id = c.id and p.removed_at is null
    ), '[]'::jsonb),
    'my_decision', case
      when v_pid is null or coalesce(v_removed, false) then null
      else coalesce(
        (select ra.decision from public.rule_acceptances ra where ra.version_id = pv.id and ra.participant_id = v_pid),
        'pending'
      )
    end
  )
  into v_proposal
  from public.rule_versions pv
  where pv.challenge_id = c.id and pv.status = 'proposed';

  if v_status = 'review' then
    v_finalization := jsonb_build_object(
      'final_deadline_at', app.day_deadline(c.end_date, c.timezone),
      'blockers', app.finalization_blockers(c.id)
    );
  end if;

  select jsonb_build_object(
    'mode', rp.mode,
    'gross_cents', rp.gross_cents,
    'fee_bps', rp.fee_bps,
    'currency', rp.currency,
    'demo_only', true,
    'sponsor', app.person_json(rp.sponsor_id)
  )
  into v_reward
  from public.reward_previews rp
  where rp.challenge_id = c.id;

  return app.challenge_card_json(c.id, p_viewer, v_standings) || jsonb_build_object(
    'creator', app.person_json(c.creator_id),
    'admins', coalesce((
      select jsonb_agg(app.person_json(a.user_id) order by a.assigned_at, a.id)
      from public.challenge_admins a
      where a.challenge_id = c.id and a.revoked_at is null
    ), '[]'::jsonb),
    'all_participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'person', app.person_json(p.user_id),
          'joined_at', p.joined_at,
          'removed_at', p.removed_at,
          'removed_reason', p.removed_reason
        )
        order by p.joined_at, p.id
      )
      from public.participants p
      where p.challenge_id = c.id
    ), '[]'::jsonb),
    'rule_versions', coalesce((
      select jsonb_agg(app.rules_json(v.id) order by v.version)
      from public.rule_versions v
      where v.challenge_id = c.id
    ), '[]'::jsonb),
    'proposal', v_proposal,
    'standings', v_standings,
    'finalization', v_finalization,
    'reward', v_reward,
    'canceled_reason', c.canceled_reason,
    'canceled_at', c.canceled_at,
    'completed_at', c.completed_at,
    'published_at', c.published_at,
    'rematch_of_id', c.rematch_of_id,
    'server_now', v_now
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------

create or replace function app.circle_summary_json(p_circle uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'timezone', c.timezone,
    'role', app.circle_role(c.id, p_viewer),
    'member_count', (select count(*) from public.circle_members m where m.circle_id = c.id and m.removed_at is null),
    'members', coalesce((
      select jsonb_agg(app.person_json(x.user_id) order by x.joined_at, x.id)
      from (
        select m.user_id, m.joined_at, m.id
        from public.circle_members m
        where m.circle_id = c.id and m.removed_at is null
        order by m.joined_at, m.id
        limit 6
      ) x
    ), '[]'::jsonb),
    'live_challenge_count', (
      select count(*)
      from public.challenges ch
      where ch.circle_id = c.id
        and app.effective_status(ch.status, ch.start_date, ch.end_date, ch.timezone, app.now()) in ('scheduled', 'active', 'review')
    )
  )
  from public.circles c
  where c.id = p_circle
$$;

create or replace function app.invite_json(p_invite uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'circle_id', i.circle_id,
    'challenge_id', i.challenge_id,
    'created_by', app.person_json(i.created_by),
    'created_at', i.created_at,
    'expires_at', i.expires_at,
    'max_uses', i.max_uses,
    'use_count', i.use_count,
    'revoked_at', i.revoked_at
  )
  from public.invitations i
  where i.id = p_invite
$$;

-- ---------------------------------------------------------------------------
-- A single day (check-in screen and submission detail)
-- ---------------------------------------------------------------------------

-- Only ever called after the caller has been authorized as the participant or
-- an assigned challenge admin.
create or replace function app.day_json(p_participant uuid, p_date date, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.participants%rowtype;
  c public.challenges%rowtype;
  r public.daily_records%rowtype;
  v_now timestamptz := app.now();
  v_rule uuid;
  v_record jsonb := null;
begin
  select * into p from public.participants where id = p_participant;
  select * into c from public.challenges where id = p.challenge_id;
  select * into r from public.daily_records where participant_id = p.id and local_date = p_date;
  if found then
    v_rule := r.rule_version_id;
    v_record := jsonb_build_object(
      'id', r.id,
      'outcome', r.outcome,
      'effective_value', r.effective_value,
      'provenance', r.provenance,
      'revision', r.revision,
      'decided_at', r.decided_at,
      'acknowledged_at', r.acknowledged_at
    );
  else
    v_rule := app.rule_for_date(c.id, p_date);
  end if;

  return jsonb_build_object(
    'challenge_id', c.id,
    'challenge_name', c.name,
    'circle_id', c.circle_id,
    'habit_type', c.habit_type,
    'metric_unit', c.metric_unit,
    'timezone', c.timezone,
    'challenge_status', app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now),
    'start_date', c.start_date,
    'end_date', c.end_date,
    'participant_id', p.id,
    'person', app.person_json(p.user_id),
    'date', p_date,
    'rule', app.rules_json(v_rule),
    'status', app.day_status(r.outcome, p_date, c.timezone, v_now),
    'record', v_record,
    'submissions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'version', s.version,
          'entered_value', s.entered_value,
          'submitted_at', s.submitted_at,
          'status', s.status,
          'is_late', s.is_late,
          'evidence', (
            select jsonb_build_object(
              'id', e.id,
              'mime', e.mime,
              'byte_size', e.byte_size,
              'duplicate', exists (
                select 1
                from public.evidence e2
                join public.submissions s2 on s2.id = e2.submission_id
                join public.daily_records r2 on r2.id = s2.daily_record_id
                join public.participants p2 on p2.id = r2.participant_id
                where e2.id <> e.id
                  and p2.challenge_id = c.id
                  and r2.id <> r.id
                  and ((e.etag is not null and e2.etag = e.etag) or (e.sha256 is not null and e2.sha256 = e.sha256))
              ),
              'available', e.purged_at is null
            )
            from public.evidence e
            where e.submission_id = s.id
          ),
          'reviews', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'reviewer', app.person_json(rv.reviewer_id),
                'decision', rv.decision,
                'corrected_value', rv.corrected_value,
                'reason', rv.reason,
                'reviewed_at', rv.reviewed_at,
                'self_review', rv.self_review
              )
              order by rv.reviewed_at, rv.id
            )
            from public.reviews rv
            where rv.submission_id = s.id
          ), '[]'::jsonb)
        )
        order by s.version desc
      )
      from public.submissions s
      where s.daily_record_id = r.id
    ), '[]'::jsonb),
    'increments', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', i.id, 'amount', i.amount, 'kind', i.kind, 'created_at', i.created_at)
        order by i.created_at desc, i.id
      )
      from public.activity_increments i
      where i.daily_record_id = r.id
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'actor', app.person_json(o.actor_id),
          'prior_outcome', o.prior_outcome,
          'prior_value', o.prior_value,
          'new_outcome', o.new_outcome,
          'new_value', o.new_value,
          'reason', o.reason,
          'created_at', o.created_at
        )
        order by o.created_at desc, o.id
      )
      from public.overrides o
      where o.daily_record_id = r.id
    ), '[]'::jsonb),
    'disputes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'raised_by', app.person_json(d.raised_by),
          'reason', d.reason,
          'status', d.status,
          'created_at', d.created_at,
          'resolver', app.person_json(d.resolver_id),
          'resolution', d.resolution,
          'resolved_at', d.resolved_at
        )
        order by d.created_at desc, d.id
      )
      from public.disputes d
      where d.daily_record_id = r.id
    ), '[]'::jsonb),
    'viewer', jsonb_build_object(
      'is_owner', p.user_id = p_viewer,
      'is_admin', app.is_challenge_admin(c.id, p_viewer)
    ),
    'server_now', v_now
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create or replace function app.message_json(p_message uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'circle_id', m.circle_id,
    'kind', m.type,
    'author', app.person_json(m.author_id),
    'text', m.text,
    'event', m.event,
    'client_id', m.client_id,
    'created_at', m.created_at,
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine) order by x.first_at, x.emoji)
      from (
        select rx.emoji, count(*) as n, bool_or(rx.user_id = p_viewer) as mine, min(rx.created_at) as first_at
        from public.reactions rx
        where rx.message_id = m.id
        group by rx.emoji
      ) x
    ), '[]'::jsonb)
  )
  from public.messages m
  where m.id = p_message and m.deleted_at is null
$$;
