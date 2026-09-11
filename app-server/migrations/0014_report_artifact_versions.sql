-- Preserve the original graph_svg artifact kind and store immutable S3 versions.
alter table report_artifacts drop constraint report_artifacts_kind_check;
alter table report_artifacts add constraint report_artifacts_kind_check check(kind in ('manifest','metrics_json','graph_svg','report_pdf') or kind ~ '^graph_svg_[1-9][0-9]*$');
alter table report_artifacts add column object_version_id text;
