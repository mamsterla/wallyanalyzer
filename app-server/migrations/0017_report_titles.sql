-- Optional user-supplied report titles. Existing reports intentionally remain untitled.
alter table analysis_reports add column report_title text not null default '';
create index analysis_reports_title_search_idx on analysis_reports (lower(report_title));
