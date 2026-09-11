-- Report dispatch ownership is durable so a scheduler retry cannot create duplicate executions.
-- A multi-input report can publish several graph artifacts. Keep the base kind in the key.
alter table report_artifacts drop constraint report_artifacts_kind_check;
alter table report_artifacts add constraint report_artifacts_kind_check check(kind in ('manifest','metrics_json','report_pdf') or kind ~ '^graph_svg_[1-9][0-9]*$');
alter table report_outbox add column claim_token uuid;
alter table report_outbox add column claimed_at timestamptz;
alter table report_outbox add column execution_name text;
alter table report_outbox add column execution_arn text;
alter table report_requests add column status text not null default 'queued' check(status in ('queued','running','completed','partial_failed','failed'));
create unique index report_outbox_execution_name_idx on report_outbox(execution_name) where execution_name is not null;
create index report_outbox_claim_idx on report_outbox(processed_at,available_at,claimed_at);
