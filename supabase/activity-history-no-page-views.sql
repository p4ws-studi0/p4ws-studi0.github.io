-- Discontinue page-view history, including calls from old cached website code.
-- Existing rows are retained but invisible. No account or operational data changes.
-- Run AFTER activity-history-setup.sql (and again after rerunning that base file).
begin;

drop policy if exists hq_activity_history_staff_read on public.hq_activity_history;
create policy hq_activity_history_staff_read on public.hq_activity_history for select to authenticated
using (action<>'page_view' and exists(select 1 from public.hq_tour_staff s where s.user_id=(select auth.uid()) and s.active));

create or replace function public.hq_activity_record_visit(p_path text, p_action text default 'sign_in')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  event_section text;
  event_label text;
  stamp timestamptz;
begin
  if actor is null or not exists(select 1 from public.hq_tour_staff s
      join auth.users u on u.id=s.user_id where s.user_id=actor and s.active) then
    raise exception 'Active HQ membership is required.' using errcode='42501';
  end if;
  -- Deliberately precedes path validation: all old page-view calls are quiet
  -- no-ops, including clients still using an obsolete canonical route.
  if p_action='page_view' then return false; end if;
  if p_action is null or p_action<>'sign_in' or p_path is null or char_length(p_path)>512
      or p_path !~ '^/' or p_path ~ '[[:cntrl:]?#%]' or position(chr(92) in p_path)>0 or p_path ~ '(^|/)\.\.?(/|$)' then
    raise exception 'A canonical HQ page and supported activity type are required.' using errcode='22023';
  end if;

  select entry.section,entry.label into event_section,event_label from (values
    ('/','home','Home'),('/settings','settings','Settings'),('/history','history','History'),('/login','account','Sign in'),
    ('/occupied-runs','occupied-runs','Occupied Runs'),('/end-of-day','end-of-day','End Of Day'),
    ('/tours','tours','Tours'),('/training','training','Training'),('/dog-licenses','dog-licenses','Dog Licenses'),
    ('/follow-up-calls','follow-up-calls','Follow-Up Calls'),('/marketing-initiatives','marketing-initiatives','Marketing Initiatives'),
    ('/biscuit-baskets','biscuit-baskets','Biscuit Baskets'),('/suggestions','suggestions','Suggestions'),
    ('/gift-cards','gift-cards','Gift Cards'),('/realtor-info','realtor-info','Realtor Info'),
    ('/k9-cough','k9-cough','K9 Cough'),('/vet-cheat-sheet','vet-cheat-sheet','Vet Cheat Sheet'),
    ('/potential-training-clients','potential-training-clients','Potential Training Clients'),
    ('/grooming-price-list','grooming-price-list','Grooming Price List'),('/boarding-base-rates','boarding-base-rates','Boarding Base Rates'),
    ('/digital-whiteboard','digital-whiteboard','Digital Whiteboard'),('/map2','occupied-runs','Occupied Runs Map'),
    ('/run_cards_temp','run-cards','Run Cards')
  ) as entry(path,section,label) where entry.path=p_path;
  if event_section is null then
    select 'knowledge-base',left(k.title,160) into event_section,event_label
      from public.hq_knowledge_pages k where k.path=p_path and not k.is_archive;
  end if;
  if event_section is null then
    raise exception 'This is not a supported HQ page.' using errcode='22023';
  end if;

  begin
    perform pg_advisory_xact_lock(hashtextextended(actor::text || ':sign_in:' || p_path,0));
    stamp:=clock_timestamp();
    if exists(select 1 from public.hq_activity_history h where h.actor_id=actor and h.source='client'
        and h.action='sign_in' and h.page_path=p_path and h.occurred_at>stamp-interval '60 seconds') then
      return false;
    end if;
    insert into public.hq_activity_history(occurred_at,actor_id,actor_name,action,section,record_label,page_path,source)
      values(stamp,actor,hq_history_private.actor_name(actor),'sign_in',event_section,event_label,p_path,'client');
    return true;
  exception when others then
    raise warning 'HQ_ACTIVITY_HISTORY_WRITE_FAILED';
    return false;
  end;
end;
$$;
revoke all on function public.hq_activity_record_visit(text,text) from public,anon,authenticated,service_role;
grant execute on function public.hq_activity_record_visit(text,text) to authenticated;
comment on function public.hq_activity_record_visit(text,text) is
  'Best-effort self-reported sign-in only, active HQ staff, server actor/time and safe canonical route. Legacy page_view requests always return false without storing or exposing browsing history.';

notify pgrst, 'reload schema';
commit;
